import type { Client, TextChannel, ThreadChannel } from 'discord.js';
import type { BotConfig, SessionState, ScheduledPrompt } from '../types.js';
import type { StateStore } from '../effects/state-store.js';
import type { ScheduleStore } from '../effects/schedule-store.js';
import type { BudgetStore } from '../effects/budget-store.js';
import { buildSessionStartEmbed } from '../modules/embeds.js';
import { sendInThread } from '../effects/discord-sender.js';
import { truncate } from '../modules/formatters.js';
import { isAllowedCwd } from '../modules/permissions.js';
import { logger } from '../effects/logger.js';

const log = logger.child({ module: 'ScheduleRunner' });

export interface ScheduleRunnerDeps {
  client: Client;
  config: BotConfig;
  store: StateStore;
  scheduleStore: ScheduleStore;
  budgetStore: BudgetStore;
  startClaudeQuery: (session: SessionState, threadId: string) => Promise<void>;
}

/**
 * Compute the next run time for a schedule (ISO string)
 */
export function computeNextRunAt(schedule: ScheduledPrompt): string {
  const [hours, minutes] = schedule.time.split(':').map(Number);
  const now = new Date();

  if (schedule.scheduleType === 'once' && schedule.onceDate) {
    const date = new Date(schedule.onceDate + 'T00:00:00Z');
    date.setUTCHours(hours, minutes, 0, 0);
    return date.toISOString();
  }

  if (schedule.scheduleType === 'daily') {
    const next = new Date(now);
    next.setUTCHours(hours, minutes, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString();
  }

  if (schedule.scheduleType === 'weekly' && schedule.dayOfWeek !== undefined) {
    const next = new Date(now);
    next.setUTCHours(hours, minutes, 0, 0);
    const currentDay = next.getUTCDay();
    let daysUntil = schedule.dayOfWeek - currentDay;
    if (daysUntil < 0 || (daysUntil === 0 && next <= now)) {
      daysUntil += 7;
    }
    next.setUTCDate(next.getUTCDate() + daysUntil);
    return next.toISOString();
  }

  return now.toISOString();
}

/**
 * Start the schedule runner interval. Checks every 60 seconds for due schedules.
 * Returns a cancel function.
 */
export function startScheduleRunner(deps: ScheduleRunnerDeps): { cancel: () => void } {
  const intervalId = setInterval(async () => {
    try {
      const dueSchedules = deps.scheduleStore.getDueSchedules();
      if (dueSchedules.length === 0) return;

      for (const schedule of dueSchedules) {
        await runSchedule(schedule, deps);
      }
    } catch (error) {
      log.error({ err: error }, 'Schedule runner error');
    }
  }, 60_000);

  return {
    cancel: () => clearInterval(intervalId),
  };
}

async function runSchedule(schedule: ScheduledPrompt, deps: ScheduleRunnerDeps): Promise<void> {
  const { client, config, store, scheduleStore, budgetStore, startClaudeQuery } = deps;

  // Check if a session is already active for this project
  // Includes waiting_input to match QueueStore.isProjectBusy and prevent file conflicts
  const activeSessions = store.getAllActiveSessions();
  const projectBusy = Array.from(activeSessions.values()).some(
    (s) => s.cwd === schedule.cwd && (s.status === 'running' || s.status === 'awaiting_permission' || s.status === 'waiting_input'),
  );
  if (projectBusy) {
    log.info({ schedule: schedule.name, cwd: schedule.cwd }, 'Project busy, skipping scheduled run');
    return;
  }

  // Validate cwd is still in the allowed project list
  if (!isAllowedCwd(schedule.cwd, config.projects)) {
    log.warn({ schedule: schedule.name, cwd: schedule.cwd }, 'Scheduled prompt cwd no longer allowed, skipping');
    return;
  }

  // Budget check — prevent unattended cost overruns
  // Note: This is a best-effort check. Concurrent sessions could collectively exceed the budget.
  const budgetResult = budgetStore.checkBudget(config);
  if (budgetResult) {
    log.warn(
      { schedule: schedule.name, period: budgetResult.period, spent: budgetResult.spent, limit: budgetResult.limit },
      'Scheduled prompt blocked by budget limit',
    );
    return;
  }

  try {
    const channel = await client.channels.fetch(schedule.channelId);
    if (!channel || !('threads' in channel)) {
      log.warn({ schedule: schedule.name, channelId: schedule.channelId }, 'Schedule channel not found');
      return;
    }

    const textChannel = channel as TextChannel;
    const threadName = `Scheduled: ${truncate(schedule.name, 30)}`;
    const thread = await textChannel.threads.create({
      name: threadName,
      autoArchiveDuration: 1440,
    }) as ThreadChannel;

    const model = schedule.model || config.defaultModel;
    const abortController = new AbortController();
    const session: SessionState = {
      sessionId: null,
      status: 'running',
      threadId: thread.id,
      userId: schedule.createdBy,
      startedAt: new Date(),
      lastActivityAt: new Date(),
      promptText: schedule.promptText,
      cwd: schedule.cwd,
      model,
      toolCount: 0,
      tools: {},
      pendingApproval: null,
      abortController,
      transcript: [{ timestamp: new Date(), type: 'user', content: schedule.promptText.slice(0, 2000) }],
      scheduleName: schedule.name,
    };

    store.setSession(thread.id, session);

    const startEmbed = buildSessionStartEmbed(schedule.promptText, schedule.cwd, model);
    await sendInThread(thread, startEmbed);

    // Notify creator
    await thread.send(`<@${schedule.createdBy}> Scheduled prompt **${schedule.name}** is running.`);

    log.info({ schedule: schedule.name, threadId: thread.id }, 'Scheduled prompt started');

    // Update run times
    const now = new Date().toISOString();
    const nextRun = schedule.scheduleType === 'once' ? '' : computeNextRunAt(schedule);
    scheduleStore.updateRunTimes(schedule.id, now, nextRun);

    // Disable one-time schedules after execution
    if (schedule.scheduleType === 'once') {
      scheduleStore.setEnabled(schedule.name, false);
    }

    startClaudeQuery(session, thread.id).catch((error) => {
      log.error({ err: error, threadId: thread.id, schedule: schedule.name }, 'Scheduled query error');
      store.clearSession(thread.id);
    });
  } catch (error) {
    log.error({ err: error, schedule: schedule.name }, 'Failed to run scheduled prompt');
  }
}
