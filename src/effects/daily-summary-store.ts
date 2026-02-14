import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DailyRecord, CompletedSessionRecord } from '../types.js';
import { emptyTokenUsage, mergeTokenUsage } from '../modules/token-usage.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'DailySummaryStore' });

/**
 * Persistent daily summary tracking, backed by a JSON file.
 * Tracks completed sessions per calendar day and survives bot restarts.
 */
export class DailySummaryStore {
  private dataFilePath: string;
  private currentRecord: DailyRecord;

  constructor(dataDir = process.cwd()) {
    this.dataFilePath = resolve(dataDir, 'daily-summary.json');
    this.currentRecord = this.loadOrCreateTodayRecord();
  }

  /** Get today's date as YYYY-MM-DD in UTC */
  private getTodayDateKey(): string {
    return new Date().toISOString().split('T')[0];
  }

  /** Load all historical records from the JSON file */
  private loadAllRecords(): DailyRecord[] {
    if (!existsSync(this.dataFilePath)) {
      return [];
    }
    try {
      const raw = readFileSync(this.dataFilePath, 'utf-8');
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data as DailyRecord[];
    } catch (error) {
      log.warn({ err: error }, 'Failed to load daily summary data, starting fresh');
      return [];
    }
  }

  /** Save all records to the JSON file */
  private saveAllRecords(records: DailyRecord[]): void {
    try {
      writeFileSync(this.dataFilePath, JSON.stringify(records, null, 2), 'utf-8');
    } catch (error) {
      log.error({ err: error }, 'Failed to save daily summary data');
    }
  }

  /** Load today's record from file, or create a fresh one */
  private loadOrCreateTodayRecord(): DailyRecord {
    const today = this.getTodayDateKey();
    const allRecords = this.loadAllRecords();
    const todayRecord = allRecords.find((r) => r.date === today);

    if (todayRecord) {
      return todayRecord;
    }

    return {
      date: today,
      sessions: [],
      totalCostUsd: 0,
      totalUsage: emptyTokenUsage(),
      totalDurationMs: 0,
    };
  }

  /** Rotate to a new day's record if the date has changed */
  private rotateIfNeeded(): void {
    const today = this.getTodayDateKey();
    if (this.currentRecord.date !== today) {
      // Persist the old record
      this.persistCurrentRecord();
      // Start a fresh record for today
      this.currentRecord = this.loadOrCreateTodayRecord();
      log.info({ date: today }, 'Rotated to new daily record');
    }
  }

  /** Save the current in-memory record to the JSON file */
  private persistCurrentRecord(): void {
    const allRecords = this.loadAllRecords();
    const filtered = allRecords.filter((r) => r.date !== this.currentRecord.date);
    filtered.push(this.currentRecord);
    // Keep only last 30 days to avoid unbounded growth
    filtered.sort((a, b) => a.date.localeCompare(b.date));
    const trimmed = filtered.length > 30 ? filtered.slice(-30) : filtered;
    this.saveAllRecords(trimmed);
  }

  /**
   * Record a completed session into today's daily record
   * @param session - The completed session record
   */
  recordCompletedSession(session: CompletedSessionRecord): void {
    this.rotateIfNeeded();

    this.currentRecord.sessions.push(session);
    this.currentRecord.totalCostUsd += session.costUsd;
    this.currentRecord.totalUsage = mergeTokenUsage(this.currentRecord.totalUsage, session.usage);
    this.currentRecord.totalDurationMs += session.durationMs;

    this.persistCurrentRecord();

    log.info(
      { threadId: session.threadId, project: session.projectName },
      'Recorded completed session for daily summary',
    );
  }

  /**
   * Get today's daily record (read-only copy)
   * @returns A copy of today's record
   */
  getTodayRecord(): DailyRecord {
    this.rotateIfNeeded();
    return {
      ...this.currentRecord,
      sessions: [...this.currentRecord.sessions],
      totalUsage: { ...this.currentRecord.totalUsage },
    };
  }

  /**
   * Get yesterday's daily record (read-only copy).
   * Used by the summary scheduler to post a complete summary of the previous day.
   * @returns A copy of yesterday's record, or a fresh empty record if none exists
   */
  getYesterdayRecord(): DailyRecord {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayKey = yesterday.toISOString().split('T')[0];

    // If current record happens to be yesterday (e.g. no rotation yet), return it
    if (this.currentRecord.date === yesterdayKey) {
      return {
        ...this.currentRecord,
        sessions: [...this.currentRecord.sessions],
        totalUsage: { ...this.currentRecord.totalUsage },
      };
    }

    // Look in persisted records
    const allRecords = this.loadAllRecords();
    const record = allRecords.find((r) => r.date === yesterdayKey);
    if (record) {
      return {
        ...record,
        sessions: [...record.sessions],
        totalUsage: { ...record.totalUsage },
      };
    }

    // No data for yesterday
    return {
      date: yesterdayKey,
      sessions: [],
      totalCostUsd: 0,
      totalUsage: emptyTokenUsage(),
      totalDurationMs: 0,
    };
  }

  /**
   * Get a record for a specific date
   * @param date - Date string in YYYY-MM-DD format
   * @returns The record for that date, or undefined
   */
  getRecordByDate(date: string): DailyRecord | undefined {
    if (date === this.currentRecord.date) {
      return this.getTodayRecord();
    }
    const allRecords = this.loadAllRecords();
    return allRecords.find((r) => r.date === date);
  }

  /**
   * Clear today's data (for testing or manual reset)
   */
  clearToday(): void {
    this.currentRecord = {
      date: this.getTodayDateKey(),
      sessions: [],
      totalCostUsd: 0,
      totalUsage: emptyTokenUsage(),
      totalDurationMs: 0,
    };

    const allRecords = this.loadAllRecords();
    const filtered = allRecords.filter((r) => r.date !== this.currentRecord.date);
    this.saveAllRecords(filtered);
  }
}
