import type { BotConfig, BudgetCheckResult, BudgetWarning } from '../types.js';
import type { DailySummaryStore } from './daily-summary-store.js';

/**
 * Budget store that checks spending against configured limits.
 * Uses DailySummaryStore data — no separate persistence needed.
 */
export class BudgetStore {
  constructor(private summaryStore: DailySummaryStore) {}

  /**
   * Get total spending for a date range by summing daily records
   */
  private getSpendingForDays(days: number): number {
    let total = 0;
    const now = new Date();
    for (let i = 0; i < days; i++) {
      const date = new Date(now);
      date.setUTCDate(date.getUTCDate() - i);
      const key = date.toISOString().split('T')[0];
      const record = this.summaryStore.getRecordByDate(key);
      if (record) {
        total += record.totalCostUsd;
      }
    }
    return total;
  }

  /** Get today's spending */
  getDailySpend(): number {
    return this.getSpendingForDays(1);
  }

  /** Get last 7 days spending */
  getWeeklySpend(): number {
    return this.getSpendingForDays(7);
  }

  /** Get last 30 days spending */
  getMonthlySpend(): number {
    return this.getSpendingForDays(30);
  }

  /**
   * Check if any budget limit is exceeded.
   * Returns the first exceeded limit, or null if all within budget.
   */
  checkBudget(config: BotConfig): BudgetCheckResult | null {
    const checks: Array<{ period: BudgetCheckResult['period']; limit: number; spent: number }> = [
      { period: 'daily', limit: config.budgetDailyLimitUsd, spent: this.getDailySpend() },
      { period: 'weekly', limit: config.budgetWeeklyLimitUsd, spent: this.getWeeklySpend() },
      { period: 'monthly', limit: config.budgetMonthlyLimitUsd, spent: this.getMonthlySpend() },
    ];

    for (const check of checks) {
      if (check.limit > 0 && check.spent >= check.limit) {
        return { exceeded: true, period: check.period, spent: check.spent, limit: check.limit };
      }
    }
    return null;
  }

  /**
   * Check if any budget is above 80% — used for warnings after session completion.
   * Returns all warnings (may be multiple periods).
   */
  getWarnings(config: BotConfig): BudgetWarning[] {
    const warnings: BudgetWarning[] = [];
    const checks: Array<{ period: BudgetWarning['period']; limit: number; spent: number }> = [
      { period: 'daily', limit: config.budgetDailyLimitUsd, spent: this.getDailySpend() },
      { period: 'weekly', limit: config.budgetWeeklyLimitUsd, spent: this.getWeeklySpend() },
      { period: 'monthly', limit: config.budgetMonthlyLimitUsd, spent: this.getMonthlySpend() },
    ];

    for (const check of checks) {
      if (check.limit > 0) {
        const pct = (check.spent / check.limit) * 100;
        if (pct >= 80) {
          warnings.push({ period: check.period, spent: check.spent, limit: check.limit, percentage: pct });
        }
      }
    }
    return warnings;
  }

  /**
   * Set a budget limit at runtime (mutates config in-memory)
   */
  setLimit(config: BotConfig, period: 'daily' | 'weekly' | 'monthly', amount: number): void {
    const key: keyof BotConfig =
      period === 'daily' ? 'budgetDailyLimitUsd'
      : period === 'weekly' ? 'budgetWeeklyLimitUsd'
      : 'budgetMonthlyLimitUsd';
    (config as unknown as Record<string, unknown>)[key] = amount;
  }
}
