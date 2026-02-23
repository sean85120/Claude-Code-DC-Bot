import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { BotConfig } from '../types.js';
import { SEARCH_TOOLS } from '../types.js';
import type { StateStore } from '../effects/state-store.js';
import { logger } from '../effects/logger.js';

const log = logger.child({ module: 'Stream' });
import type { UsageStore } from '../effects/usage-store.js';
import type { PlatformAdapter, PlatformMessage } from '../platforms/types.js';
import {
  buildToolUseEmbed,
  buildCompactToolEmbed,
  buildResultEmbed,
  buildErrorEmbed,
} from '../modules/embeds.js';
import { extractAssistantText, extractToolUse, extractResult } from '../modules/message-parser.js';
import { calculateTokenUsage } from '../modules/token-usage.js';
import { truncate } from '../modules/formatters.js';

/** Dependency injection interface for the stream handler */
export interface StreamHandlerDeps {
  store: StateStore;
  threadId: string;
  adapter: PlatformAdapter;
  cwd: string;
  streamUpdateIntervalMs: number;
  usageStore: UsageStore;
  /** Live config reference — changes via /settings propagate to running sessions */
  config: BotConfig;
}

/**
 * Stream accumulation state
 */
interface StreamState {
  currentText: string;
  currentMessage: PlatformMessage | null;
  lastUpdateTime: number;
  updateTimer: ReturnType<typeof setTimeout> | null;
}

function createStreamState(): StreamState {
  return {
    currentText: '',
    currentMessage: null,
    lastUpdateTime: 0,
    updateTimer: null,
  };
}

/**
 * Throttled update of streaming text to the platform
 */
async function throttledStreamUpdate(
  state: StreamState,
  deps: StreamHandlerDeps,
): Promise<void> {
  const now = Date.now();
  const elapsed = now - state.lastUpdateTime;

  if (elapsed < deps.streamUpdateIntervalMs) {
    if (!state.updateTimer) {
      state.updateTimer = setTimeout(() => {
        state.updateTimer = null;
        flushStreamUpdate(state, deps).catch((err) =>
          log.error({ err }, 'Stream update error'),
        );
      }, deps.streamUpdateIntervalMs - elapsed);
    }
    return;
  }

  await flushStreamUpdate(state, deps);
}

/**
 * Formats streaming text (shows the tail when exceeding the platform's limit)
 */
function formatStreamingText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return '…' + text.slice(-(limit - 1));
}

/**
 * Actually executes the streaming text update (plain text)
 */
async function flushStreamUpdate(
  state: StreamState,
  deps: StreamHandlerDeps,
): Promise<void> {
  if (!state.currentText) return;

  state.lastUpdateTime = Date.now();
  const displayText = formatStreamingText(state.currentText, deps.adapter.messageLimit);

  try {
    if (state.currentMessage) {
      await deps.adapter.editText(state.currentMessage, displayText);
    } else {
      state.currentMessage = await deps.adapter.sendPlainText(deps.threadId, displayText);
    }
  } catch (err) {
    log.error({ err }, 'Stream text update error');
  }
}

/**
 * Handles a single SDK message, forwarding it to the corresponding thread based on message type
 *
 * @param message - Message returned by the Claude SDK
 * @param deps - Dependencies required by the stream handler
 * @param streamState - Stream accumulation state (used for throttled text updates)
 * @returns void
 */
export async function handleSDKMessage(
  message: SDKMessage,
  deps: StreamHandlerDeps,
  streamState: StreamState,
): Promise<void> {
  const { store, threadId, adapter, cwd } = deps;

  switch (message.type) {
    case 'system': {
      if ('subtype' in message) {
        if (message.subtype === 'init') {
          store.updateSession(threadId, { sessionId: message.session_id });
          deps.usageStore.recordSessionStart();
          log.info({ threadId, sessionId: message.session_id }, 'Session initialized');
        }
      }
      break;
    }

    case 'stream_event': {
      const event = (message as { event: Record<string, unknown> }).event;
      if (
        event.type === 'content_block_delta' &&
        typeof event.delta === 'object' &&
        event.delta !== null
      ) {
        const delta = event.delta as Record<string, unknown>;
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          streamState.currentText += delta.text;
          await throttledStreamUpdate(streamState, deps);
        }
      }
      break;
    }

    case 'assistant': {
      const text = extractAssistantText(message);

      // Clear the scheduled throttled update
      if (streamState.updateTimer) {
        clearTimeout(streamState.updateTimer);
        streamState.updateTimer = null;
      }

      // Record transcript
      const session = store.getSession(threadId);
      if (text && session?.transcript) {
        session.transcript.push({
          timestamp: new Date(),
          type: 'assistant',
          content: text.slice(0, 2000),
        });
      }

      if (text) {
        if (text.length <= adapter.messageLimit && streamState.currentMessage) {
          // Text is within limit, edit the stream message directly
          try {
            await adapter.editText(streamState.currentMessage, text);
          } catch {
            // If editing fails, resend
            await adapter.sendText(threadId, text);
          }
        } else {
          // Text exceeds limit or no stream message, delete stream message and send in segments
          if (streamState.currentMessage) {
            try {
              await adapter.deleteMessage(streamState.currentMessage);
            } catch {
              // Message may have already been deleted
            }
          }
          await adapter.sendText(threadId, text);
        }
      }

      // Reset stream state
      streamState.currentText = '';
      streamState.currentMessage = null;

      // Extract tool calls
      const toolCalls = extractToolUse(message);
      for (const tool of toolCalls) {
        store.recordToolUse(threadId, tool.toolName);
        log.info({ threadId, tool: tool.toolName }, 'Tool call');

        // Record transcript
        if (session?.transcript) {
          session.transcript.push({
            timestamp: new Date(),
            type: 'tool_use',
            content: JSON.stringify(tool.toolInput).slice(0, 500),
            toolName: tool.toolName,
          });
        }

        // Embed visibility precedence: hideAll > hideRead/hideSearch > compact > full
        const cfg = deps.config;
        if (cfg.hideAllToolEmbeds) continue;
        if (cfg.hideReadResults && tool.toolName === 'Read') continue;
        if (cfg.hideSearchResults && SEARCH_TOOLS.includes(tool.toolName)) continue;

        const toolInput = tool.toolInput as Record<string, unknown>;
        const embed = cfg.compactToolEmbeds
          ? buildCompactToolEmbed(tool.toolName, toolInput, cwd)
          : buildToolUseEmbed(tool.toolName, toolInput, cwd);
        await adapter.sendRichMessage(threadId, embed);
      }
      break;
    }

    case 'result': {
      const result = extractResult(message);
      const session = store.getSession(threadId);
      const stats = session
        ? { toolCount: session.toolCount, tools: session.tools }
        : { toolCount: 0, tools: {} };

      const usage = calculateTokenUsage(result.usage);

      // Record transcript
      if (session?.transcript) {
        session.transcript.push({
          timestamp: new Date(),
          type: result.success ? 'result' : 'error',
          content: (result.text || '').slice(0, 2000),
        });
      }

      // Record global and per-user usage
      deps.usageStore.recordResult(threadId, usage, result.costUsd, result.durationMs, session?.userId);

      if (result.success) {
        log.info({ threadId, tokens: usage, cost: result.costUsd, durationMs: result.durationMs }, 'Result received');
        // Response text was already sent in the assistant message; here we only send the stats summary
        const embed = buildResultEmbed('', stats, usage, result.durationMs, result.costUsd);
        await adapter.sendRichMessage(threadId, embed);
      } else {
        log.warn({ threadId, error: truncate(result.text || '', 100) }, 'Error result received');
        const embed = buildErrorEmbed(result.text || 'An error occurred during execution');
        await adapter.sendRichMessage(threadId, embed);
      }

      break;
    }

    case 'tool_progress': {
      break;
    }

    default:
      break;
  }
}

/**
 * Creates an SDK message handler function, binding dependencies and stream state
 *
 * @param deps - Dependencies required by the stream handler
 * @returns An async callback that receives SDK messages
 */
export function createMessageHandler(deps: StreamHandlerDeps) {
  const streamState = createStreamState();

  return async (message: SDKMessage): Promise<void> => {
    try {
      await handleSDKMessage(message, deps, streamState);
    } catch (error) {
      log.error({ err: error }, 'Error occurred while processing message');
    }
  };
}
