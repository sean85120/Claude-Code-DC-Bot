import { describe, it, expect } from 'vitest';
import { UsageStore } from './usage-store.js';
import type { TokenUsage } from '../types.js';

function makeUsage(input: number, output: number): TokenUsage {
  return { input, output, cacheRead: 0, cacheWrite: 0, total: input + output, costUsd: 0 };
}

describe('UsageStore', () => {
  it('initial state is zero', () => {
    const store = new UsageStore();
    const stats = store.getGlobalStats();
    expect(stats.totalSessions).toBe(0);
    expect(stats.completedQueries).toBe(0);
    expect(stats.totalUsage.total).toBe(0);
    expect(stats.totalCostUsd).toBe(0);
  });

  it('recordSessionStart increments session count', () => {
    const store = new UsageStore();
    store.recordSessionStart();
    store.recordSessionStart();
    expect(store.getGlobalStats().totalSessions).toBe(2);
  });

  it('recordResult accumulates global usage', () => {
    const store = new UsageStore();
    store.recordResult('t1', makeUsage(100, 50), 0.01, 5000);
    store.recordResult('t2', makeUsage(200, 100), 0.02, 3000);

    const stats = store.getGlobalStats();
    expect(stats.completedQueries).toBe(2);
    expect(stats.totalUsage.input).toBe(300);
    expect(stats.totalUsage.output).toBe(150);
    expect(stats.totalUsage.total).toBe(450);
    expect(stats.totalCostUsd).toBeCloseTo(0.03);
    expect(stats.totalDurationMs).toBe(8000);
  });

  it('recordResult accumulates usage for the same session', () => {
    const store = new UsageStore();
    store.recordResult('t1', makeUsage(100, 50), 0.01, 5000);
    store.recordResult('t1', makeUsage(200, 100), 0.02, 3000);

    const session = store.getSessionUsage('t1');
    expect(session).toBeDefined();
    expect(session!.usage.input).toBe(300);
    expect(session!.usage.output).toBe(150);
    expect(session!.costUsd).toBeCloseTo(0.03);
    expect(session!.durationMs).toBe(8000);
  });

  it('getSessionUsage returns undefined when not found', () => {
    const store = new UsageStore();
    expect(store.getSessionUsage('nonexistent')).toBeUndefined();
  });

  it('getGlobalStats returns a copy', () => {
    const store = new UsageStore();
    store.recordResult('t1', makeUsage(100, 50), 0.01, 5000);
    const stats = store.getGlobalStats();
    stats.totalUsage.input = 999;
    expect(store.getGlobalStats().totalUsage.input).toBe(100);
  });

  it('getSessionUsage returns a copy', () => {
    const store = new UsageStore();
    store.recordResult('t1', makeUsage(100, 50), 0.01, 5000);
    const session = store.getSessionUsage('t1')!;
    session.usage.input = 999;
    expect(store.getSessionUsage('t1')!.usage.input).toBe(100);
  });

  it('bootedAt is set at creation time', () => {
    const before = new Date();
    const store = new UsageStore();
    const stats = store.getGlobalStats();
    expect(stats.bootedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(stats.bootedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  describe('Per-user tracking', () => {
    it('tracks usage per user when userId is provided', () => {
      const store = new UsageStore();
      store.recordResult('t1', makeUsage(100, 50), 0.01, 5000, 'user-1');
      store.recordResult('t2', makeUsage(200, 100), 0.02, 3000, 'user-2');

      const user1 = store.getUserUsage('user-1');
      expect(user1).toBeDefined();
      expect(user1!.usage.input).toBe(100);
      expect(user1!.usage.total).toBe(150);
      expect(user1!.costUsd).toBeCloseTo(0.01);
      expect(user1!.totalQueries).toBe(1);

      const user2 = store.getUserUsage('user-2');
      expect(user2).toBeDefined();
      expect(user2!.usage.input).toBe(200);
      expect(user2!.totalQueries).toBe(1);
    });

    it('accumulates usage for the same user across queries', () => {
      const store = new UsageStore();
      store.recordResult('t1', makeUsage(100, 50), 0.01, 5000, 'user-1');
      store.recordResult('t2', makeUsage(200, 100), 0.02, 3000, 'user-1');

      const user = store.getUserUsage('user-1');
      expect(user!.usage.input).toBe(300);
      expect(user!.usage.total).toBe(450);
      expect(user!.costUsd).toBeCloseTo(0.03);
      expect(user!.totalQueries).toBe(2);
    });

    it('does not track per-user when userId is undefined', () => {
      const store = new UsageStore();
      store.recordResult('t1', makeUsage(100, 50), 0.01, 5000);

      expect(store.getAllUserUsage().size).toBe(0);
    });

    it('getUserUsage returns undefined for unknown user', () => {
      const store = new UsageStore();
      expect(store.getUserUsage('nonexistent')).toBeUndefined();
    });

    it('getUserUsage returns a copy', () => {
      const store = new UsageStore();
      store.recordResult('t1', makeUsage(100, 50), 0.01, 5000, 'user-1');
      const user = store.getUserUsage('user-1')!;
      user.usage.input = 999;
      expect(store.getUserUsage('user-1')!.usage.input).toBe(100);
    });

    it('getAllUserUsage returns all users', () => {
      const store = new UsageStore();
      store.recordResult('t1', makeUsage(100, 50), 0.01, 5000, 'user-1');
      store.recordResult('t2', makeUsage(200, 100), 0.02, 3000, 'user-2');

      const allUsage = store.getAllUserUsage();
      expect(allUsage.size).toBe(2);
      expect(allUsage.has('user-1')).toBe(true);
      expect(allUsage.has('user-2')).toBe(true);
    });

    it('getAllUserUsage returns copies', () => {
      const store = new UsageStore();
      store.recordResult('t1', makeUsage(100, 50), 0.01, 5000, 'user-1');
      const allUsage = store.getAllUserUsage();
      allUsage.get('user-1')!.usage.input = 999;
      expect(store.getUserUsage('user-1')!.usage.input).toBe(100);
    });
  });
});
