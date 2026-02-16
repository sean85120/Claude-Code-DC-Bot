import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { BotConfig } from '../types.js';
import { COLORS } from '../types.js';
import { canExecuteCommand } from '../modules/permissions.js';
import type { LogStore } from '../effects/log-store.js';

/**
 * Build the /logs slash command definition
 */
export const data = new SlashCommandBuilder()
  .setName('logs')
  .setDescription('View recent bot logs')
  .addStringOption((opt) =>
    opt
      .setName('level')
      .setDescription('Filter by log level')
      .addChoices(
        { name: 'Info', value: 'info' },
        { name: 'Warn', value: 'warn' },
        { name: 'Error', value: 'error' },
      ),
  )
  .addStringOption((opt) =>
    opt
      .setName('module')
      .setDescription('Filter by module name (e.g. Bot, Claude, Interaction)'),
  )
  .addIntegerOption((opt) =>
    opt
      .setName('count')
      .setDescription('Number of entries to show (1-50, default 20)')
      .setMinValue(1)
      .setMaxValue(50),
  );

/**
 * Execute the /logs command
 */
export async function execute(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  logStore: LogStore,
): Promise<void> {
  const auth = canExecuteCommand(interaction.user.id, config);
  if (!auth.allowed) {
    await interaction.reply({
      content: `❌ ${auth.reason}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const level = interaction.options.getString('level') || undefined;
  const module = interaction.options.getString('module') || undefined;
  const count = interaction.options.getInteger('count') ?? 20;

  const entries = logStore.query({ level, module, count });

  if (entries.length === 0) {
    await interaction.reply({
      content: 'No log entries found matching the filters.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const lines = entries.map((e) => {
    const time = e.timestamp.toISOString().slice(11, 19); // HH:MM:SS
    const lvl = e.level.toUpperCase().padEnd(5);
    const mod = e.module ? `[${e.module}]` : '';
    return `\`${time}\` **${lvl}** ${mod} ${e.message}`;
  });

  // Truncate to 4000 chars (Discord embed description limit)
  let description = '';
  for (const line of lines) {
    if (description.length + line.length + 1 > 4000) {
      description += '\n*… truncated*';
      break;
    }
    description += (description ? '\n' : '') + line;
  }

  const filterParts: string[] = [];
  if (level) filterParts.push(`Level: ${level}`);
  if (module) filterParts.push(`Module: ${module}`);
  const filterText = filterParts.length > 0 ? ` (${filterParts.join(', ')})` : '';

  await interaction.reply({
    embeds: [{
      title: `📋 Recent Logs${filterText}`,
      description,
      footer: { text: `Showing ${entries.length} entries` },
      color: COLORS.Info,
    }],
    flags: [MessageFlags.Ephemeral],
  });
}
