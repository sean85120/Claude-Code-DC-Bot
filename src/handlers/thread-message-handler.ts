import type { BotConfig, SessionState } from '../types.js';
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
 * Creates the thread message handler, listening for follow-up messages from users in threads and starting resume queries.
 *
 * @param deps - Dependencies required by the thread message handler
 * @returns An async function that handles thread messages
 */
export function createThreadMessageHandler(deps: ThreadMessageHandlerDeps) {
  return async function handleThreadMessage(input: PlatformInteraction): Promise<void> {
    const userId = input.userId;
    const threadId = input.threadId;
    const messageContent = (input.text ?? '').trim();
    const fileAttachments = await deps.adapter.downloadAttachments(input);

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
