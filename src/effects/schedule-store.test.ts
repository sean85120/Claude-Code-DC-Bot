import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScheduleStore } from './schedule-store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScheduledPrompt } from '../types.js';

function makeSchedule(overrides: Partial<ScheduledPrompt> = {}): ScheduledPrompt {
  return {
    id: 'sched-1',
    name: 'daily-check',
    promptText: 'Run tests',
    cwd: '/tmp/project',
    channelId: 'ch1',
    createdBy: 'user1',
    createdAt: new Date().toISOString(),
    enabled: true,
    scheduleType: 'daily',
    time: '09:00',
    ...overrides,
  };
}

describe('ScheduleStore', () => {
  let tempDir: string;
  let store: ScheduleStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'schedule-test-'));
    store = new ScheduleStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('starts with empty list', () => {
    expect(store.list()).toEqual([]);
  });

  it('adds and retrieves schedules', () => {
    const s = makeSchedule();
    store.add(s);
    expect(store.list().length).toBe(1);
    expect(store.get('sched-1')).toEqual(s);
  });

  it('finds schedule by name', () => {
    store.add(makeSchedule());
    expect(store.getByName('daily-check')).toBeDefined();
    expect(store.getByName('nope')).toBeUndefined();
  });

  it('removes a schedule', () => {
    store.add(makeSchedule());
    expect(store.remove('daily-check')).toBe(true);
    expect(store.list().length).toBe(0);
  });

  it('returns false when removing non-existent', () => {
    expect(store.remove('nope')).toBe(false);
  });

  it('toggles enabled state', () => {
    store.add(makeSchedule({ enabled: true }));
    expect(store.toggle('daily-check')).toBe(false);
    expect(store.getByName('daily-check')?.enabled).toBe(false);
    expect(store.toggle('daily-check')).toBe(true);
  });

  it('returns null when toggling non-existent', () => {
    expect(store.toggle('nope')).toBeNull();
  });

  it('updates run times', () => {
    store.add(makeSchedule());
    const now = new Date().toISOString();
    store.updateRunTimes('sched-1', now, now);
    expect(store.get('sched-1')?.lastRunAt).toBe(now);
    expect(store.get('sched-1')?.nextRunAt).toBe(now);
  });

  it('persists across instances', () => {
    store.add(makeSchedule());
    const store2 = new ScheduleStore(tempDir);
    expect(store2.list().length).toBe(1);
  });
});
