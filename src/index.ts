import { config as loadEnv } from 'dotenv';
import { ChannelType, type ThreadChannel, type TextChannel } from 'discord.js';
import { parseConfig, validateConfig } from './config.js';
import type { SessionState, CompletedSessionRecord } from './types.js';
import { logger, printBanner, logStore } from './effects/logger.js';
import { truncate, formatDuration } from './modules/formatters.js';
import { normalizeChannelName } from './effects/channel-manager.js';
import { emptyTokenUsage } from './modules/token-usage.js';

const log = logger.child({ module: 'Bot' });
const claudeLog = logger.child({ module: 'Claude' });
import { StateStore } from './effects/state-store.js';
import { RateLimitStore } from './effects/rate-limit-store.js';
import { createInteractionHandler } from './handlers/interaction-handler.js';
import { startQuery } from './effects/claude-bridge.js';
import { createMessageHandler } from './handlers/stream-handler.js';
import { createCanUseTool } from './handlers/permission-handler.js';
import { buildErrorEmbed, buildWaitingInputEmbed, buildOrphanCleanupEmbed, buildIdleCleanupEmbed, buildQueueStartEmbed } from './modules/embeds.js';
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
import { getGitDiffSummary } from './effects/git-bridge.js';
import type { PlatformAdapter } from './platforms/types.js';
import { DiscordAdapter } from './platforms/discord/index.js';
import { SlackAdapter } from './platforms/slack/index.js';
import { WhatsAppAdapter } from './platforms/whatsapp/index.js';
import { WhatsAppSessionTracker } from './platforms/whatsapp/session-tracker.js';

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
  const summaryStore = new DailySummaryStore(config.dataDir);
  const recoveryStore = new SessionRecoveryStore(config.dataDir);
  const queueStore = new QueueStore(config.dataDir);
  const budgetStore = new BudgetStore(summaryStore);
  const templateStore = new TemplateStore(config.dataDir);
  const scheduleStore = new ScheduleStore(config.dataDir);

  // ─── Platform Adapters ────────────────────────────────
  const adapters: PlatformAdapter[] = [];
  let discordAdapter: DiscordAdapter | null = null;

  if (config.discordEnabled) {
    discordAdapter = new DiscordAdapter(config);
    adapters.push(discordAdapter);
  }

  let slackAdapter: SlackAdapter | null = null;
  if (config.slackEnabled) {
    slackAdapter = new SlackAdapter(config);
    adapters.push(slackAdapter);
  }

  let whatsappAdapter: WhatsAppAdapter | null = null;
  if (config.whatsappEnabled) {
    whatsappAdapter = new WhatsAppAdapter(config);
    adapters.push(whatsappAdapter);
  }

  if (adapters.length === 0) {
    log.fatal('No platforms enabled. Set at least one of DISCORD_ENABLED, SLACK_ENABLED, or WHATSAPP_ENABLED');
    process.exit(1);
  }

  // Use the first adapter as the primary (for operations that need a single adapter)
  const primaryAdapter = adapters[0];

  // Claude query launch function
  async function startClaudeQuery(session: SessionState, threadId: string): Promise<void> {
    // Determine which adapter owns this thread
    const adapter = getAdapterForThread(threadId);

    // Create message handler
    const messageHandler = createMessageHandler({
      store,
      threadId,
      adapter,
      cwd: session.cwd,
      streamUpdateIntervalMs: config.streamUpdateIntervalMs,
      usageStore,
      config,
    });

    // Create permission handler
    const canUseTool = createCanUseTool({
      store,
      threadId,
      adapter,
      cwd: session.cwd,
      approvalTimeoutMs: config.approvalTimeoutMs,
    });

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
          await adapter.sendRichMessage(threadId, embed);
          // @mention to notify the user
          const currentSession = store.getSession(threadId);
          if (currentSession?.userId) {
            try { await adapter.unarchiveThread(threadId); } catch { /* ignore */ }
            const errorNotification = currentSession.scheduleName
              ? `${adapter.mentionUser(currentSession.userId)} Scheduled task **${currentSession.scheduleName}** encountered an error.`
              : `${adapter.mentionUser(currentSession.userId)} An error occurred during task execution.`;
            await adapter.sendText(threadId, errorNotification);
          }
          await adapter.archiveThread(threadId);
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
                await adapter.sendRichMessage(threadId, buildGitSummaryEmbed(diff));
              }
            } catch {
              // Non-fatal — skip git summary
            }
          }

          // Budget warning (if >80% of any limit)
          const budgetWarnings = budgetStore.getWarnings(config);
          if (budgetWarnings.length > 0) {
            await adapter.sendRichMessage(threadId, buildBudgetWarningEmbed(budgetWarnings));
          }

          // Send waiting-for-input embed
          const waitEmbed = buildWaitingInputEmbed();
          await adapter.sendRichMessage(threadId, waitEmbed);
          // @mention to notify the user
          const currentSession = store.getSession(threadId);
          if (currentSession?.userId) {
            try { await adapter.unarchiveThread(threadId); } catch { /* ignore */ }
            const completionNotification = currentSession.scheduleName
              ? `${adapter.mentionUser(currentSession.userId)} Scheduled task **${currentSession.scheduleName}** completed. You can review results in this thread.`
              : `${adapter.mentionUser(currentSession.userId)} Task completed. You can continue asking in this Thread or use \`/stop\` to end.`;
            await adapter.sendText(threadId, completionNotification);
          }
        } catch {
          // Thread may no longer exist
        }

        // Process queue: start next valid queued session for this project
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
                const queueAdapter = getAdapterForThread(nextEntry.threadId);
                await queueAdapter.sendRichMessage(nextEntry.threadId, buildQueueStartEmbed(nextEntry.promptText));
                await queueAdapter.sendText(nextEntry.threadId, `${queueAdapter.mentionUser(nextEntry.userId)} Your queued task is now starting.`);
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

  // Helper: determine which adapter owns a thread ID
  function getAdapterForThread(threadId: string): PlatformAdapter {
    // WhatsApp thread IDs start with 'wa:'
    if (whatsappAdapter && WhatsAppSessionTracker.isWhatsAppThread(threadId)) return whatsappAdapter;
    // Slack thread IDs contain a colon (channelId:thread_ts)
    if (slackAdapter && threadId.includes(':')) return slackAdapter;
    // Default: Discord
    return primaryAdapter;
  }

  // ─── Initialize Discord ─────────────────────────────

  if (discordAdapter) {
    const client = discordAdapter.getClient();

    // Create interaction handler (Discord-specific, passes raw interactions to command handlers)
    const handler = createInteractionHandler({
      config,
      store,
      client,
      adapter: discordAdapter,
      startClaudeQuery,
      rateLimitStore,
      usageStore,
      summaryStore,
      recoveryStore,
      queueStore,
      budgetStore,
      templateStore,
      scheduleStore,
      logStore,
    });

    // Create Thread message handler (for follow-up questions)
    const threadMessageHandler = createThreadMessageHandler({
      config,
      store,
      adapter: discordAdapter,
      startClaudeQuery,
    });

    // Register handlers on the adapter
    discordAdapter.onCommand(async (pi) => {
      // Route through the raw Discord interaction handler
      await handler(pi.raw as import('discord.js').Interaction);
    });

    discordAdapter.onButtonClick(async (pi) => {
      await handler(pi.raw as import('discord.js').Interaction);
    });

    discordAdapter.onThreadMessage(async (pi) => {
      await threadMessageHandler(pi);
    });

    // Initialize Discord adapter (login)
    await discordAdapter.initialize();

    // ─── Session Recovery: notify users about interrupted sessions ───
    const recoverableSessions = recoveryStore.getRecoverableSessions();
    if (recoverableSessions.length > 0) {
      log.info({ count: recoverableSessions.length }, 'Found interrupted sessions to recover');
      for (const recSession of recoverableSessions) {
        try {
          const embed = buildRecoveryEmbed(recSession.promptText, recSession.cwd, recSession.startedAt);
          // Use discord-sender for recovery button (platform-specific feature)
          const { sendEmbedWithRecoveryButton } = await import('./effects/discord-sender.js');
          const { richMessageToEmbed } = await import('./platforms/discord/converter.js');
          const channel = await client.channels.fetch(recSession.threadId);
          if (channel?.isThread()) {
            const thread = channel as ThreadChannel;
            await sendEmbedWithRecoveryButton(thread, richMessageToEmbed(embed), recSession.threadId);
            await discordAdapter!.sendText(recSession.threadId, `${discordAdapter!.mentionUser(recSession.userId)} This session was interrupted by a bot restart. Click **Retry** to re-run.`);
          }
        } catch {
          // Thread may no longer exist
        }
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
                  await discordAdapter!.sendRichMessage(thread.id, buildOrphanCleanupEmbed());
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

    // Start daily summary scheduler (Discord-specific for now)
    startSummaryScheduler(client, config, summaryStore);

    // Start schedule runner (checks every 60s for due scheduled prompts)
    startScheduleRunner({
      client,
      config,
      store,
      scheduleStore,
      budgetStore,
      startClaudeQuery,
    });
  }

  // ─── Initialize Slack ──────────────────────────────

  if (slackAdapter) {
    // Create Thread message handler for Slack
    const slackThreadMessageHandler = createThreadMessageHandler({
      config,
      store,
      adapter: slackAdapter,
      startClaudeQuery,
    });

    slackAdapter.onThreadMessage(async (pi) => {
      await slackThreadMessageHandler(pi);
    });

    // Button interactions (approve/deny/always-allow) are handled via the adapter
    slackAdapter.onButtonClick(async (pi) => {
      if (!pi.actionId) return;

      // Route approval buttons
      if (pi.actionId.startsWith('approve:') || pi.actionId.startsWith('deny:') || pi.actionId.startsWith('always_allow:')) {
        const prefix = pi.actionId.split(':')[0] + ':';
        const threadId = pi.actionId.slice(prefix.length);
        const session = store.getSession(threadId);
        const pending = store.getPendingApproval(threadId);

        if (!pending) return;
        if (session && session.userId !== pi.userId) return;

        if (pi.actionId.startsWith('approve:')) {
          store.resolvePendingApproval(threadId, { behavior: 'allow', updatedInput: pending.toolInput });
        } else if (pi.actionId.startsWith('always_allow:')) {
          store.addAllowedTool(threadId, pending.toolName);
          store.resolvePendingApproval(threadId, { behavior: 'allow', updatedInput: pending.toolInput });
        } else {
          store.resolvePendingApproval(threadId, { behavior: 'deny', message: 'User denied via button' });
        }
        return;
      }

      // AskUserQuestion buttons
      if (pi.actionId.startsWith('ask:') || pi.actionId.startsWith('ask_submit:') || pi.actionId.startsWith('ask_other:')) {
        // For now, these are handled the same way as Discord through the pending approval mechanism
        // Full AskUserQuestion support for Slack can be expanded later
        return;
      }
    });

    // Slash commands are mapped to the unified command interface
    slackAdapter.onCommand(async (pi) => {
      if (!pi.commandName) return;
      // For now, slash commands require the interaction handler which is Discord-specific.
      // Basic /claude-prompt support:
      if (pi.commandName === 'prompt') {
        const text = (pi.commandArgs?.text as string) ?? '';
        if (!text) {
          await slackAdapter!.replyEphemeral(pi, 'Please provide a prompt text.');
          return;
        }

        // Create a thread for this prompt
        const raw = pi.raw as { channel_id?: string };
        const channelId = raw.channel_id ?? '';
        if (!channelId) return;

        const threadId = await slackAdapter!.createThread(channelId, truncate(text, 60));

        const abortController = new AbortController();
        const session: SessionState = {
          sessionId: null,
          status: 'running',
          threadId,
          userId: pi.userId,
          startedAt: new Date(),
          lastActivityAt: new Date(),
          promptText: text,
          cwd: config.defaultCwd,
          model: config.defaultModel,
          toolCount: 0,
          tools: {},
          pendingApproval: null,
          abortController,
          transcript: [{ timestamp: new Date(), type: 'user', content: text.slice(0, 2000) }],
          allowedTools: new Set(),
        };

        store.setSession(threadId, session);
        const { buildSessionStartEmbed } = await import('./modules/embeds.js');
        await slackAdapter!.sendRichMessage(threadId, buildSessionStartEmbed(text, config.defaultCwd, config.defaultModel));

        startClaudeQuery(session, threadId).catch(async (error) => {
          log.error({ err: error, threadId }, 'Slack prompt error');
          store.clearSession(threadId);
        });
      } else if (pi.commandName === 'stop') {
        // Find active session in the channel context
        await slackAdapter!.replyEphemeral(pi, 'Use /claude-stop in a thread to stop a running session.');
      } else if (pi.commandName === 'status') {
        const sessions = store.getAllActiveSessions();
        const count = sessions.size;
        await slackAdapter!.replyEphemeral(pi, `Active sessions: ${count}`);
      }
    });

    await slackAdapter.initialize();
  }

  // ─── Initialize WhatsApp ──────────────────────────

  if (whatsappAdapter) {
    const waSessionTracker = whatsappAdapter.getSessionTracker();

    // Create Thread message handler for WhatsApp
    const waThreadHandler = createThreadMessageHandler({
      config,
      store,
      adapter: whatsappAdapter,
      startClaudeQuery,
    });

    whatsappAdapter.onThreadMessage(async (pi) => {
      await waThreadHandler(pi);
    });

    // Button interactions (numbered replies for approve/deny)
    whatsappAdapter.onButtonClick(async (pi) => {
      if (!pi.actionId) return;

      if (pi.actionId.startsWith('approve:') || pi.actionId.startsWith('deny:') || pi.actionId.startsWith('always_allow:')) {
        const prefix = pi.actionId.split(':')[0] + ':';
        const threadId = pi.actionId.slice(prefix.length);
        const session = store.getSession(threadId);
        const pending = store.getPendingApproval(threadId);

        if (!pending) return;
        if (session && session.userId !== pi.userId) return;

        if (pi.actionId.startsWith('approve:')) {
          store.resolvePendingApproval(threadId, { behavior: 'allow', updatedInput: pending.toolInput });
          await whatsappAdapter!.sendText(threadId, 'Approved');
        } else if (pi.actionId.startsWith('always_allow:')) {
          store.addAllowedTool(threadId, pending.toolName);
          store.resolvePendingApproval(threadId, { behavior: 'allow', updatedInput: pending.toolInput });
          await whatsappAdapter!.sendText(threadId, `Always allowed: ${pending.toolName}`);
        } else {
          store.resolvePendingApproval(threadId, { behavior: 'deny', message: 'User denied' });
          await whatsappAdapter!.sendText(threadId, 'Denied');
        }
        return;
      }
    });

    // Text commands (/prompt, /stop, /status)
    whatsappAdapter.onCommand(async (pi) => {
      if (!pi.commandName) return;

      if (pi.commandName === 'prompt') {
        const text = (pi.commandArgs?.text as string) ?? '';
        if (!text) {
          await whatsappAdapter!.sendText(pi.threadId, 'Please provide a prompt. Example: /prompt fix the bug in app.ts');
          return;
        }

        const chatId = WhatsAppSessionTracker.extractChatId(pi.threadId);
        const threadId = waSessionTracker.createSession(chatId);

        const abortController = new AbortController();
        const session: SessionState = {
          sessionId: null,
          status: 'running',
          threadId,
          userId: pi.userId,
          startedAt: new Date(),
          lastActivityAt: new Date(),
          promptText: text,
          cwd: config.defaultCwd,
          model: config.defaultModel,
          toolCount: 0,
          tools: {},
          pendingApproval: null,
          abortController,
          transcript: [{ timestamp: new Date(), type: 'user', content: text.slice(0, 2000) }],
          allowedTools: new Set(),
        };

        store.setSession(threadId, session);
        const { buildSessionStartEmbed } = await import('./modules/embeds.js');
        await whatsappAdapter!.sendRichMessage(threadId, buildSessionStartEmbed(text, config.defaultCwd, config.defaultModel));

        startClaudeQuery(session, threadId).catch(async (error) => {
          log.error({ err: error, threadId }, 'WhatsApp prompt error');
          store.clearSession(threadId);
          waSessionTracker.removeSession(chatId);
        });
      } else if (pi.commandName === 'stop') {
        const chatId = WhatsAppSessionTracker.extractChatId(pi.threadId);
        const activeThreadId = waSessionTracker.getActiveThreadId(chatId);
        if (activeThreadId) {
          const session = store.getSession(activeThreadId);
          if (session) {
            session.abortController.abort();
            store.clearSession(activeThreadId);
            waSessionTracker.removeSession(chatId);
            await whatsappAdapter!.sendText(pi.threadId, 'Session stopped.');
          }
        } else {
          await whatsappAdapter!.sendText(pi.threadId, 'No active session to stop.');
        }
      } else if (pi.commandName === 'status') {
        const chatId = WhatsAppSessionTracker.extractChatId(pi.threadId);
        const activeThreadId = waSessionTracker.getActiveThreadId(chatId);
        if (activeThreadId) {
          const session = store.getSession(activeThreadId);
          await whatsappAdapter!.sendText(pi.threadId, `Session: ${session?.status ?? 'unknown'}`);
        } else {
          await whatsappAdapter!.sendText(pi.threadId, 'No active session.');
        }
      }
    });

    await whatsappAdapter.initialize();
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
  const CLEANUP_INTERVAL_MS = 60_000;
  const cleanupIntervalId = setInterval(async () => {
    const now = Date.now();
    const activeSessions = store.getAllActiveSessions();

    for (const [threadId, session] of activeSessions) {
      if (session.status !== 'waiting_input') continue;

      const idleMs = now - session.lastActivityAt.getTime();
      if (idleMs < config.sessionIdleTimeoutMs) continue;

      const freshSession = store.getSession(threadId);
      if (!freshSession || freshSession.status !== 'waiting_input') continue;

      try {
        const adapter = getAdapterForThread(threadId);
        await adapter.sendRichMessage(threadId, buildIdleCleanupEmbed(idleMs));
        if (freshSession.userId) {
          await adapter.sendText(threadId, `${adapter.mentionUser(freshSession.userId)} Session auto-archived due to inactivity.`);
        }
        await adapter.archiveThread(threadId);
      } catch {
        // Thread may have been deleted
      }
      const finalSession = store.getSession(threadId);
      if (finalSession && finalSession.status === 'waiting_input') {
        store.clearSession(threadId);
        log.info({ threadId, idleMs }, 'Auto-archived idle session');
      }
    }
  }, CLEANUP_INTERVAL_MS);

  const permName = ({ default: 'Default', plan: 'Plan', acceptEdits: 'Accept Edits', bypassPermissions: 'Bypass Permissions' } as Record<string, string>)[config.defaultPermissionMode] ?? config.defaultPermissionMode;
  const botTag = discordAdapter ? discordAdapter.getClient().user?.tag ?? 'Unknown' : 'N/A';

  // Startup banner
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
  const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
  const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
  const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
  const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

  const bannerLines = [
    '',
    bold('  Claude Bot') + dim('  v0.3.0 — Multi-Platform'),
    dim('  ─────────────────────────────────'),
    '',
  ];

  // Platform status
  if (config.discordEnabled) {
    bannerLines.push(`  ${green('●')} Discord     ${botTag}`);
  } else {
    bannerLines.push(`  ${dim('○')} Discord     ${dim('Disabled')}`);
  }
  if (config.slackEnabled) {
    bannerLines.push(`  ${green('●')} Slack       Connected`);
  } else {
    bannerLines.push(`  ${dim('○')} Slack       ${dim('Disabled')}`);
  }
  if (config.whatsappEnabled) {
    bannerLines.push(`  ${yellow('●')} WhatsApp    Waiting for QR`);
  } else {
    bannerLines.push(`  ${dim('○')} WhatsApp    ${dim('Disabled')}`);
  }

  bannerLines.push(`  ${claudeConnected ? green('●') : red('●')} Claude Code ${claudeConnected ? 'Connected' : 'Connection failed'}`);
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

    // Abort all active sessions
    const activeSessions = store.getAllActiveSessions();
    for (const [threadId, session] of activeSessions) {
      session.abortController.abort();
      store.clearSession(threadId);
    }

    // Shutdown all adapters
    for (const adapter of adapters) {
      adapter.shutdown().catch(() => {});
    }

    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  log.fatal({ err: error }, 'Startup failed');
  process.exit(1);
});
