import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SessionState, RecoverableSession } from '../types.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'SessionRecoveryStore' });

/**
 * Persistent session recovery store, backed by a JSON file.
 * Tracks active sessions so the bot can notify users and offer retry after a restart.
 *
 * Follows the same pattern as DailySummaryStore:
 * - Loaded once from disk at construction
 * - Written to disk on every mutation
 * - Recoverable sessions are read at startup, then cleared
 */
export class SessionRecoveryStore {
  private dataFilePath: string;
  private sessions: RecoverableSession[];

  constructor(dataDir = process.cwd()) {
    this.dataFilePath = resolve(dataDir, 'active-sessions.json');
    this.sessions = this.loadFromDisk();
  }

  /** Load sessions from the JSON file (called once at startup) */
  private loadFromDisk(): RecoverableSession[] {
    if (!existsSync(this.dataFilePath)) {
      return [];
    }
    try {
      const raw = readFileSync(this.dataFilePath, 'utf-8');
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data as RecoverableSession[];
    } catch (error) {
      log.warn({ err: error }, 'Failed to load active sessions data, starting fresh');
      return [];
    }
  }

  /** Write the in-memory sessions to disk */
  private saveToDisk(): void {
    try {
      writeFileSync(this.dataFilePath, JSON.stringify(this.sessions, null, 2), 'utf-8');
    } catch (error) {
      log.error({ err: error }, 'Failed to save active sessions data');
    }
  }

  /**
   * Persist a session snapshot (called on session state changes)
   * @param session - The current session state
   */
  persist(session: SessionState): void {
    const record: RecoverableSession = {
      threadId: session.threadId,
      userId: session.userId,
      promptText: session.promptText,
      cwd: session.cwd,
      model: session.model,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      lastActivityAt: session.lastActivityAt.toISOString(),
    };

    const idx = this.sessions.findIndex((s) => s.threadId === session.threadId);
    if (idx >= 0) {
      this.sessions[idx] = record;
    } else {
      this.sessions.push(record);
    }

    this.saveToDisk();
  }

  /**
   * Remove a session from the recovery file (called on completion/clear/error)
   * @param threadId - Discord Thread ID
   */
  remove(threadId: string): void {
    const before = this.sessions.length;
    this.sessions = this.sessions.filter((s) => s.threadId !== threadId);
    if (this.sessions.length !== before) {
      this.saveToDisk();
    }
  }

  /**
   * Get all sessions that were active at last shutdown.
   * These are sessions that were not properly cleaned up (running, awaiting_permission, waiting_input).
   * @returns Array of recoverable sessions
   */
  getRecoverableSessions(): RecoverableSession[] {
    return [...this.sessions];
  }

  /**
   * Clear all recovery data (called after recovery is complete)
   */
  clearAll(): void {
    this.sessions = [];
    this.saveToDisk();
  }

  /**
   * Get the number of persisted sessions
   */
  getCount(): number {
    return this.sessions.length;
  }
}
