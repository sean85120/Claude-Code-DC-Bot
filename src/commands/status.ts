import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { BotConfig } from '../types.js';
import type { StateStore } from '../effects/state-store.js';
import type { UsageStore } from '../effects/usage-store.js';
import type { QueueStore } from '../effects/queue-store.js';
import { canExecuteCommand } from '../modules/permissions.js';
import { buildStatusEmbed, buildGlobalStatusEmbed } from '../modules/embeds.js';
import { deferReplyEphemeral, editReply } from '../effects/discord-sender.js';

/** /status command definition: view Claude Code execution status */
export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('View current Claude Code execution status');

/**
 * Executes the /status command: shows session status inside a thread, or global bot status in a channel
 * @param interaction - Discord command interaction object
 * @param config - Bot configuration
 * @param store - Session state store
 * @param usageStore - Token usage store
 * @returns void
 */
export async function execute(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  store: StateStore,
  usageStore: UsageStore,
  queueStore?: QueueStore,
): Promise<void> {
  const auth = canExecuteCommand(interaction.user.id, config);
  if (!auth.allowed) {
    await interaction.reply({ content: `❌ ${auth.reason}`, flags: [MessageFlags.Ephemeral] });
    return;
  }

  await deferReplyEphemeral(interaction);

  // If inside a thread, show that session's status (including token usage)
  const channel = interaction.channel;
  if (channel?.isThread()) {
    const session = store.getSession(channel.id);
    const sessionUsage = usageStore.getSessionUsage(channel.id);
    const embed = buildStatusEmbed(session, sessionUsage);
    await editReply(interaction, { embeds: [embed] });
    return;
  }

  // Not inside a thread, show global bot status
  const activeSessions = store.getAllActiveSessions();
  const globalStats = usageStore.getGlobalStats();
  const userUsage = usageStore.getAllUserUsage();
  const embed = buildGlobalStatusEmbed(globalStats, activeSessions, userUsage);

  // Add queue info if there are queued sessions
  const embeds = [embed];
  if (queueStore && queueStore.getTotalQueuedCount() > 0) {
    const allQueues = queueStore.getAllQueues();
    let queueText = '';
    for (const [cwd, entries] of allQueues) {
      const projectPath = cwd.split('/').pop() ?? cwd;
      queueText += `**${projectPath}** — ${entries.length} queued\n`;
      for (const entry of entries.slice(0, 3)) {
        queueText += `  → <#${entry.threadId}>\n`;
      }
      if (entries.length > 3) {
        queueText += `  ... and ${entries.length - 3} more\n`;
      }
    }
    if (embed.fields) {
      embed.fields.push({
        name: `📋 Queue (${queueStore.getTotalQueuedCount()} total)`,
        value: queueText.trim().slice(0, 1024),
        inline: false,
      });
    }
  }

  await editReply(interaction, { embeds });
}
