import { describe, it, expect } from 'vitest';
import { computeNextRunAt } from './schedule-runner.js';
import type { ScheduledPrompt } from '../types.js';

function makeSchedule(overrides: Partial<ScheduledPrompt> = {}): ScheduledPrompt {
  return {
    id: 'test-1',
    name: 'test',
    promptText: 'hello',
    cwd: '/tmp',
    channelId: 'ch1',
    createdBy: 'user1',
    createdAt: new Date().toISOString(),
    enabled: true,
    scheduleType: 'daily',
    time: '09:00',
    ...overrides,
  };
}

describe('computeNextRunAt', () => {
  it('returns a valid ISO date string for daily schedule', () => {
    const schedule = makeSchedule({ scheduleType: 'daily', time: '14:30' });
    const result = computeNextRunAt(schedule);
    const date = new Date(result);
    expect(date.getTime()).not.toBeNaN();
    expect(date.getUTCHours()).toBe(14);
    expect(date.getUTCMinutes()).toBe(30);
  });

  it('returns next day if time already passed today', () => {
    const now = new Date();
    const pastHour = (now.getUTCHours() - 2 + 24) % 24;
    const time = `${String(pastHour).padStart(2, '0')}:00`;
    const schedule = makeSchedule({ scheduleType: 'daily', time });
    const result = new Date(computeNextRunAt(schedule));
    expect(result > now).toBe(true);
  });

  it('returns correct date for once schedule', () => {
    const schedule = makeSchedule({
      scheduleType: 'once',
      time: '10:00',
      onceDate: '2030-06-15',
    });
    const result = new Date(computeNextRunAt(schedule));
    expect(result.getUTCFullYear()).toBe(2030);
    expect(result.getUTCMonth()).toBe(5); // June = 5
    expect(result.getUTCDate()).toBe(15);
    expect(result.getUTCHours()).toBe(10);
  });

  it('returns correct day for weekly schedule', () => {
    const schedule = makeSchedule({
      scheduleType: 'weekly',
      time: '08:00',
      dayOfWeek: 3, // Wednesday
    });
    const result = new Date(computeNextRunAt(schedule));
    expect(result.getUTCDay()).toBe(3);
    expect(result.getUTCHours()).toBe(8);
  });

  it('advances to next week if weekly day already passed', () => {
    const now = new Date();
    const yesterday = (now.getUTCDay() - 1 + 7) % 7;
    const schedule = makeSchedule({
      scheduleType: 'weekly',
      time: '00:00',
      dayOfWeek: yesterday,
    });
    const result = new Date(computeNextRunAt(schedule));
    expect(result > now).toBe(true);
    expect(result.getUTCDay()).toBe(yesterday);
  });
});
