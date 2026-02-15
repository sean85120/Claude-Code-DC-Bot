import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BudgetStore } from './budget-store.js';
import type { BotConfig, DailyRecord } from '../types.js';
import { emptyTokenUsage } from '../modules/token-usage.js';

function makeRecord(date: string, totalCostUsd: number): DailyRecord {
  return {
    date,
    sessions: [],
    totalCostUsd,
    totalUsage: emptyTokenUsage(),
    totalDurationMs: 0,
  };
}

function makeConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    budgetDailyLimitUsd: 0,
    budgetWeeklyLimitUsd: 0,
    budgetMonthlyLimitUsd: 0,
    ...overrides,
  } as BotConfig;
}

function todayKey(): string {
  return new Date().toISOString().split('T')[0];
}

function daysAgoKey(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split('T')[0];
}

describe('BudgetStore', () => {
  let mockSummaryStore: {
    getRecordByDate: ReturnType<typeof vi.fn>;
  };
  let budgetStore: BudgetStore;

  beforeEach(() => {
    mockSummaryStore = {
      getRecordByDate: vi.fn().mockReturnValue(undefined),
    };
    budgetStore = new BudgetStore(mockSummaryStore as never);
  });

  describe('getDailySpend', () => {
    it('returns 0 when no records exist', () => {
      expect(budgetStore.getDailySpend()).toBe(0);
    });

    it('returns today cost when record exists', () => {
      mockSummaryStore.getRecordByDate.mockImplementation((date: string) =>
        date === todayKey() ? makeRecord(date, 2.5) : undefined,
      );
      expect(budgetStore.getDailySpend()).toBe(2.5);
    });
  });

  describe('getWeeklySpend', () => {
    it('sums 7 days of records', () => {
      mockSummaryStore.getRecordByDate.mockImplementation((date: string) => {
        if (date === todayKey()) return makeRecord(date, 1);
        if (date === daysAgoKey(1)) return makeRecord(date, 2);
        if (date === daysAgoKey(6)) return makeRecord(date, 3);
        return undefined;
      });
      expect(budgetStore.getWeeklySpend()).toBe(6);
    });
  });

  describe('checkBudget', () => {
    it('returns null when no limits set', () => {
      const config = makeConfig();
      expect(budgetStore.checkBudget(config)).toBeNull();
    });

    it('returns null when under limit', () => {
      mockSummaryStore.getRecordByDate.mockImplementation((date: string) =>
        date === todayKey() ? makeRecord(date, 4.99) : undefined,
      );
      const config = makeConfig({ budgetDailyLimitUsd: 5 });
      expect(budgetStore.checkBudget(config)).toBeNull();
    });

    it('returns exceeded when at or over limit', () => {
      mockSummaryStore.getRecordByDate.mockImplementation((date: string) =>
        date === todayKey() ? makeRecord(date, 5) : undefined,
      );
      const config = makeConfig({ budgetDailyLimitUsd: 5 });
      const result = budgetStore.checkBudget(config);
      expect(result).not.toBeNull();
      expect(result!.exceeded).toBe(true);
      expect(result!.period).toBe('daily');
    });

    it('checks weekly limit', () => {
      mockSummaryStore.getRecordByDate.mockImplementation((date: string) => {
        if (date === todayKey()) return makeRecord(date, 5);
        if (date === daysAgoKey(2)) return makeRecord(date, 6);
        return undefined;
      });
      const config = makeConfig({ budgetWeeklyLimitUsd: 10 });
      const result = budgetStore.checkBudget(config);
      expect(result).not.toBeNull();
      expect(result!.period).toBe('weekly');
    });
  });

  describe('getWarnings', () => {
    it('returns empty when no limits set', () => {
      const config = makeConfig();
      expect(budgetStore.getWarnings(config)).toEqual([]);
    });

    it('returns warning when above 80%', () => {
      mockSummaryStore.getRecordByDate.mockImplementation((date: string) =>
        date === todayKey() ? makeRecord(date, 8.5) : undefined,
      );
      const config = makeConfig({ budgetDailyLimitUsd: 10 });
      const warnings = budgetStore.getWarnings(config);
      expect(warnings.length).toBe(1);
      expect(warnings[0].period).toBe('daily');
      expect(warnings[0].percentage).toBe(85);
    });

    it('returns no warning when under 80%', () => {
      mockSummaryStore.getRecordByDate.mockImplementation((date: string) =>
        date === todayKey() ? makeRecord(date, 7.9) : undefined,
      );
      const config = makeConfig({ budgetDailyLimitUsd: 10 });
      expect(budgetStore.getWarnings(config)).toEqual([]);
    });
  });

  describe('setLimit', () => {
    it('mutates config', () => {
      const config = makeConfig();
      budgetStore.setLimit(config, 'daily', 15);
      expect(config.budgetDailyLimitUsd).toBe(15);
    });
  });
});
