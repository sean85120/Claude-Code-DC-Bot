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

/** Cumulative usage record for a single user */
export interface UserUsageRecord {
  usage: TokenUsage;
  costUsd: number;
  durationMs: number;
  totalQueries: number;
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
  private userUsage = new Map<string, UserUsageRecord>();

  /** Record a new session start, incrementing the totalSessions count */
  recordSessionStart(): void {
    this.totalSessions++;
  }

  /**
   * Record usage from a query result, updating global, session-level, and per-user statistics
   * @param threadId - Discord Thread ID
   * @param usage - Token usage for this query
   * @param costUsd - Cost in USD for this query
   * @param durationMs - Duration in milliseconds for this query
   * @param userId - Optional Discord user ID for per-user tracking
   */
  recordResult(threadId: string, usage: TokenUsage, costUsd: number, durationMs: number, userId?: string): void {
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

    // Per-user tracking
    if (userId) {
      const userRecord = this.userUsage.get(userId);
      if (userRecord) {
        userRecord.usage = mergeTokenUsage(userRecord.usage, usage);
        userRecord.costUsd += costUsd;
        userRecord.durationMs += durationMs;
        userRecord.totalQueries++;
      } else {
        this.userUsage.set(userId, {
          usage: { ...usage },
          costUsd,
          durationMs,
          totalQueries: 1,
        });
      }
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

  /**
   * Get cumulative usage for a specified user
   * @param userId - Discord user ID
   * @returns The user usage record, or undefined if not found
   */
  getUserUsage(userId: string): UserUsageRecord | undefined {
    const record = this.userUsage.get(userId);
    if (!record) return undefined;
    return { usage: { ...record.usage }, costUsd: record.costUsd, durationMs: record.durationMs, totalQueries: record.totalQueries };
  }

  /**
   * Get all per-user usage records
   * @returns A new Map of userId → UserUsageRecord (copies)
   */
  getAllUserUsage(): Map<string, UserUsageRecord> {
    const result = new Map<string, UserUsageRecord>();
    for (const [userId, record] of this.userUsage) {
      result.set(userId, {
        usage: { ...record.usage },
        costUsd: record.costUsd,
        durationMs: record.durationMs,
        totalQueries: record.totalQueries,
      });
    }
    return result;
  }
}
