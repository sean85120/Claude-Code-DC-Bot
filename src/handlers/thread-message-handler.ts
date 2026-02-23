import type { Message } from 'discord.js';
import type { BotConfig, SessionState, FileAttachment } from '../types.js';
import type { StateStore } from '../effects/state-store.js';
import type { PlatformAdapter, PlatformInteraction } from '../platforms/types.js';
import { logger } from '../effects/logger.js';
import { isUserAuthorized } from '../modules/permissions.js';

const log = logger.child({ module: 'Thread' });
import { buildFollowUpEmbed } from '../modules/embeds.js';

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const SUPPORTED_TEXT_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cpp', '.h',
  '.html', '.css', '.scss', '.less', '.vue', '.svelte',
  '.json', '.yaml', '.yml', '.toml', '.xml', '.csv',
  '.txt', '.md', '.mdx', '.rst', '.log',
  '.sh', '.bash', '.zsh', '.fish', '.ps1',
  '.sql', '.graphql', '.prisma',
  '.env', '.gitignore', '.dockerignore', '.editorconfig',
  '.dockerfile',
];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_TEXT_FILE_SIZE = 1 * 1024 * 1024; // 1MB (smaller limit for text files)

/** Dependency injection interface for the thread message handler */
export interface ThreadMessageHandlerDeps {
  config: BotConfig;
  store: StateStore;
  adapter: PlatformAdapter;
  startClaudeQuery: (session: SessionState, threadId: string) => Promise<void>;
}

/**
 * Classifies an attachment as image, document, or text based on MIME type and filename
 *
 * @param contentType - The MIME type of the attachment (may be null)
 * @param filename - The filename of the attachment
 * @returns The attachment type string, or null if unsupported
 */
export function classifyAttachment(contentType: string | null, filename: string): 'image' | 'document' | 'text' | null {
  if (contentType && SUPPORTED_IMAGE_TYPES.includes(contentType)) return 'image';
  if (contentType === 'application/pdf') return 'document';

  // Determine text file by extension
  const ext = filename.lastIndexOf('.') >= 0 ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : '';
  if (SUPPORTED_TEXT_EXTENSIONS.includes(ext)) return 'text';
  if (contentType?.startsWith('text/')) return 'text';

  return null;
}

/**
 * Downloads file attachments from a Discord message (legacy helper, used by Discord adapter)
 */
async function downloadAttachments(message: Message): Promise<FileAttachment[]> {
  const files: FileAttachment[] = [];

  for (const [, attachment] of message.attachments) {
    const fileType = classifyAttachment(attachment.contentType, attachment.name);
    if (!fileType) continue;

    // Text files have a smaller size limit
    const sizeLimit = fileType === 'text' ? MAX_TEXT_FILE_SIZE : MAX_FILE_SIZE;
    if (attachment.size > sizeLimit) continue;

    try {
      const response = await fetch(attachment.url);
      const buffer = Buffer.from(await response.arrayBuffer());

      const fileAttachment: FileAttachment = {
        type: fileType,
        base64: buffer.toString('base64'),
        mediaType: attachment.contentType || 'application/octet-stream',
        filename: attachment.name,
      };

      // Additionally save plain text content for text files
      if (fileType === 'text') {
        fileAttachment.textContent = buffer.toString('utf-8');
      }

      files.push(fileAttachment);
    } catch (error) {
      log.error({ err: error, filename: attachment.name }, 'Failed to download file');
    }
  }

  return files;
}

/**
 * Creates the thread message handler, listening for follow-up messages from users in threads and starting resume queries.
 * Supports both PlatformInteraction (new adapter path) and Discord Message (legacy path).
 *
 * @param deps - Dependencies required by the thread message handler
 * @returns An async function that handles thread messages
 */
export function createThreadMessageHandler(deps: ThreadMessageHandlerDeps) {
  return async function handleThreadMessage(input: Message | PlatformInteraction): Promise<void> {
    // Determine if this is a PlatformInteraction or a raw Discord Message
    let userId: string;
    let threadId: string;
    let messageContent: string;
    let fileAttachments: FileAttachment[];

    if ('platform' in input) {
      // PlatformInteraction path
      const pi = input as PlatformInteraction;
      userId = pi.userId;
      threadId = pi.threadId;
      messageContent = (pi.text ?? '').trim();
      fileAttachments = await deps.adapter.downloadAttachments(pi);
    } else {
      // Legacy Discord Message path
      const message = input as Message;
      if (message.author.bot) return;
      if (!message.channel.isThread()) return;
      userId = message.author.id;
      threadId = message.channel.id;
      messageContent = message.content.trim();
      fileAttachments = await downloadAttachments(message);
    }

    // Verify this thread has a corresponding session
    const { store } = deps;
    const session = store.getSession(threadId);
    if (!session) return;

    // Only accept follow-ups in waiting_input state
    if (session.status !== 'waiting_input') return;

    // Check user authorization
    if (!isUserAuthorized(userId, deps.config.allowedUserIds)) return;

    // Must have text or files
    if (!messageContent && fileAttachments.length === 0) return;

    // Verify there is a sessionId available for resume
    if (!session.sessionId) {
      await deps.adapter.sendText(threadId, '⚠️ Unable to resume conversation: missing Session ID');
      return;
    }

    // Create a new AbortController
    const newAbortController = new AbortController();

    // Compose prompt text (text file contents are embedded in the prompt)
    const textFileContents = fileAttachments
      .filter((f) => f.type === 'text' && f.textContent)
      .map((f) => `--- ${f.filename} ---\n${f.textContent}`)
      .join('\n\n');

    const promptParts = [messageContent, textFileContents].filter(Boolean);
    const promptText = promptParts.join('\n\n') || '(Please see attachments)';

    // Non-text files (images + PDFs) need to be sent as content blocks
    const richAttachments = fileAttachments.filter((f) => f.type !== 'text');

    // Update session state
    store.updateSession(threadId, {
      status: 'running',
      promptText,
      abortController: newAbortController,
      pendingApproval: null,
      attachments: richAttachments.length > 0 ? richAttachments : undefined,
    });

    // Record user message to transcript
    const updatedSession = store.getSession(threadId);
    if (updatedSession?.transcript) {
      const attachmentSummary = fileAttachments.length > 0
        ? `\n[📎 ${fileAttachments.map((f) => f.filename).join(', ')}]`
        : '';
      updatedSession.transcript.push({
        timestamp: new Date(),
        type: 'user',
        content: `${messageContent || ''}${attachmentSummary}`.slice(0, 2000),
      });
    }

    // Send follow-up confirmation embed
    const embed = buildFollowUpEmbed(
      messageContent || '(See attachments)',
      fileAttachments.length,
      fileAttachments.map((f) => f.filename),
    );
    await deps.adapter.sendRichMessage(threadId, embed);

    // Start resume query
    if (!updatedSession) return;

    deps.startClaudeQuery(updatedSession, threadId).catch(async (error) => {
      log.error({ err: error, threadId }, 'Resume query error');
      store.updateSession(threadId, { status: 'error' });
    });
  };
}
