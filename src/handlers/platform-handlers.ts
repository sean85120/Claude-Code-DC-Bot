import type { SessionState } from '../types.js';
import type { PlatformAdapter, PlatformInteraction, PlatformType } from '../platforms/types.js';
import type { StateStore } from '../effects/state-store.js';
import type { BotConfig } from '../types.js';
import { buildSessionStartEmbed } from '../modules/embeds.js';
import { isUserAuthorized } from '../modules/permissions.js';
import { logger } from '../effects/logger.js';

const log = logger.child({ module: 'PlatformHandlers' });

/**
 * Handle approval button interactions (approve/deny/always_allow) in a platform-agnostic way.
 * Returns true if the interaction was handled, false if it wasn't an approval button.
 */
export function handleApprovalButton(
  pi: PlatformInteraction,
  store: StateStore,
): boolean {
  const actionId = pi.actionId;
  if (!actionId) return false;

  const prefixes = ['approve:', 'deny:', 'always_allow:'];
  const matchedPrefix = prefixes.find((p) => actionId.startsWith(p));
  if (!matchedPrefix) return false;

  const threadId = actionId.slice(matchedPrefix.length);
  const session = store.getSession(threadId);
  const pending = store.getPendingApproval(threadId);

  if (!pending) return true;
  if (session && session.userId !== pi.userId) return true;

  if (matchedPrefix === 'approve:') {
    store.resolvePendingApproval(threadId, { behavior: 'allow', updatedInput: pending.toolInput });
  } else if (matchedPrefix === 'always_allow:') {
    log.info({ threadId, tool: pending.toolName, userId: pi.userId }, 'Always-allow granted');
    store.addAllowedTool(threadId, pending.toolName);
    store.resolvePendingApproval(threadId, { behavior: 'allow', updatedInput: pending.toolInput });
  } else {
    store.resolvePendingApproval(threadId, { behavior: 'deny', message: 'User denied via button' });
  }

  return true;
}

/**
 * Create a new session from a prompt command, common across all platforms.
 */
export async function createSessionFromPrompt(opts: {
  adapter: PlatformAdapter;
  platform: PlatformType;
  store: StateStore;
  config: BotConfig;
  threadId: string;
  userId: string;
  promptText: string;
  startClaudeQuery: (session: SessionState, threadId: string) => Promise<void>;
}): Promise<void> {
  const { adapter, platform, store, config, threadId, userId, promptText, startClaudeQuery } = opts;

  const abortController = new AbortController();
  const session: SessionState = {
    sessionId: null,
    platform,
    status: 'running',
    threadId,
    userId,
    startedAt: new Date(),
    lastActivityAt: new Date(),
    promptText,
    cwd: config.defaultCwd,
    model: config.defaultModel,
    toolCount: 0,
    tools: {},
    pendingApproval: null,
    abortController,
    transcript: [{ timestamp: new Date(), type: 'user', content: promptText.slice(0, 2000) }],
    allowedTools: new Set(),
  };

  store.setSession(threadId, session);

  const startEmbed = buildSessionStartEmbed(promptText, config.defaultCwd, config.defaultModel);
  await adapter.sendRichMessage(threadId, startEmbed);

  startClaudeQuery(session, threadId).catch(async (error) => {
    log.error({ err: error, threadId, platform }, 'Prompt session error');
    store.clearSession(threadId);
  });
}

/**
 * Check if a user is authorized to use bot commands.
 * For Slack, checks against allowedUserIds.
 * For WhatsApp, the adapter already checks allowed numbers.
 */
export function checkCommandAuth(
  userId: string,
  config: BotConfig,
): boolean {
  return isUserAuthorized(userId, config.allowedUserIds);
}
