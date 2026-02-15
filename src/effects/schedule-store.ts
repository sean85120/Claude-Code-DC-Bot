import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ScheduledPrompt } from '../types.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'ScheduleStore' });

/**
 * Persistent schedule storage, backed by a JSON file.
 */
export class ScheduleStore {
  private dataFilePath: string;
  private schedules: ScheduledPrompt[];

  constructor(dataDir = process.cwd()) {
    this.dataFilePath = resolve(dataDir, 'schedules.json');
    this.schedules = this.loadFromDisk();
  }

  private loadFromDisk(): ScheduledPrompt[] {
    if (!existsSync(this.dataFilePath)) return [];
    try {
      const raw = readFileSync(this.dataFilePath, 'utf-8');
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      log.warn({ err: error }, 'Failed to load schedules, starting fresh');
      return [];
    }
  }

  private saveToDisk(): void {
    try {
      writeFileSync(this.dataFilePath, JSON.stringify(this.schedules, null, 2), 'utf-8');
    } catch (error) {
      log.error({ err: error }, 'Failed to save schedules');
    }
  }

  /** Add a new schedule */
  add(schedule: ScheduledPrompt): void {
    this.schedules.push(schedule);
    this.saveToDisk();
    log.info({ id: schedule.id, name: schedule.name }, 'Schedule added');
  }

  /** List all schedules */
  list(): ScheduledPrompt[] {
    return [...this.schedules];
  }

  /** Get a schedule by ID */
  get(id: string): ScheduledPrompt | undefined {
    return this.schedules.find((s) => s.id === id);
  }

  /** Get a schedule by name */
  getByName(name: string): ScheduledPrompt | undefined {
    return this.schedules.find((s) => s.name === name);
  }

  /** Remove a schedule by name. Returns true if found and removed. */
  remove(name: string): boolean {
    const idx = this.schedules.findIndex((s) => s.name === name);
    if (idx < 0) return false;
    this.schedules.splice(idx, 1);
    this.saveToDisk();
    log.info({ name }, 'Schedule removed');
    return true;
  }

  /** Toggle a schedule's enabled state. Returns the new state, or null if not found. */
  toggle(name: string): boolean | null {
    const schedule = this.schedules.find((s) => s.name === name);
    if (!schedule) return null;
    schedule.enabled = !schedule.enabled;
    this.saveToDisk();
    log.info({ name, enabled: schedule.enabled }, 'Schedule toggled');
    return schedule.enabled;
  }

  /** Update lastRunAt and nextRunAt for a schedule */
  updateRunTimes(id: string, lastRunAt: string, nextRunAt: string): void {
    const schedule = this.schedules.find((s) => s.id === id);
    if (!schedule) return;
    schedule.lastRunAt = lastRunAt;
    schedule.nextRunAt = nextRunAt;
    this.saveToDisk();
  }

  /** Get all enabled schedules that are due to run */
  getDueSchedules(): ScheduledPrompt[] {
    const now = new Date();
    const nowUtcHour = now.getUTCHours();
    const nowUtcMinute = now.getUTCMinutes();
    const nowDay = now.getUTCDay();
    const todayDateKey = now.toISOString().split('T')[0];
    const currentHHMM = `${String(nowUtcHour).padStart(2, '0')}:${String(nowUtcMinute).padStart(2, '0')}`;

    return this.schedules.filter((s) => {
      if (!s.enabled) return false;

      // Already ran today at this time?
      if (s.lastRunAt) {
        const lastRun = new Date(s.lastRunAt);
        const lastRunDate = lastRun.toISOString().split('T')[0];
        if (lastRunDate === todayDateKey) return false;
      }

      // Check if the time matches (within the current minute)
      if (s.time !== currentHHMM) return false;

      switch (s.scheduleType) {
        case 'daily':
          return true;
        case 'weekly':
          return s.dayOfWeek === nowDay;
        case 'once':
          return s.onceDate === todayDateKey;
        default:
          return false;
      }
    });
  }
}
