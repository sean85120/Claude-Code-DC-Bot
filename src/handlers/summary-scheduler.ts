import type { Client } from 'discord.js';
import type { BotConfig } from '../types.js';
import type { DailySummaryStore } from '../effects/daily-summary-store.js';
import { groupSessionsByRepo, buildDailySummaryEmbed } from '../modules/daily-summary.js';
import { resolveSummaryChannel } from '../effects/summary-channel.js';
import { logger } from '../effects/logger.js';
import { formatDuration } from '../modules/formatters.js';

const log = logger.child({ module: 'SummaryScheduler' });

/**
 * Calculate milliseconds until the next scheduled summary time.
 * If the target hour has already passed today, schedules for tomorrow.
 *
 * @param targetHourUtc - Hour of day in UTC (0-23)
 * @returns Milliseconds until next scheduled time
 */
export function msUntilNextSummary(targetHourUtc: number): number {
  const now = new Date();
  const next = new Date();
  next.setUTCHours(targetHourUtc, 0, 0, 0);

  // If the target time has already passed today, schedule for tomorrow
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next.getTime() - now.getTime();
}

/**
 * Post the daily summary to the summary channel.
 * Fetches yesterday's record (complete day), groups by repo, builds embed, and sends it.
 *
 * @param client - Discord.js client
 * @param config - Bot configuration
 * @param summaryStore - Daily summary store
 */
export async function postDailySummary(
  client: Client,
  config: BotConfig,
  summaryStore: DailySummaryStore,
): Promise<void> {
  if (!config.summaryEnabled) {
    log.info('Daily summary is disabled, skipping');
    return;
  }

  try {
    const record = summaryStore.getYesterdayRecord();
    const repoSummaries = groupSessionsByRepo(record.sessions);
    const embed = buildDailySummaryEmbed(record, repoSummaries);

    const channel = await resolveSummaryChannel(client, config);
    await channel.send({ embeds: [embed] });

    log.info(
      { date: record.date, sessions: record.sessions.length, cost: record.totalCostUsd },
      'Posted daily summary',
    );
  } catch (error) {
    log.error({ err: error }, 'Failed to post daily summary');
  }
}

/**
 * Start the daily summary scheduler.
 * Uses recursive setTimeout to fire at the configured UTC hour each day.
 *
 * @param client - Discord.js client
 * @param config - Bot configuration
 * @param summaryStore - Daily summary store
 * @returns Object with cancel() to stop the scheduler
 */
export function startSummaryScheduler(
  client: Client,
  config: BotConfig,
  summaryStore: DailySummaryStore,
): { cancel: () => void } {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  function scheduleNext(): void {
    if (cancelled) return;

    const delay = msUntilNextSummary(config.summaryHourUtc);
    log.info(
      { delayMs: delay, delayHuman: formatDuration(delay), targetHourUtc: config.summaryHourUtc },
      'Scheduled next daily summary',
    );

    timerId = setTimeout(async () => {
      await postDailySummary(client, config, summaryStore);
      scheduleNext();
    }, delay);
  }

  if (config.summaryEnabled) {
    scheduleNext();
  } else {
    log.info('Daily summary is disabled, scheduler not started');
  }

  return {
    cancel: () => {
      cancelled = true;
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    },
  };
}
