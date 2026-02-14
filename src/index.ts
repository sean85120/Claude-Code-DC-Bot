import { config as loadEnv } from 'dotenv';
import { ChannelType, type ThreadChannel, type TextChannel } from 'discord.js';
import { parseConfig, validateConfig } from './config.js';
import type { SessionState } from './types.js';
import { logger, printBanner } from './effects/logger.js';
import { truncate, formatDuration } from './modules/formatters.js';
import { normalizeChannelName } from './effects/channel-manager.js';

const log = logger.child({ module: 'Bot' });
const claudeLog = logger.child({ module: 'Claude' });
import { StateStore } from './effects/state-store.js';
import { RateLimitStore } from './effects/rate-limit-store.js';
import { createDiscordClient, destroyDiscordClient } from './effects/discord-client.js';
import { createInteractionHandler } from './handlers/interaction-handler.js';
import { startQuery } from './effects/claude-bridge.js';
import { createMessageHandler } from './handlers/stream-handler.js';
import { createCanUseTool } from './handlers/permission-handler.js';
import { buildErrorEmbed, buildWaitingInputEmbed, buildOrphanCleanupEmbed, buildIdleCleanupEmbed } from './modules/embeds.js';
import { sendInThread, sendTextInThread } from './effects/discord-sender.js';
import { createThreadMessageHandler } from './handlers/thread-message-handler.js';
import { UsageStore } from './effects/usage-store.js';
import { checkClaudeStatus } from './effects/startup-check.js';

// Load .env
loadEnv();

async function main() {
  // Parse and validate config
  const config = parseConfig(process.env as Record<string, string | undefined>);
  const errors = validateConfig(config);

  if (errors.length > 0) {
    log.fatal({ errors }, 'Config validation failed');
    process.exit(1);
  }

  // Create state stores
  const store = new StateStore();
  const rateLimitStore = new RateLimitStore();
  const usageStore = new UsageStore();

  // Claude query launch function
  async function startClaudeQuery(session: SessionState, threadId: string): Promise<void> {
    // Get Thread
    const channel = await client.channels.fetch(threadId);
    if (!channel?.isThread()) {
      throw new Error('Unable to fetch Thread');
    }
    const thread = channel as ThreadChannel;

    // Create message handler
    const messageHandler = createMessageHandler({
      store,
      threadId,
      thread,
      cwd: session.cwd,
      streamUpdateIntervalMs: config.streamUpdateIntervalMs,
      usageStore,
    });

    // Create permission handler
    const canUseTool = createCanUseTool({
      store,
      threadId,
      thread,
      cwd: session.cwd,
      approvalTimeoutMs: config.approvalTimeoutMs,
    });

    // Start Claude query (supports resume + image attachments)
    claudeLog.info(
      { threadId, prompt: truncate(session.promptText, 60), model: session.model, cwd: session.cwd, resume: !!session.sessionId },
      'Query started',
    );
    const { sessionId } = await startQuery(session.promptText, {
      cwd: session.cwd,
      model: session.model,
      permissionMode: config.defaultPermissionMode,
      abortController: session.abortController,
      canUseTool,
      resume: session.sessionId ?? undefined,
      attachments: session.attachments,
      onMessage: (message) => {
        messageHandler(message);
      },
      onError: async (error) => {
        const s = store.getSession(threadId);
        claudeLog.error({ err: error, threadId, prompt: truncate(s?.promptText ?? '', 40) }, 'Execution error');
        try {
          const embed = buildErrorEmbed(error.message);
          await sendInThread(thread, embed);
          // @mention to notify the user
          const currentSession = store.getSession(threadId);
          if (currentSession?.userId) {
            if (thread.archived) await thread.setArchived(false);
            await thread.send(`<@${currentSession.userId}> An error occurred during task execution.`);
          }
          await thread.setArchived(true);
        } catch {
          // Thread may no longer exist
        }
        store.updateSession(threadId, { status: 'error' });
      },
      onComplete: async () => {
        const s = store.getSession(threadId);
        const elapsed = s ? Date.now() - s.startedAt.getTime() : 0;
        claudeLog.info({ threadId, prompt: truncate(s?.promptText ?? '', 40), duration: formatDuration(elapsed) }, 'Query completed');
        store.updateSession(threadId, { status: 'waiting_input' });

        try {
          // Send waiting-for-input Embed
          const waitEmbed = buildWaitingInputEmbed();
          await sendInThread(thread, waitEmbed);
          // @mention to notify the user
          const currentSession = store.getSession(threadId);
          if (currentSession?.userId) {
            if (thread.archived) await thread.setArchived(false);
            await thread.send(`<@${currentSession.userId}> Task completed. You can continue asking in this Thread or use \`/stop\` to end.`);
          }
        } catch {
          // Thread may no longer exist
        }
      },
    });

    if (sessionId) {
      store.updateSession(threadId, { sessionId });
    }
  }

  // Create interaction handler
  let client: Awaited<ReturnType<typeof createDiscordClient>>;

  const handler = createInteractionHandler({
    config,
    store,
    get client() {
      return client;
    },
    startClaudeQuery,
    rateLimitStore,
    usageStore,
  });

  // Create Thread message handler (for follow-up questions)
  const threadMessageHandler = createThreadMessageHandler({
    config,
    store,
    get client() {
      return client;
    },
    startClaudeQuery,
  });

  // Start Discord Client
  client = await createDiscordClient(config, handler, async (message) => {
    await threadMessageHandler(message);
  });

  // Clean up orphan Threads on startup (across all repo channels)
  try {
    const botId = client.user?.id;
    const channelIdsToClean = new Set<string>();

    // Always include the general channel
    channelIdsToClean.add(config.discordChannelId);

    // Discover repo-specific channels by matching project names
    try {
      const guild = await client.guilds.fetch(config.discordGuildId);
      const allChannels = await guild.channels.fetch();
      for (const project of config.projects) {
        const normalized = normalizeChannelName(project.name);
        if (!normalized) continue;
        const found = allChannels.find(
          (ch) => ch !== null && ch.type === ChannelType.GuildText && ch.name === normalized,
        );
        if (found) {
          channelIdsToClean.add(found.id);
        }
      }
    } catch (error) {
      log.warn({ err: error }, 'Failed to discover repo channels for cleanup (non-fatal)');
    }

    let cleaned = 0;
    for (const channelId of channelIdsToClean) {
      try {
        const channel = await client.channels.fetch(channelId);
        if (channel && 'threads' in channel) {
          const activeThreads = await (channel as TextChannel).threads.fetchActive();
          for (const [, thread] of activeThreads.threads) {
            if (thread.ownerId === botId && !store.getSession(thread.id)) {
              try {
                await sendInThread(thread, buildOrphanCleanupEmbed());
                await thread.setArchived(true);
                cleaned++;
              } catch {
                // Thread may have been deleted
              }
            }
          }
        }
      } catch {
        // Channel may have been deleted
      }
    }

    if (cleaned > 0) {
      log.info({ cleaned }, 'Cleaned up orphan Threads');
    }
  } catch (error) {
    log.warn({ err: error }, 'Failed to clean up orphan Threads (non-fatal)');
  }

  // Check Claude Code connection on startup
  let claudeConnected = false;
  let claudeAccount = '';
  let claudeSubscription = '';
  let claudeModels = '';
  let claudeError = '';
  try {
    const status = await checkClaudeStatus(config.defaultCwd);
    if (status.success) {
      claudeConnected = true;
      claudeAccount = status.accountInfo?.email ?? '';
      claudeSubscription = status.accountInfo?.subscriptionType ?? '';
      if (status.models?.length) {
        claudeModels = status.models.map((m) => m.displayName).join(', ');
      }
    } else {
      claudeError = status.error ?? 'Unknown error';
    }
  } catch (err) {
    claudeError = err instanceof Error ? err.message : String(err);
  }

  // Periodic cleanup of idle waiting_input sessions
  const CLEANUP_INTERVAL_MS = 60_000; // Check every minute
  setInterval(async () => {
    const now = Date.now();
    const activeSessions = store.getAllActiveSessions();

    for (const [threadId, session] of activeSessions) {
      if (session.status !== 'waiting_input') continue;

      const idleMs = now - session.lastActivityAt.getTime();
      if (idleMs < config.sessionIdleTimeoutMs) continue;

      try {
        const channel = await client.channels.fetch(threadId);
        if (channel?.isThread()) {
          const thread = channel as ThreadChannel;
          await sendInThread(thread, buildIdleCleanupEmbed(idleMs));
          if (session.userId) {
            await sendTextInThread(thread, `<@${session.userId}> Session auto-archived due to inactivity.`);
          }
          await thread.setArchived(true);
        }
      } catch {
        // Thread may have been deleted
      }
      store.clearSession(threadId);
      log.info({ threadId, idleMs }, 'Auto-archived idle session');
    }
  }, CLEANUP_INTERVAL_MS);

  const permName = ({ default: 'Default', plan: 'Plan', acceptEdits: 'Accept Edits', bypassPermissions: 'Bypass Permissions' } as Record<string, string>)[config.defaultPermissionMode] ?? config.defaultPermissionMode;
  const botTag = client.user?.tag ?? 'Unknown';

  // Startup banner
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
  const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
  const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
  const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

  const bannerLines = [
    '',
    bold('  Discord Claude Bot') + dim('  v0.1.0'),
    dim('  ─────────────────────────────────'),
    '',
    `  ${green('●')} Discord     ${botTag}`,
    `  ${claudeConnected ? green('●') : red('●')} Claude Code ${claudeConnected ? 'Connected' : 'Connection failed'}`,
  ];
  if (claudeError) bannerLines.push(`               ${dim(claudeError)}`);
  bannerLines.push('');
  if (claudeAccount) bannerLines.push(`  ${dim('Account')}    ${claudeAccount}`);
  if (claudeSubscription) bannerLines.push(`  ${dim('Plan')}    ${claudeSubscription}`);
  if (claudeModels) bannerLines.push(`  ${dim('Models')}    ${claudeModels}`);
  if (claudeAccount || claudeSubscription || claudeModels) bannerLines.push('');
  bannerLines.push(`  ${dim('Default Model')}  ${config.defaultModel}`);
  bannerLines.push(`  ${dim('Permission Mode')}  ${permName}`);
  if (config.defaultCwd) bannerLines.push(`  ${dim('Working Dir')}  ${config.defaultCwd}`);
  bannerLines.push(`  ${dim('Projects')}  ${config.projects.length} (${config.projects.map((p) => p.name).join(', ')})`);
  bannerLines.push('');
  bannerLines.push(`  ${cyan('Ready, awaiting commands.')}`);
  bannerLines.push('');
  printBanner(bannerLines);

  // Graceful shutdown
  function shutdown() {
    log.info('Shutdown signal received, shutting down...');

    // Abort all active sessions
    const activeSessions = store.getAllActiveSessions();
    for (const [threadId, session] of activeSessions) {
      session.abortController.abort();
      store.clearSession(threadId);
    }

    destroyDiscordClient(client);
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  log.fatal({ err: error }, 'Startup failed');
  process.exit(1);
});
