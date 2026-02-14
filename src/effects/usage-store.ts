import type { TokenUsage } from '../types.js';
import { emptyTokenUsage, mergeTokenUsage } from '../modules/token-usage.js';

/** Global usage statistics snapshot since bot startup */
export interface GlobalUsageStats {
  bootedAt: Date;
  totalSessions: number;
  completedQueries: number;
  totalUsage: TokenUsage;
  totalCostUsd: number;
  totalDurationMs: number;
}

/** Cumulative usage record for a single session */
export interface SessionUsageRecord {
  usage: TokenUsage;
  costUsd: number;
  durationMs: number;
}

/** Global token usage tracking (in-memory, resets on restart) */
export class UsageStore {
  private bootedAt = new Date();
  private totalSessions = 0;
  private completedQueries = 0;
  private totalUsage: TokenUsage = emptyTokenUsage();
  private totalCostUsd = 0;
  private totalDurationMs = 0;
  private sessionUsage = new Map<string, SessionUsageRecord>();

  /** Record a new session start, incrementing the totalSessions count */
  recordSessionStart(): void {
    this.totalSessions++;
  }

  /**
   * Record usage from a query result, updating both global and session-level statistics
   * @param threadId - Discord Thread ID
   * @param usage - Token usage for this query
   * @param costUsd - Cost in USD for this query
   * @param durationMs - Duration in milliseconds for this query
   */
  recordResult(threadId: string, usage: TokenUsage, costUsd: number, durationMs: number): void {
    this.completedQueries++;
    this.totalUsage = mergeTokenUsage(this.totalUsage, usage);
    this.totalCostUsd += costUsd;
    this.totalDurationMs += durationMs;

    const existing = this.sessionUsage.get(threadId);
    if (existing) {
      existing.usage = mergeTokenUsage(existing.usage, usage);
      existing.costUsd += costUsd;
      existing.durationMs += durationMs;
    } else {
      this.sessionUsage.set(threadId, { usage: { ...usage }, costUsd, durationMs });
    }
  }

  /**
   * Get a snapshot of global usage statistics
   * @returns A snapshot object containing boot time, session count, token usage, etc.
   */
  getGlobalStats(): GlobalUsageStats {
    return {
      bootedAt: this.bootedAt,
      totalSessions: this.totalSessions,
      completedQueries: this.completedQueries,
      totalUsage: { ...this.totalUsage },
      totalCostUsd: this.totalCostUsd,
      totalDurationMs: this.totalDurationMs,
    };
  }

  /**
   * Get cumulative usage for a specified session
   * @param threadId - Discord Thread ID
   * @returns The usage record, or undefined if not found
   */
  getSessionUsage(threadId: string): SessionUsageRecord | undefined {
    const record = this.sessionUsage.get(threadId);
    if (!record) return undefined;
    return { usage: { ...record.usage }, costUsd: record.costUsd, durationMs: record.durationMs };
  }
}
