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

  private saveToDisk(): boolean {
    try {
      writeFileSync(this.dataFilePath, JSON.stringify(this.schedules, null, 2), 'utf-8');
      return true;
    } catch (error) {
      log.error({ err: error }, 'Failed to save schedules');
      return false;
    }
  }

  /** Add a new schedule. Returns false if persistence failed. */
  add(schedule: ScheduledPrompt): boolean {
    this.schedules.push(schedule);
    const ok = this.saveToDisk();
    if (ok) log.info({ id: schedule.id, name: schedule.name }, 'Schedule added');
    return ok;
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
    const ok = this.saveToDisk();
    if (ok) log.info({ name }, 'Schedule removed');
    return ok;
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

  /** Explicitly set a schedule's enabled state. Returns null if not found. */
  setEnabled(name: string, enabled: boolean): boolean | null {
    const schedule = this.schedules.find((s) => s.name === name);
    if (!schedule) return null;
    schedule.enabled = enabled;
    this.saveToDisk();
    log.info({ name, enabled }, 'Schedule enabled state set');
    return enabled;
  }

  /** Update lastRunAt and nextRunAt for a schedule */
  updateRunTimes(id: string, lastRunAt: string, nextRunAt: string): void {
    const schedule = this.schedules.find((s) => s.id === id);
    if (!schedule) return;
    schedule.lastRunAt = lastRunAt;
    schedule.nextRunAt = nextRunAt;
    this.saveToDisk();
  }

  /** Get all enabled schedules that are due to run (nextRunAt <= now) */
  getDueSchedules(): ScheduledPrompt[] {
    const now = new Date();
    return this.schedules.filter((s) => {
      if (!s.enabled) return false;
      if (!s.nextRunAt) return false;
      return new Date(s.nextRunAt) <= now;
    });
  }
}
