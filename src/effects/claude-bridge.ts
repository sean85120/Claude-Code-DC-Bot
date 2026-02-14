import { query, type Query, type Options, type SDKMessage, type SDKUserMessage, type CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import type { FileAttachment, PermissionMode } from '../types.js';

/** Options for {@link startQuery} */
export interface ClaudeBridgeOptions {
  cwd: string;
  model: string;
  permissionMode: PermissionMode;
  abortController: AbortController;
  canUseTool?: CanUseTool;
  onMessage: (message: SDKMessage) => void;
  onError: (error: Error) => void;
  onComplete: () => void;
  resume?: string;
  attachments?: FileAttachment[];
}

/**
 * Combine text and file attachments into the AsyncIterable prompt format required by the SDK
 * @param text - The user prompt text
 * @param attachments - Array of image or PDF attachments
 * @returns An AsyncIterable<SDKUserMessage> consumable by the SDK
 */
function buildRichPrompt(text: string, attachments: FileAttachment[]): AsyncIterable<SDKUserMessage> {
  const contentBlocks: Array<Record<string, unknown>> = [];

  if (text) {
    contentBlocks.push({ type: 'text', text });
  }

  for (const att of attachments) {
    if (att.type === 'image') {
      contentBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: att.mediaType,
          data: att.base64,
        },
      });
    } else if (att.type === 'document') {
      contentBlocks.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: att.mediaType,
          data: att.base64,
        },
        title: att.filename,
      });
    }
    // text type is already embedded in the prompt text, no content block needed
  }

  const userMessage = {
    type: 'user' as const,
    message: {
      role: 'user' as const,
      content: contentBlocks,
    },
    parent_tool_use_id: null,
    session_id: '',
  } as SDKUserMessage;

  async function* generate() {
    yield userMessage;
  }

  return generate();
}

/**
 * Start a Claude Code SDK query, asynchronously iterating the message stream in the background
 * @param prompt - The user prompt text
 * @param opts - Query options (working directory, model, callbacks, etc.)
 * @returns The Query instance and session ID (may be null before init)
 */
export async function startQuery(
  prompt: string,
  opts: ClaudeBridgeOptions,
): Promise<{ queryInstance: Query; sessionId: string | null }> {
  const options: Options = {
    cwd: opts.cwd,
    model: opts.model,
    permissionMode: opts.permissionMode === 'bypassPermissions' ? 'bypassPermissions' : opts.permissionMode,
    allowDangerouslySkipPermissions: opts.permissionMode === 'bypassPermissions' ? true : undefined,
    abortController: opts.abortController,
    canUseTool: opts.canUseTool,
    includePartialMessages: true,
    settingSources: ['project', 'local'],
    resume: opts.resume,
  };

  // If there are file attachments (images/PDFs), use the AsyncIterable<SDKUserMessage> format
  const hasRichAttachments = opts.attachments && opts.attachments.length > 0;
  const promptParam: string | AsyncIterable<SDKUserMessage> = hasRichAttachments
    ? buildRichPrompt(prompt, opts.attachments!)
    : prompt;

  const queryInstance = query({ prompt: promptParam, options });

  let sessionId: string | null = null;

  // Asynchronously iterate the stream (non-blocking for the caller)
  (async () => {
    try {
      for await (const message of queryInstance) {
        // Extract session_id
        if (message.type === 'system' && 'subtype' in message && message.subtype === 'init') {
          sessionId = message.session_id;
        }

        opts.onMessage(message);
      }
      opts.onComplete();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        opts.onComplete();
      } else {
        opts.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  })();

  // Wait briefly for the init message to arrive
  await new Promise((resolve) => setTimeout(resolve, 500));

  return { queryInstance, sessionId };
}

/**
 * Interrupt an in-progress Claude Code query
 * @param queryInstance - The Query instance to interrupt
 */
export async function interruptQuery(queryInstance: Query): Promise<void> {
  try {
    await queryInstance.interrupt();
  } catch {
    // May have already finished
  }
}
