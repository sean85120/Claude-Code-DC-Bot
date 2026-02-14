import { MessageFlags, type Interaction, type Client } from 'discord.js';
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
import {
  handleAskOptionClick,
  handleAskSubmit,
  handleAskOther,
  handleAskModalSubmit,
} from './ask-handler.js';

/** Dependency injection interface for the interaction handler */
export interface InteractionHandlerDeps {
  config: BotConfig;
  store: StateStore;
  client: Client;
  startClaudeQuery: (session: SessionState, threadId: string) => Promise<void>;
  rateLimitStore: RateLimitStore;
  usageStore: UsageStore;
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
          );
          break;

        case 'stop':
          await stopCmd.execute(interaction, deps.config, deps.store, deps.client);
          break;

        case 'status':
          await statusCmd.execute(interaction, deps.config, deps.store, deps.usageStore);
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
          await reposCmd.execute(interaction, deps.config);
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
        await stopCmd.executeStop(threadId, deps.store, deps.client);
        return;
      }

      // Cancel stop
      if (customId.startsWith('cancel_stop:')) {
        await interaction.reply({ content: '✅ Stop cancelled', flags: [MessageFlags.Ephemeral] });
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
