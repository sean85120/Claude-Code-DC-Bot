import { AttachmentBuilder, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { BotConfig } from '../types.js';
import type { StateStore } from '../effects/state-store.js';
import { canExecuteCommand } from '../modules/permissions.js';
import { resolveThreadId } from '../modules/session-resolver.js';
import { formatTranscript } from '../modules/transcript-formatter.js';
import { deferReplyEphemeral, editReply } from '../effects/discord-sender.js';

/** /history command definition: export thread conversation history as a Markdown file */
export const data = new SlashCommandBuilder()
  .setName('history')
  .setDescription('Export the current thread conversation history (Markdown file)');

/**
 * Executes the /history command: formats the session transcript and returns it as a Markdown attachment
 * @param interaction - Discord command interaction object
 * @param config - Bot configuration
 * @param store - Session state store
 * @returns void
 */
export async function execute(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  store: StateStore,
): Promise<void> {
  const parentId = interaction.channel && 'parentId' in interaction.channel ? interaction.channel.parentId : null;
  const auth = canExecuteCommand(interaction.user.id, interaction.channelId, config, parentId);
  if (!auth.allowed) {
    await interaction.reply({ content: `❌ ${auth.reason}`, flags: [MessageFlags.Ephemeral] });
    return;
  }

  const threadId = resolveThreadId(interaction, store);
  if (!threadId) {
    await interaction.reply({ content: '⚠️ Please use this command within a session thread', flags: [MessageFlags.Ephemeral] });
    return;
  }

  const session = store.getSession(threadId);
  if (!session || !session.transcript || session.transcript.length === 0) {
    await interaction.reply({ content: '⚠️ This thread has no conversation history', flags: [MessageFlags.Ephemeral] });
    return;
  }

  await deferReplyEphemeral(interaction);

  const formatted = formatTranscript(session.transcript);
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const filename = `history-${timestamp}.md`;

  const attachment = new AttachmentBuilder(Buffer.from(formatted, 'utf-8'), { name: filename });

  await editReply(interaction, {
    content: `📋 Conversation history (${session.transcript.length} entries)`,
    files: [attachment],
  });
}
