import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DailySummaryStore } from './daily-summary-store.js';
import { existsSync, unlinkSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CompletedSessionRecord } from '../types.js';
import { emptyTokenUsage } from '../modules/token-usage.js';

function makeSession(overrides: Partial<CompletedSessionRecord> = {}): CompletedSessionRecord {
  return {
    threadId: 't1',
    userId: 'u1',
    projectName: 'Test Project',
    projectPath: '/test/path',
    promptText: 'Test prompt',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 5000,
    toolCount: 3,
    usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150, costUsd: 0 },
    costUsd: 0.01,
    model: 'claude-opus-4-6',
    ...overrides,
  };
}

describe('DailySummaryStore', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'daily-summary-test-'));
  });

  afterEach(() => {
    const filePath = resolve(tempDir, 'daily-summary.json');
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  });

  it('creates empty record for today on init', () => {
    const store = new DailySummaryStore(tempDir);
    const record = store.getTodayRecord();

    expect(record.sessions).toHaveLength(0);
    expect(record.totalCostUsd).toBe(0);
    expect(record.totalUsage.total).toBe(0);
    expect(record.totalDurationMs).toBe(0);
    expect(record.date).toBe(new Date().toISOString().split('T')[0]);
  });

  it('records a completed session', () => {
    const store = new DailySummaryStore(tempDir);
    const session = makeSession();

    store.recordCompletedSession(session);

    const record = store.getTodayRecord();
    expect(record.sessions).toHaveLength(1);
    expect(record.sessions[0].threadId).toBe('t1');
    expect(record.totalCostUsd).toBe(0.01);
    expect(record.totalUsage.input).toBe(100);
    expect(record.totalUsage.output).toBe(50);
    expect(record.totalUsage.total).toBe(150);
    expect(record.totalDurationMs).toBe(5000);
  });

  it('accumulates multiple sessions', () => {
    const store = new DailySummaryStore(tempDir);

    store.recordCompletedSession(makeSession({ threadId: 't1', costUsd: 0.01, durationMs: 5000 }));
    store.recordCompletedSession(makeSession({ threadId: 't2', costUsd: 0.02, durationMs: 3000 }));

    const record = store.getTodayRecord();
    expect(record.sessions).toHaveLength(2);
    expect(record.totalCostUsd).toBeCloseTo(0.03);
    expect(record.totalDurationMs).toBe(8000);
  });

  it('persists data to file', () => {
    const store1 = new DailySummaryStore(tempDir);
    store1.recordCompletedSession(makeSession({ threadId: 't1' }));

    // Create a new store from the same directory — should load persisted data
    const store2 = new DailySummaryStore(tempDir);
    const record = store2.getTodayRecord();

    expect(record.sessions).toHaveLength(1);
    expect(record.sessions[0].threadId).toBe('t1');
  });

  it('clearToday resets the current record', () => {
    const store = new DailySummaryStore(tempDir);
    store.recordCompletedSession(makeSession());

    store.clearToday();

    const record = store.getTodayRecord();
    expect(record.sessions).toHaveLength(0);
    expect(record.totalCostUsd).toBe(0);
  });

  it('getTodayRecord returns a copy (mutations do not affect store)', () => {
    const store = new DailySummaryStore(tempDir);
    store.recordCompletedSession(makeSession());

    const record = store.getTodayRecord();
    record.sessions.push(makeSession({ threadId: 'injected' }));

    expect(store.getTodayRecord().sessions).toHaveLength(1);
  });

  it('getRecordByDate returns undefined for unknown date', () => {
    const store = new DailySummaryStore(tempDir);
    expect(store.getRecordByDate('1999-01-01')).toBeUndefined();
  });

  it('getRecordByDate returns today record when date matches', () => {
    const store = new DailySummaryStore(tempDir);
    store.recordCompletedSession(makeSession());

    const today = new Date().toISOString().split('T')[0];
    const record = store.getRecordByDate(today);

    expect(record).toBeDefined();
    expect(record!.sessions).toHaveLength(1);
  });

  describe('getYesterdayRecord', () => {
    it('returns empty record when no data for yesterday', () => {
      const store = new DailySummaryStore(tempDir);
      const record = store.getYesterdayRecord();

      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const expectedDate = yesterday.toISOString().split('T')[0];

      expect(record.date).toBe(expectedDate);
      expect(record.sessions).toHaveLength(0);
      expect(record.totalCostUsd).toBe(0);
      expect(record.totalUsage.total).toBe(0);
    });

    it('returns yesterday data when persisted records exist', () => {
      const store = new DailySummaryStore(tempDir);

      // Manually write a record for yesterday into the file
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayKey = yesterday.toISOString().split('T')[0];

      const yesterdaySession = makeSession({
        threadId: 'yesterday-t1',
        promptText: 'Yesterday task',
      });
      const yesterdayRecord = {
        date: yesterdayKey,
        sessions: [yesterdaySession],
        totalCostUsd: 0.05,
        totalUsage: { input: 500, output: 200, cacheRead: 0, cacheWrite: 0, total: 700, costUsd: 0 },
        totalDurationMs: 10000,
      };

      // Write the record file directly
      const filePath = resolve(tempDir, 'daily-summary.json');
      writeFileSync(filePath, JSON.stringify([yesterdayRecord], null, 2), 'utf-8');

      // Create a new store that reads from the file
      const store2 = new DailySummaryStore(tempDir);
      const record = store2.getYesterdayRecord();

      expect(record.date).toBe(yesterdayKey);
      expect(record.sessions).toHaveLength(1);
      expect(record.sessions[0].threadId).toBe('yesterday-t1');
      expect(record.totalCostUsd).toBe(0.05);
      expect(record.totalUsage.total).toBe(700);
    });

    it('returns a copy (mutations do not affect store)', () => {
      const store = new DailySummaryStore(tempDir);
      const record = store.getYesterdayRecord();
      record.sessions.push(makeSession({ threadId: 'injected' }));

      const freshRecord = store.getYesterdayRecord();
      expect(freshRecord.sessions).toHaveLength(0);
    });
  });
});
