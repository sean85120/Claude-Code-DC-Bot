import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
} from 'discord.js';
import type { BotConfig, DailyRecord } from '../types.js';
import type { DailySummaryStore } from '../effects/daily-summary-store.js';
import { canExecuteCommand } from '../modules/permissions.js';
import { groupSessionsByRepo, buildDailySummaryEmbed } from '../modules/daily-summary.js';
import { resolveSummaryChannel } from '../effects/summary-channel.js';
import { deferReplyEphemeral, editReply } from '../effects/discord-sender.js';
import { emptyTokenUsage } from '../modules/token-usage.js';
import { logger } from '../effects/logger.js';

const log = logger.child({ module: 'SummaryCmd' });

/** /summary command definition: post the daily summary and cost report to the summary channel */
export const data = new SlashCommandBuilder()
  .setName('summary')
  .setDescription('Post the daily summary and cost report to the summary channel')
  .addStringOption((opt) =>
    opt
      .setName('date')
      .setDescription('Date to view (YYYY-MM-DD format, defaults to today)')
      .setRequired(false),
  );

/**
 * Executes the /summary command: fetches a daily record, builds the summary embed,
 * and posts it to the summary channel.
 *
 * @param interaction - Discord command interaction object
 * @param config - Bot configuration
 * @param summaryStore - Daily summary store (persistent)
 * @param client - Discord client (needed to resolve the summary channel)
 */
export async function execute(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  summaryStore: DailySummaryStore,
  client: Client,
): Promise<void> {
  const auth = canExecuteCommand(interaction.user.id, config);
  if (!auth.allowed) {
    await interaction.reply({ content: `❌ ${auth.reason}`, flags: [MessageFlags.Ephemeral] });
    return;
  }

  await deferReplyEphemeral(interaction);

  // Determine which date to show
  const dateInput = interaction.options.getString('date');
  let record: DailyRecord | undefined;
  let targetDate: string;

  if (dateInput) {
    // Validate YYYY-MM-DD format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      await editReply(interaction, {
        content: '❌ Invalid date format. Please use YYYY-MM-DD (e.g., 2025-06-15)',
      });
      return;
    }

    // Validate it's a real date
    const parsed = new Date(dateInput + 'T00:00:00Z');
    if (isNaN(parsed.getTime())) {
      await editReply(interaction, {
        content: '❌ Invalid date. Please use a valid YYYY-MM-DD date.',
      });
      return;
    }

    targetDate = dateInput;
    record = summaryStore.getRecordByDate(dateInput);
  } else {
    record = summaryStore.getTodayRecord();
    targetDate = record.date;
  }

  // If no record found for a historical date, create an empty one for display
  if (!record) {
    record = {
      date: targetDate,
      sessions: [],
      totalCostUsd: 0,
      totalUsage: emptyTokenUsage(),
      totalDurationMs: 0,
    };
  }

  // Build the embed using existing pure functions
  const repoSummaries = groupSessionsByRepo(record.sessions);
  const embed = buildDailySummaryEmbed(record, repoSummaries);

  // Post to the summary channel
  try {
    const channel = await resolveSummaryChannel(client, config);
    await channel.send({ embeds: [embed] });

    await editReply(interaction, {
      content: `✅ Summary for **${targetDate}** posted to <#${channel.id}>`,
    });

    log.info(
      { date: targetDate, sessions: record.sessions.length },
      'Manual summary posted via /summary command',
    );
  } catch (error) {
    log.error({ err: error }, 'Failed to post summary via /summary command');
    await editReply(interaction, {
      content: '❌ Failed to post summary. Check bot permissions for the summary channel.',
    });
  }
}
