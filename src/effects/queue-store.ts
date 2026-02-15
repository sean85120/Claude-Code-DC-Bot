import type { QueueEntry } from '../types.js';
import type { StateStore } from './state-store.js';

/**
 * Per-project queue management for session scheduling.
 *
 * Queues are keyed by project path (cwd). When a user sends `/prompt` and the
 * project already has a running session, the prompt is enqueued instead.
 * When the running session completes, the next entry is dequeued and started.
 */
export class QueueStore {
  private queues = new Map<string, QueueEntry[]>();

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
   * Check if a project has any running session (not queued, not completed/error)
   * @param cwd - Project path
   * @param store - StateStore to check active sessions
   * @returns true if any session for this cwd is in running/awaiting_permission state
   */
  isProjectBusy(cwd: string, store: StateStore): boolean {
    const active = store.getAllActiveSessions();
    for (const session of active.values()) {
      if (
        session.cwd === cwd &&
        (session.status === 'running' || session.status === 'awaiting_permission')
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
    return new Map(this.queues);
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
