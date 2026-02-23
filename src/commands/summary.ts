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
import { richMessageToEmbed } from '../platforms/discord/converter.js';
import { emptyTokenUsage } from '../modules/token-usage.js';
import { logger } from '../effects/logger.js';

const log = logger.child({ module: 'SummaryCmd' });

/** Cooldown: track last post time per date to prevent spamming the summary channel */
const lastPostTime = new Map<string, number>();
const COOLDOWN_MS = 60_000; // 60 seconds

/** Reset the cooldown map (for testing) */
export function resetCooldown(): void {
  lastPostTime.clear();
}

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

    // Validate it's a real date (round-trip check catches rollover like 2025-02-31 → 2025-03-03)
    const parsed = new Date(dateInput + 'T00:00:00Z');
    if (isNaN(parsed.getTime()) || parsed.toISOString().split('T')[0] !== dateInput) {
      await editReply(interaction, {
        content: '❌ Invalid date. Please use a valid YYYY-MM-DD date.',
      });
      return;
    }

    // Reject future dates
    const today = new Date().toISOString().split('T')[0];
    if (dateInput > today) {
      await editReply(interaction, {
        content: '❌ Cannot generate a summary for a future date.',
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

  // Cooldown: prevent posting the same date within 60 seconds
  const lastPost = lastPostTime.get(targetDate);
  if (lastPost && Date.now() - lastPost < COOLDOWN_MS) {
    const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - lastPost)) / 1000);
    await editReply(interaction, {
      content: `⏳ Summary for **${targetDate}** was just posted. Please wait ${remaining} seconds.`,
    });
    return;
  }

  // Build the embed using existing pure functions
  const repoSummaries = groupSessionsByRepo(record.sessions);
  const embed = buildDailySummaryEmbed(record, repoSummaries);

  // Post to the summary channel
  try {
    const channel = await resolveSummaryChannel(client, config);
    await channel.send({ embeds: [richMessageToEmbed(embed)] });

    lastPostTime.set(targetDate, Date.now());

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
