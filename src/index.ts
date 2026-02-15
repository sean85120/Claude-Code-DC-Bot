import { config as loadEnv } from 'dotenv';
import { ChannelType, type ThreadChannel, type TextChannel } from 'discord.js';
import { parseConfig, validateConfig } from './config.js';
import type { SessionState, CompletedSessionRecord } from './types.js';
import { logger, printBanner } from './effects/logger.js';
import { truncate, formatDuration } from './modules/formatters.js';
import { normalizeChannelName } from './effects/channel-manager.js';
import { emptyTokenUsage } from './modules/token-usage.js';

const log = logger.child({ module: 'Bot' });
const claudeLog = logger.child({ module: 'Claude' });
import { StateStore } from './effects/state-store.js';
import { RateLimitStore } from './effects/rate-limit-store.js';
import { createDiscordClient, destroyDiscordClient } from './effects/discord-client.js';
import { createInteractionHandler } from './handlers/interaction-handler.js';
import { startQuery } from './effects/claude-bridge.js';
import { createMessageHandler } from './handlers/stream-handler.js';
import { createCanUseTool } from './handlers/permission-handler.js';
import { buildErrorEmbed, buildWaitingInputEmbed, buildOrphanCleanupEmbed, buildIdleCleanupEmbed, buildQueueStartEmbed } from './modules/embeds.js';
import { sendInThread, sendTextInThread } from './effects/discord-sender.js';
import { createThreadMessageHandler } from './handlers/thread-message-handler.js';
import { UsageStore } from './effects/usage-store.js';
import { checkClaudeStatus } from './effects/startup-check.js';
import { DailySummaryStore } from './effects/daily-summary-store.js';
import { SessionRecoveryStore } from './effects/session-recovery-store.js';
import { QueueStore } from './effects/queue-store.js';
import { BudgetStore } from './effects/budget-store.js';
import { TemplateStore } from './effects/template-store.js';
import { ScheduleStore } from './effects/schedule-store.js';
import { startSummaryScheduler } from './handlers/summary-scheduler.js';
import { startScheduleRunner } from './handlers/schedule-runner.js';
import { buildRecoveryEmbed, buildGitSummaryEmbed, buildBudgetWarningEmbed } from './modules/embeds.js';
import { sendEmbedWithRecoveryButton } from './effects/discord-sender.js';
import { getGitDiffSummary } from './effects/git-bridge.js';

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
  const summaryStore = new DailySummaryStore();
  const recoveryStore = new SessionRecoveryStore();
  const queueStore = new QueueStore();
  const budgetStore = new BudgetStore(summaryStore);
  const templateStore = new TemplateStore();
  const scheduleStore = new ScheduleStore();

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
      config,
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
    // Persist session for recovery
    recoveryStore.persist(session);

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
        recoveryStore.remove(threadId);
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
        recoveryStore.remove(threadId);
        const s = store.getSession(threadId);
        const elapsed = s ? Date.now() - s.startedAt.getTime() : 0;
        claudeLog.info({ threadId, prompt: truncate(s?.promptText ?? '', 40), duration: formatDuration(elapsed) }, 'Query completed');

        // Record completed session in daily summary store
        if (s) {
          const sessionUsage = usageStore.getSessionUsage(threadId);
          const projectInfo = config.projects.find((p) => p.path === s.cwd) ?? {
            name: 'Unknown',
            path: s.cwd,
          };
          const completedRecord: CompletedSessionRecord = {
            threadId,
            userId: s.userId,
            projectName: projectInfo.name,
            projectPath: projectInfo.path,
            promptText: s.promptText,
            startedAt: s.startedAt.toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: elapsed,
            toolCount: s.toolCount,
            usage: sessionUsage?.usage ?? emptyTokenUsage(),
            costUsd: sessionUsage?.costUsd ?? 0,
            model: s.model,
          };
          summaryStore.recordCompletedSession(completedRecord);
        }

        store.updateSession(threadId, { status: 'waiting_input' });

        try {
          // Git diff summary (if enabled)
          if (config.showGitSummary && s) {
            try {
              const diff = await getGitDiffSummary(s.cwd);
              if (diff && diff.filesChanged > 0) {
                await sendInThread(thread, buildGitSummaryEmbed(diff));
              }
            } catch {
              // Non-fatal — skip git summary
            }
          }

          // Budget warning (if >80% of any limit)
          const budgetWarnings = budgetStore.getWarnings(config);
          if (budgetWarnings.length > 0) {
            await sendInThread(thread, buildBudgetWarningEmbed(budgetWarnings));
          }

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

        // Process queue: start next valid queued session for this project
        // Loop to skip entries that were cancelled via /stop while queued (#1)
        if (s) {
          let nextEntry = queueStore.dequeue(s.cwd);
          while (nextEntry) {
            const queuedSession = store.getSession(nextEntry.threadId);
            if (queuedSession && queuedSession.status === 'queued') {
              store.updateSession(nextEntry.threadId, {
                status: 'running',
                abortController: new AbortController(),
              });

              log.info({ threadId: nextEntry.threadId, cwd: s.cwd, prompt: truncate(nextEntry.promptText, 40) }, 'Starting queued session');

              // Send "your turn" notification in the queued thread
              try {
                const queuedChannel = await client.channels.fetch(nextEntry.threadId);
                if (queuedChannel?.isThread()) {
                  const queuedThread = queuedChannel as ThreadChannel;
                  await sendInThread(queuedThread, buildQueueStartEmbed(nextEntry.promptText));
                  await sendTextInThread(queuedThread, `<@${nextEntry.userId}> Your queued task is now starting.`);
                }
              } catch {
                // Thread may no longer exist
              }

              const updatedSession = store.getSession(nextEntry.threadId);
              if (updatedSession) {
                startClaudeQuery(updatedSession, nextEntry.threadId).catch(async (error) => {
                  claudeLog.error({ err: error, threadId: nextEntry!.threadId }, 'Queued session error');
                  store.clearSession(nextEntry!.threadId);
                });
              }
              break;
            }
            // Entry was cancelled or invalid — try the next one
            nextEntry = queueStore.dequeue(s.cwd);
          }
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
    summaryStore,
    recoveryStore,
    queueStore,
    budgetStore,
    templateStore,
    scheduleStore,
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

  // ─── Session Recovery: notify users about interrupted sessions ───
  const recoverableSessions = recoveryStore.getRecoverableSessions();
  if (recoverableSessions.length > 0) {
    log.info({ count: recoverableSessions.length }, 'Found interrupted sessions to recover');
    for (const recSession of recoverableSessions) {
      try {
        const channel = await client.channels.fetch(recSession.threadId);
        if (channel?.isThread()) {
          const thread = channel as ThreadChannel;
          const embed = buildRecoveryEmbed(recSession.promptText, recSession.cwd, recSession.startedAt);
          await sendEmbedWithRecoveryButton(thread, embed, recSession.threadId);
          await sendTextInThread(thread, `<@${recSession.userId}> This session was interrupted by a bot restart. Click **Retry** to re-run.`);
        }
      } catch {
        // Thread may no longer exist
      }
      // Clear per-session after notification attempt (even if thread is gone)
      recoveryStore.remove(recSession.threadId);
    }
  }

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
  const cleanupIntervalId = setInterval(async () => {
    const now = Date.now();
    const activeSessions = store.getAllActiveSessions();

    for (const [threadId, session] of activeSessions) {
      if (session.status !== 'waiting_input') continue;

      const idleMs = now - session.lastActivityAt.getTime();
      if (idleMs < config.sessionIdleTimeoutMs) continue;

      // Re-check live status before any Discord I/O — a follow-up may have arrived
      const freshSession = store.getSession(threadId);
      if (!freshSession || freshSession.status !== 'waiting_input') continue;

      try {
        const channel = await client.channels.fetch(threadId);
        if (channel?.isThread()) {
          const thread = channel as ThreadChannel;
          await sendInThread(thread, buildIdleCleanupEmbed(idleMs));
          if (freshSession.userId) {
            await sendTextInThread(thread, `<@${freshSession.userId}> Session auto-archived due to inactivity.`);
          }
          await thread.setArchived(true);
        }
      } catch {
        // Thread may have been deleted
      }
      // Final re-check before clearing (belt-and-suspenders)
      const finalSession = store.getSession(threadId);
      if (finalSession && finalSession.status === 'waiting_input') {
        store.clearSession(threadId);
        log.info({ threadId, idleMs }, 'Auto-archived idle session');
      }
    }
  }, CLEANUP_INTERVAL_MS);

  // Start daily summary scheduler
  const summaryScheduler = startSummaryScheduler(client, config, summaryStore);

  // Start schedule runner (checks every 60s for due scheduled prompts)
  const scheduleRunner = startScheduleRunner({
    client,
    config,
    store,
    scheduleStore,
    budgetStore,
    startClaudeQuery,
  });

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
  bannerLines.push(`  ${dim('Daily Summary')}  ${config.summaryEnabled ? `Enabled (${config.summaryHourUtc}:00 UTC → #${config.summaryChannelName})` : 'Disabled'}`);
  bannerLines.push('');
  bannerLines.push(`  ${cyan('Ready, awaiting commands.')}`);
  bannerLines.push('');
  printBanner(bannerLines);

  // Graceful shutdown
  function shutdown() {
    log.info('Shutdown signal received, shutting down...');

    clearInterval(cleanupIntervalId);
    summaryScheduler.cancel();
    scheduleRunner.cancel();

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
