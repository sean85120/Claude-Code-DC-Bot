import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DailyRecord, CompletedSessionRecord } from '../types.js';
import { emptyTokenUsage, mergeTokenUsage } from '../modules/token-usage.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'DailySummaryStore' });

/** Maximum number of days to retain in the JSON file */
const MAX_DAYS = 30;

/**
 * Persistent daily summary tracking, backed by a JSON file.
 * Tracks completed sessions per calendar day and survives bot restarts.
 *
 * All records are kept in memory after the initial load to avoid
 * re-reading the file on every write. The file is only read once
 * at construction time.
 */
export class DailySummaryStore {
  private dataFilePath: string;
  private allRecords: DailyRecord[];
  private currentRecord: DailyRecord;

  constructor(dataDir = process.cwd()) {
    this.dataFilePath = resolve(dataDir, 'daily-summary.json');
    this.allRecords = this.loadFromDisk();
    this.currentRecord = this.findOrCreateTodayRecord();
  }

  /** Get today's date as YYYY-MM-DD in UTC */
  private getTodayDateKey(): string {
    return new Date().toISOString().split('T')[0];
  }

  /** Load all records from the JSON file (called once at startup) */
  private loadFromDisk(): DailyRecord[] {
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

  /** Write the in-memory records to disk */
  private saveToDisk(): void {
    try {
      writeFileSync(this.dataFilePath, JSON.stringify(this.allRecords, null, 2), 'utf-8');
    } catch (error) {
      log.error({ err: error }, 'Failed to save daily summary data');
    }
  }

  /** Find today's record in the in-memory array, or create a fresh one */
  private findOrCreateTodayRecord(): DailyRecord {
    const today = this.getTodayDateKey();
    const existing = this.allRecords.find((r) => r.date === today);
    if (existing) return existing;

    const fresh: DailyRecord = {
      date: today,
      sessions: [],
      totalCostUsd: 0,
      totalUsage: emptyTokenUsage(),
      totalDurationMs: 0,
    };
    this.allRecords.push(fresh);
    return fresh;
  }

  /** Rotate to a new day's record if the date has changed, pruning old data */
  private rotateIfNeeded(): void {
    const today = this.getTodayDateKey();
    if (this.currentRecord.date !== today) {
      this.currentRecord = this.findOrCreateTodayRecord();
      this.pruneOldRecords();
      this.saveToDisk();
      log.info({ date: today }, 'Rotated to new daily record');
    }
  }

  /** Keep only the last MAX_DAYS records */
  private pruneOldRecords(): void {
    if (this.allRecords.length > MAX_DAYS) {
      this.allRecords.sort((a, b) => a.date.localeCompare(b.date));
      this.allRecords = this.allRecords.slice(-MAX_DAYS);
    }
  }

  /** Return a deep clone of a DailyRecord */
  private cloneRecord(record: DailyRecord): DailyRecord {
    return structuredClone(record);
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

    this.saveToDisk();

    log.info(
      { threadId: session.threadId, project: session.projectName },
      'Recorded completed session for daily summary',
    );
  }

  /**
   * Get today's daily record (deep copy — safe to mutate)
   * @returns A deep clone of today's record
   */
  getTodayRecord(): DailyRecord {
    this.rotateIfNeeded();
    return this.cloneRecord(this.currentRecord);
  }

  /**
   * Get yesterday's daily record (deep copy).
   * Used by the summary scheduler to post a complete summary of the previous day.
   * @returns A deep clone of yesterday's record, or a fresh empty record if none exists
   */
  getYesterdayRecord(): DailyRecord {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayKey = yesterday.toISOString().split('T')[0];

    const record = this.allRecords.find((r) => r.date === yesterdayKey);
    if (record) {
      return this.cloneRecord(record);
    }

    return {
      date: yesterdayKey,
      sessions: [],
      totalCostUsd: 0,
      totalUsage: emptyTokenUsage(),
      totalDurationMs: 0,
    };
  }

  /**
   * Get a record for a specific date (deep copy)
   * @param date - Date string in YYYY-MM-DD format
   * @returns A deep clone of the record for that date, or undefined
   */
  getRecordByDate(date: string): DailyRecord | undefined {
    const record = this.allRecords.find((r) => r.date === date);
    return record ? this.cloneRecord(record) : undefined;
  }

  /**
   * Clear today's data (for testing or manual reset)
   */
  clearToday(): void {
    const today = this.getTodayDateKey();
    this.allRecords = this.allRecords.filter((r) => r.date !== today);
    this.currentRecord = this.findOrCreateTodayRecord();
    this.saveToDisk();
  }
}
