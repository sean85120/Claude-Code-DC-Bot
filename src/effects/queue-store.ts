import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { QueueEntry } from '../types.js';
import type { StateStore } from './state-store.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'QueueStore' });

/**
 * JSON-serializable queue entry (Date → ISO string).
 */
interface SerializedQueueEntry {
  id: string;
  userId: string;
  promptText: string;
  cwd: string;
  model: string;
  threadId: string;
  queuedAt: string;
}

/**
 * Per-project queue management for session scheduling.
 * Persisted to a JSON file so queued sessions survive bot restarts.
 *
 * Queues are keyed by project path (cwd). When a user sends `/prompt` and the
 * project already has a running session, the prompt is enqueued instead.
 * When the running session completes, the next entry is dequeued and started.
 */
export class QueueStore {
  private queues = new Map<string, QueueEntry[]>();
  private dataFilePath: string;

  constructor(dataDir = process.cwd()) {
    this.dataFilePath = resolve(dataDir, 'queued-sessions.json');
    this.queues = this.loadFromDisk();
  }

  private loadFromDisk(): Map<string, QueueEntry[]> {
    if (!existsSync(this.dataFilePath)) return new Map();
    try {
      const raw = readFileSync(this.dataFilePath, 'utf-8');
      const data = JSON.parse(raw) as Record<string, SerializedQueueEntry[]>;
      const map = new Map<string, QueueEntry[]>();
      for (const [key, entries] of Object.entries(data)) {
        if (!Array.isArray(entries)) continue;
        const parsed = entries.map((e) => ({
          ...e,
          queuedAt: new Date(e.queuedAt),
        }));
        if (parsed.length > 0) {
          map.set(key, parsed);
        }
      }
      return map;
    } catch (error) {
      log.warn({ err: error }, 'Failed to load queued sessions, starting fresh');
      return new Map();
    }
  }

  private saveToDisk(): boolean {
    try {
      const obj: Record<string, SerializedQueueEntry[]> = {};
      for (const [key, entries] of this.queues) {
        obj[key] = entries.map((e) => ({
          ...e,
          queuedAt: e.queuedAt.toISOString(),
        }));
      }
      writeFileSync(this.dataFilePath, JSON.stringify(obj, null, 2), 'utf-8');
      return true;
    } catch (error) {
      log.error({ err: error }, 'Failed to save queued sessions');
      return false;
    }
  }

  /**
   * Add an entry to the project queue
   * @param cwd - Project path (queue key)
   * @param entry - Queue entry
   * @returns 1-based queue position
   */
  enqueue(cwd: string, entry: QueueEntry): number {
    const queue = this.queues.get(cwd) ?? [];
    queue.push(entry);
    this.queues.set(cwd, queue);
    this.saveToDisk();
    return queue.length;
  }

  /**
   * Remove and return the first entry from the project queue
   * @param cwd - Project path (queue key)
   * @returns The next entry, or null if queue is empty
   */
  dequeue(cwd: string): QueueEntry | null {
    const queue = this.queues.get(cwd);
    if (!queue || queue.length === 0) return null;
    const entry = queue.shift()!;
    if (queue.length === 0) {
      this.queues.delete(cwd);
    }
    this.saveToDisk();
    return entry;
  }

  /**
   * Cancel (remove) a queued entry by threadId
   * @param cwd - Project path (queue key)
   * @param threadId - Thread ID to cancel
   * @returns true if an entry was removed
   */
  cancel(cwd: string, threadId: string): boolean {
    const queue = this.queues.get(cwd);
    if (!queue) return false;
    const before = queue.length;
    const filtered = queue.filter((e) => e.threadId !== threadId);
    if (filtered.length === before) return false;
    if (filtered.length === 0) {
      this.queues.delete(cwd);
    } else {
      this.queues.set(cwd, filtered);
    }
    this.saveToDisk();
    return true;
  }

  /**
   * Get the queue for a project (read-only copy)
   * @param cwd - Project path
   * @returns Array of queue entries (empty if no queue)
   */
  getQueue(cwd: string): QueueEntry[] {
    return [...(this.queues.get(cwd) ?? [])];
  }

  /**
   * Get 1-based position of a thread in its project queue
   * @param cwd - Project path
   * @param threadId - Thread ID to find
   * @returns 1-based position, or null if not found
   */
  getPosition(cwd: string, threadId: string): number | null {
    const queue = this.queues.get(cwd);
    if (!queue) return null;
    const idx = queue.findIndex((e) => e.threadId === threadId);
    return idx >= 0 ? idx + 1 : null;
  }

  /**
   * Search all queues for an entry by threadId
   * @param threadId - Thread ID to find
   * @returns The entry, or null if not found
   */
  getEntryByThreadId(threadId: string): QueueEntry | null {
    for (const queue of this.queues.values()) {
      const entry = queue.find((e) => e.threadId === threadId);
      if (entry) return entry;
    }
    return null;
  }

  /**
   * Check if a project has any active session (running, awaiting_permission, or waiting_input).
   * `waiting_input` is included because it represents a live session that can receive follow-ups,
   * and running two Claude subprocesses on the same project directory concurrently could cause conflicts.
   * @param cwd - Project path
   * @param store - StateStore to check active sessions
   * @returns true if any session for this cwd is in an active state
   */
  isProjectBusy(cwd: string, store: StateStore): boolean {
    const active = store.getAllActiveSessions();
    for (const session of active.values()) {
      if (
        session.cwd === cwd &&
        (session.status === 'running' || session.status === 'awaiting_permission' || session.status === 'waiting_input')
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all queues (for status display)
   * @returns Map of project path to queue entries
   */
  getAllQueues(): Map<string, QueueEntry[]> {
    const copy = new Map<string, QueueEntry[]>();
    for (const [key, entries] of this.queues) {
      copy.set(key, [...entries]);
    }
    return copy;
  }

  /**
   * Get total number of queued entries across all projects
   */
  getTotalQueuedCount(): number {
    let count = 0;
    for (const queue of this.queues.values()) {
      count += queue.length;
    }
    return count;
  }
}
