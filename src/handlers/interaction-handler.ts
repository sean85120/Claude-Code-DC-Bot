import { MessageFlags, type Interaction, type Client, type ThreadChannel } from 'discord.js';
import type { BotConfig, SessionState } from '../types.js';
import type { StateStore } from '../effects/state-store.js';
import * as statusCmd from '../commands/status.js';
import * as stopCmd from '../commands/stop.js';
import * as promptCmd from '../commands/prompt.js';
import * as historyCmd from '../commands/history.js';
import * as retryCmd from '../commands/retry.js';
import * as settingsCmd from '../commands/settings.js';
import * as reposCmd from '../commands/repos.js';
import type { RateLimitStore } from '../effects/rate-limit-store.js';
import type { UsageStore } from '../effects/usage-store.js';
import type { DailySummaryStore } from '../effects/daily-summary-store.js';
import * as summaryCmd from '../commands/summary.js';
import * as budgetCmd from '../commands/budget.js';
import * as templateCmd from '../commands/template.js';
import * as scheduleCmd from '../commands/schedule.js';
import * as logsCmd from '../commands/logs.js';
import {
  handleAskOptionClick,
  handleAskSubmit,
  handleAskOther,
  handleAskModalSubmit,
} from './ask-handler.js';
import type { SessionRecoveryStore } from '../effects/session-recovery-store.js';
import type { QueueStore } from '../effects/queue-store.js';
import type { BudgetStore } from '../effects/budget-store.js';
import type { TemplateStore } from '../effects/template-store.js';
import type { ScheduleStore } from '../effects/schedule-store.js';
import type { LogStore } from '../effects/log-store.js';
import { sendInThread, sendTextInThread } from '../effects/discord-sender.js';
import { buildSessionStartEmbed, buildErrorEmbed } from '../modules/embeds.js';
import { truncate } from '../modules/formatters.js';
import { canExecuteCommand, isAllowedCwd } from '../modules/permissions.js';
import { logger } from '../effects/logger.js';

const log = logger.child({ module: 'Interaction' });

/** Dependency injection interface for the interaction handler */
export interface InteractionHandlerDeps {
  config: BotConfig;
  store: StateStore;
  client: Client;
  startClaudeQuery: (session: SessionState, threadId: string) => Promise<void>;
  rateLimitStore: RateLimitStore;
  usageStore: UsageStore;
  summaryStore: DailySummaryStore;
  recoveryStore?: SessionRecoveryStore;
  queueStore?: QueueStore;
  budgetStore?: BudgetStore;
  templateStore?: TemplateStore;
  scheduleStore?: ScheduleStore;
  logStore: LogStore;
}

/**
 * Creates the interaction handler, routing Slash Commands, Button, and Modal interactions to the corresponding logic
 *
 * @param deps - Dependencies required by the interaction handler
 * @returns An async function that handles Discord interaction events
 */
export function createInteractionHandler(deps: InteractionHandlerDeps) {
  const askDeps = { store: deps.store };

  return async function handleInteraction(interaction: Interaction): Promise<void> {
    // Slash Commands
    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case 'prompt':
          await promptCmd.execute(
            interaction,
            deps.config,
            deps.store,
            deps.startClaudeQuery,
            deps.rateLimitStore,
            deps.client,
            deps.queueStore,
            deps.budgetStore,
          );
          break;

        case 'stop':
          await stopCmd.execute(interaction, deps.config, deps.store, deps.client);
          break;

        case 'status':
          await statusCmd.execute(interaction, deps.config, deps.store, deps.usageStore, deps.queueStore);
          break;

        case 'history':
          await historyCmd.execute(interaction, deps.config, deps.store);
          break;

        case 'retry':
          await retryCmd.execute(interaction, deps.config, deps.store, deps.startClaudeQuery);
          break;

        case 'settings':
          await settingsCmd.execute(interaction, deps.config);
          break;

        case 'repos':
          await reposCmd.execute(interaction, deps.config, deps.client);
          break;

        case 'summary':
          await summaryCmd.execute(interaction, deps.config, deps.summaryStore, deps.client);
          break;

        case 'budget':
          if (deps.budgetStore) {
            await budgetCmd.execute(interaction, deps.config, deps.budgetStore);
          }
          break;

        case 'template':
          if (deps.templateStore) {
            await templateCmd.execute(
              interaction,
              deps.config,
              deps.store,
              deps.templateStore,
              deps.startClaudeQuery,
              deps.client,
              deps.queueStore,
              deps.budgetStore,
            );
          }
          break;

        case 'schedule':
          if (deps.scheduleStore) {
            await scheduleCmd.execute(interaction, deps.config, deps.scheduleStore);
          }
          break;

        case 'logs':
          await logsCmd.execute(interaction, deps.config, deps.logStore);
          break;

        default:
          await interaction.reply({
            content: '❌ Unknown command',
            flags: [MessageFlags.Ephemeral],
          });
      }
      return;
    }

    // Button interactions
    if (interaction.isButton()) {
      const { customId } = interaction;

      if (customId.startsWith('approve:')) {
        const threadId = customId.slice('approve:'.length);
        const pending = deps.store.getPendingApproval(threadId);

        if (!pending) {
          await interaction.reply({ content: '⚠️ This request has expired', flags: [MessageFlags.Ephemeral] });
          return;
        }

        deps.store.resolvePendingApproval(threadId, {
          behavior: 'allow',
          updatedInput: pending.toolInput,
        });

        await interaction.reply({ content: '✅ Approved', flags: [MessageFlags.Ephemeral] });
        return;
      }

      if (customId.startsWith('deny:')) {
        const threadId = customId.slice('deny:'.length);
        const pending = deps.store.getPendingApproval(threadId);

        if (!pending) {
          await interaction.reply({ content: '⚠️ This request has expired', flags: [MessageFlags.Ephemeral] });
          return;
        }

        deps.store.resolvePendingApproval(threadId, {
          behavior: 'deny',
          message: 'User denied via button',
        });

        await interaction.reply({ content: '❌ Denied', flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Confirm stop
      if (customId.startsWith('confirm_stop:')) {
        const threadId = customId.slice('confirm_stop:'.length);
        const session = deps.store.getSession(threadId);

        if (!session) {
          await interaction.reply({ content: '⚠️ This task has ended', flags: [MessageFlags.Ephemeral] });
          return;
        }

        await interaction.reply({ content: '🛑 Task has been stopped', flags: [MessageFlags.Ephemeral] });
        await stopCmd.executeStop(threadId, deps.store, deps.client, deps.queueStore);
        return;
      }

      // Cancel stop
      if (customId.startsWith('cancel_stop:')) {
        await interaction.reply({ content: '✅ Stop cancelled', flags: [MessageFlags.Ephemeral] });
        return;
      }

      // Recovery retry — re-run interrupted session prompt
      if (customId.startsWith('recovery_retry:')) {
        const threadId = customId.slice('recovery_retry:'.length);

        // Authorization check (#3)
        const auth = canExecuteCommand(interaction.user.id, deps.config);
        if (!auth.allowed) {
          await interaction.reply({ content: `❌ ${auth.reason}`, flags: [MessageFlags.Ephemeral] });
          return;
        }

        // Verify thread exists and is a thread
        try {
          const channel = await deps.client.channels.fetch(threadId);
          if (!channel?.isThread()) {
            await interaction.reply({ content: '⚠️ Thread no longer exists', flags: [MessageFlags.Ephemeral] });
            return;
          }
          const thread = channel as ThreadChannel;

          // Check no active session in this thread (running, awaiting_permission, or waiting_input)
          const existingSession = deps.store.getSession(threadId);
          if (existingSession && (existingSession.status === 'running' || existingSession.status === 'awaiting_permission' || existingSession.status === 'waiting_input')) {
            await interaction.reply({ content: '⚠️ A session is already active in this thread', flags: [MessageFlags.Ephemeral] });
            return;
          }

          // We need the original prompt info from the button message embed
          const message = interaction.message;
          const embed = message?.embeds?.[0];
          const promptText = embed?.description || 'Retry interrupted session';
          const cwdField = embed?.fields?.find((f) => f.name === 'Working Directory');
          const cwd = cwdField?.value?.replace(/`/g, '') || deps.config.defaultCwd;

          // Validate cwd against allowed project list (#2)
          if (!isAllowedCwd(cwd, deps.config.projects)) {
            await interaction.reply({ content: '❌ The working directory is no longer in the allowed project list.', flags: [MessageFlags.Ephemeral] });
            return;
          }

          // Check if project is already busy (consistent with queue system concurrency rules)
          if (deps.queueStore?.isProjectBusy(cwd, deps.store)) {
            await interaction.reply({ content: '⚠️ Another session is currently active on this project. Please wait or use /stop first.', flags: [MessageFlags.Ephemeral] });
            return;
          }

          const model = deps.config.defaultModel;

          // Create new session
          const abortController = new AbortController();
          const session: SessionState = {
            sessionId: null,
            status: 'running',
            threadId,
            userId: interaction.user.id,
            startedAt: new Date(),
            lastActivityAt: new Date(),
            promptText,
            cwd,
            model,
            toolCount: 0,
            tools: {},
            pendingApproval: null,
            abortController,
            transcript: [{ timestamp: new Date(), type: 'user', content: promptText.slice(0, 2000) }],
          };

          deps.store.setSession(threadId, session);

          // Persist to recovery store
          deps.recoveryStore?.persist(session);

          await interaction.reply({ content: '🔄 Retrying interrupted session...', flags: [MessageFlags.Ephemeral] });

          // Send start embed
          const startEmbed = buildSessionStartEmbed(promptText, cwd, model);
          await sendInThread(thread, startEmbed);

          // Start query
          deps.startClaudeQuery(session, threadId).catch(async (error) => {
            log.error({ err: error, threadId, prompt: truncate(promptText, 40) }, 'Recovery retry error');
            const errorEmbed = buildErrorEmbed(error instanceof Error ? error.message : String(error));
            try {
              await sendInThread(thread, errorEmbed);
            } catch {
              // Thread may no longer exist
            }
            deps.store.clearSession(threadId);
            deps.recoveryStore?.remove(threadId);
          });
        } catch (error) {
          log.error({ err: error, threadId }, 'Recovery retry failed');
          await interaction.reply({ content: '❌ Failed to retry session', flags: [MessageFlags.Ephemeral] });
        }
        return;
      }

      // Recovery dismiss — remove buttons and acknowledge
      if (customId.startsWith('recovery_dismiss:')) {
        try {
          await interaction.update({ components: [] });
        } catch {
          // Message may have already been updated
        }
        await interaction.followUp({ content: '✅ Dismissed', flags: [MessageFlags.Ephemeral] });
        return;
      }

      // AskUserQuestion option buttons
      if (customId.startsWith('ask:')) {
        const parts = customId.slice('ask:'.length).split(':');
        let threadId: string, qIdx: number, optIdx: number;
        if (parts.length >= 3) {
          threadId = parts[0];
          qIdx = parseInt(parts[1], 10);
          optIdx = parseInt(parts[2], 10);
        } else {
          // Legacy format compatibility: ask:{threadId}:{optIdx}
          threadId = parts[0];
          qIdx = 0;
          optIdx = parseInt(parts[1], 10);
        }
        await handleAskOptionClick(interaction, threadId, qIdx, optIdx, askDeps);
        return;
      }

      // AskUserQuestion multi-select confirm button
      if (customId.startsWith('ask_submit:')) {
        const parts = customId.slice('ask_submit:'.length).split(':');
        const threadId = parts[0];
        const qIdx = parseInt(parts[1], 10);
        await handleAskSubmit(interaction, threadId, qIdx, askDeps);
        return;
      }

      // AskUserQuestion "Other" button -> show Modal
      if (customId.startsWith('ask_other:')) {
        const parts = customId.slice('ask_other:'.length).split(':');
        const threadId = parts[0];
        const qIdx = parts.length >= 2 ? parseInt(parts[1], 10) : 0;
        await handleAskOther(interaction, threadId, qIdx, askDeps);
        return;
      }
    }

    // Modal submit (AskUserQuestion custom answer)
    if (interaction.isModalSubmit()) {
      const { customId } = interaction;

      if (customId.startsWith('ask_modal:')) {
        const parts = customId.slice('ask_modal:'.length).split(':');
        const threadId = parts[0];
        const qIdx = parts.length >= 2 ? parseInt(parts[1], 10) : 0;
        await handleAskModalSubmit(interaction, threadId, qIdx, askDeps);
        return;
      }
    }
  };
}
