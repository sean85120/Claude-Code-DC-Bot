import type { ThreadChannel, Message } from 'discord.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { BotConfig } from '../types.js';
import { SEARCH_TOOLS } from '../types.js';
import type { StateStore } from '../effects/state-store.js';
import { logger } from '../effects/logger.js';

const log = logger.child({ module: 'Stream' });
import type { UsageStore } from '../effects/usage-store.js';
import { sendInThread, sendPlainInThread, editMessageText, sendTextInThread } from '../effects/discord-sender.js';
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
  thread: ThreadChannel;
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
  currentMessage: Message | null;
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
 * Throttled update of streaming text to Discord
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

const STREAM_MAX_LEN = 2000;

/**
 * Formats streaming text (shows the tail when exceeding Discord's limit)
 */
function formatStreamingText(text: string): string {
  if (text.length <= STREAM_MAX_LEN) return text;
  return '…' + text.slice(-(STREAM_MAX_LEN - 1));
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
  const displayText = formatStreamingText(state.currentText);

  try {
    if (state.currentMessage) {
      await editMessageText(state.currentMessage, displayText);
    } else {
      state.currentMessage = await sendPlainInThread(deps.thread, displayText);
    }
  } catch (err) {
    log.error({ err }, 'Stream text update error');
  }
}

/**
 * Handles a single SDK message, forwarding it to the corresponding Discord Thread based on message type
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
  const { store, threadId, thread, cwd } = deps;

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
        if (text.length <= 2000 && streamState.currentMessage) {
          // Text is within 2000 chars, edit the stream message directly
          try {
            await editMessageText(streamState.currentMessage, text);
          } catch {
            // If editing fails, resend
            await sendTextInThread(thread, text);
          }
        } else {
          // Text exceeds 2000 chars or no stream message, delete stream message and send in segments
          if (streamState.currentMessage) {
            try {
              await streamState.currentMessage.delete();
            } catch {
              // Message may have already been deleted
            }
          }
          await sendTextInThread(thread, text);
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
        await sendInThread(thread, embed);
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
        await sendInThread(thread, embed);
      } else {
        log.warn({ threadId, error: truncate(result.text || '', 100) }, 'Error result received');
        const embed = buildErrorEmbed(result.text || 'An error occurred during execution');
        await sendInThread(thread, embed);
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
