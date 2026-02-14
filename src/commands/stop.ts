import {
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type ThreadChannel,
} from 'discord.js';
import type { BotConfig } from '../types.js';
import type { StateStore } from '../effects/state-store.js';
import { canExecuteCommand } from '../modules/permissions.js';
import { buildStopPreviewEmbed, buildStopConfirmEmbed } from '../modules/embeds.js';
import { deferReply, editReply, sendInThread } from '../effects/discord-sender.js';
import { resolveThreadId } from '../modules/session-resolver.js';

/** /stop command definition: abort a running Claude Code task */
export const data = new SlashCommandBuilder()
  .setName('stop')
  .setDescription('Abort the currently running Claude Code task');

/**
 * Executes the /stop command: displays a task summary with confirmation buttons, waits for user confirmation before aborting
 * @param interaction - Discord command interaction object
 * @param config - Bot configuration
 * @param store - Session state store
 * @param client - Discord Client instance
 * @returns void
 */
export async function execute(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  store: StateStore,
  _client: Client,
): Promise<void> {
  const parentId = interaction.channel && 'parentId' in interaction.channel ? interaction.channel.parentId : null;
  const auth = canExecuteCommand(interaction.user.id, interaction.channelId, config, parentId);
  if (!auth.allowed) {
    await interaction.reply({ content: `❌ ${auth.reason}`, flags: [MessageFlags.Ephemeral] });
    return;
  }

  await deferReply(interaction);

  const threadId = resolveThreadId(interaction, store);
  if (!threadId) {
    const activeCount = store.getActiveSessionCount();
    if (activeCount > 1) {
      await editReply(interaction, { content: '⚠️ Multiple tasks are in progress, please use this command in the target thread' });
    } else {
      await editReply(interaction, { content: '⚠️ No task is currently running' });
    }
    return;
  }

  const session = store.getSession(threadId);
  if (!session) {
    await editReply(interaction, { content: '⚠️ No task is currently running' });
    return;
  }

  // Display summary + confirmation buttons
  const durationMs = Date.now() - session.startedAt.getTime();
  const embed = buildStopPreviewEmbed(session, durationMs);

  const confirmBtn = new ButtonBuilder()
    .setCustomId(`confirm_stop:${threadId}`)
    .setLabel('Confirm Abort')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🛑');

  const cancelBtn = new ButtonBuilder()
    .setCustomId(`cancel_stop:${threadId}`)
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, cancelBtn);

  await editReply(interaction, { embeds: [embed], components: [row] });
}

/**
 * Executes the actual abort logic (triggered by the confirm_stop button)
 * @param threadId - Thread ID of the session to abort
 * @param store - Session state store
 * @param client - Discord Client instance, used to fetch the thread channel
 * @returns void
 */
export async function executeStop(
  threadId: string,
  store: StateStore,
  client: Client,
): Promise<void> {
  const session = store.getSession(threadId);
  if (!session) return;

  // Abort execution
  session.abortController.abort();

  // If there is a pending approval, automatically deny it
  if (session.pendingApproval) {
    store.resolvePendingApproval(threadId, {
      behavior: 'deny',
      message: 'User has aborted the task',
    });
  }

  // Calculate execution duration
  const durationMs = Date.now() - session.startedAt.getTime();

  // Send abort confirmation to thread
  try {
    const channel = await client.channels.fetch(threadId);
    if (channel?.isThread()) {
      const thread = channel as ThreadChannel;
      const embed = buildStopConfirmEmbed(
        { toolCount: session.toolCount, tools: session.tools },
        durationMs,
      );
      await sendInThread(thread, embed);
      await thread.setArchived(true);
    }
  } catch {
    // Thread may no longer exist
  }

  store.clearSession(threadId);
}
