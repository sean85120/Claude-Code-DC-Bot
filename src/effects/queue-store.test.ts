import { describe, it, expect, beforeEach } from 'vitest';
import { QueueStore } from './queue-store.js';
import { StateStore } from './state-store.js';
import type { QueueEntry, SessionState } from '../types.js';

function makeEntry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    id: `q-${Date.now()}`,
    userId: 'user-1',
    promptText: 'Fix the bug',
    cwd: '/home/user/project',
    model: 'claude-opus-4-6',
    threadId: 'thread-1',
    queuedAt: new Date(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: 'sess-1',
    status: 'running',
    threadId: 'thread-active',
    userId: 'user-1',
    startedAt: new Date(),
    lastActivityAt: new Date(),
    promptText: 'Active task',
    cwd: '/home/user/project',
    model: 'claude-opus-4-6',
    toolCount: 0,
    tools: {},
    pendingApproval: null,
    abortController: new AbortController(),
    transcript: [],
    ...overrides,
  };
}

describe('QueueStore', () => {
  let store: QueueStore;

  beforeEach(() => {
    store = new QueueStore();
  });

  describe('enqueue', () => {
    it('returns 1-based position', () => {
      const pos = store.enqueue('/project', makeEntry({ threadId: 'thread-1' }));
      expect(pos).toBe(1);

      const pos2 = store.enqueue('/project', makeEntry({ threadId: 'thread-2' }));
      expect(pos2).toBe(2);
    });

    it('creates separate queues per project', () => {
      store.enqueue('/project-a', makeEntry({ threadId: 'thread-1' }));
      store.enqueue('/project-b', makeEntry({ threadId: 'thread-2' }));

      expect(store.getQueue('/project-a')).toHaveLength(1);
      expect(store.getQueue('/project-b')).toHaveLength(1);
    });
  });

  describe('dequeue', () => {
    it('returns first entry (FIFO)', () => {
      store.enqueue('/project', makeEntry({ threadId: 'thread-1', promptText: 'First' }));
      store.enqueue('/project', makeEntry({ threadId: 'thread-2', promptText: 'Second' }));

      const entry = store.dequeue('/project');
      expect(entry).not.toBeNull();
      expect(entry!.threadId).toBe('thread-1');
      expect(entry!.promptText).toBe('First');
    });

    it('returns null for empty queue', () => {
      expect(store.dequeue('/project')).toBeNull();
    });

    it('cleans up empty queue map entry', () => {
      store.enqueue('/project', makeEntry());
      store.dequeue('/project');

      expect(store.getAllQueues().has('/project')).toBe(false);
    });
  });

  describe('cancel', () => {
    it('removes entry by threadId', () => {
      store.enqueue('/project', makeEntry({ threadId: 'thread-1' }));
      store.enqueue('/project', makeEntry({ threadId: 'thread-2' }));

      const removed = store.cancel('/project', 'thread-1');
      expect(removed).toBe(true);
      expect(store.getQueue('/project')).toHaveLength(1);
      expect(store.getQueue('/project')[0].threadId).toBe('thread-2');
    });

    it('returns false for non-existent threadId', () => {
      store.enqueue('/project', makeEntry({ threadId: 'thread-1' }));
      expect(store.cancel('/project', 'thread-999')).toBe(false);
    });

    it('returns false for non-existent project', () => {
      expect(store.cancel('/no-project', 'thread-1')).toBe(false);
    });

    it('cleans up empty queue map entry', () => {
      store.enqueue('/project', makeEntry({ threadId: 'thread-1' }));
      store.cancel('/project', 'thread-1');
      expect(store.getAllQueues().has('/project')).toBe(false);
    });
  });

  describe('getQueue', () => {
    it('returns copy of queue', () => {
      store.enqueue('/project', makeEntry());
      const queue = store.getQueue('/project');
      queue.pop();
      expect(store.getQueue('/project')).toHaveLength(1);
    });

    it('returns empty array for unknown project', () => {
      expect(store.getQueue('/unknown')).toEqual([]);
    });
  });

  describe('getPosition', () => {
    it('returns 1-based position', () => {
      store.enqueue('/project', makeEntry({ threadId: 'thread-1' }));
      store.enqueue('/project', makeEntry({ threadId: 'thread-2' }));
      store.enqueue('/project', makeEntry({ threadId: 'thread-3' }));

      expect(store.getPosition('/project', 'thread-1')).toBe(1);
      expect(store.getPosition('/project', 'thread-2')).toBe(2);
      expect(store.getPosition('/project', 'thread-3')).toBe(3);
    });

    it('returns null for non-existent threadId', () => {
      store.enqueue('/project', makeEntry({ threadId: 'thread-1' }));
      expect(store.getPosition('/project', 'thread-999')).toBeNull();
    });

    it('returns null for non-existent project', () => {
      expect(store.getPosition('/no-project', 'thread-1')).toBeNull();
    });
  });

  describe('getEntryByThreadId', () => {
    it('finds entry across queues', () => {
      store.enqueue('/project-a', makeEntry({ threadId: 'thread-1' }));
      store.enqueue('/project-b', makeEntry({ threadId: 'thread-2', promptText: 'Found me' }));

      const entry = store.getEntryByThreadId('thread-2');
      expect(entry).not.toBeNull();
      expect(entry!.promptText).toBe('Found me');
    });

    it('returns null for non-existent threadId', () => {
      expect(store.getEntryByThreadId('thread-999')).toBeNull();
    });
  });

  describe('isProjectBusy', () => {
    it('returns true when project has running session', () => {
      const stateStore = new StateStore();
      stateStore.setSession('thread-active', makeSession({
        cwd: '/project',
        status: 'running',
      }));

      expect(store.isProjectBusy('/project', stateStore)).toBe(true);
    });

    it('returns true when project has awaiting_permission session', () => {
      const stateStore = new StateStore();
      stateStore.setSession('thread-active', makeSession({
        cwd: '/project',
        status: 'awaiting_permission',
      }));

      expect(store.isProjectBusy('/project', stateStore)).toBe(true);
    });

    it('returns true when project has waiting_input session', () => {
      const stateStore = new StateStore();
      stateStore.setSession('thread-active', makeSession({
        cwd: '/project',
        status: 'waiting_input',
      }));

      expect(store.isProjectBusy('/project', stateStore)).toBe(true);
    });

    it('returns false when no sessions exist for project', () => {
      const stateStore = new StateStore();
      expect(store.isProjectBusy('/project', stateStore)).toBe(false);
    });

    it('ignores sessions for different projects', () => {
      const stateStore = new StateStore();
      stateStore.setSession('thread-active', makeSession({
        cwd: '/other-project',
        status: 'running',
      }));

      expect(store.isProjectBusy('/project', stateStore)).toBe(false);
    });
  });

  describe('getAllQueues', () => {
    it('returns deep copy — mutations do not affect internal state', () => {
      store.enqueue('/project', makeEntry({ threadId: 'thread-1' }));
      const allQueues = store.getAllQueues();
      allQueues.get('/project')!.pop();
      expect(store.getQueue('/project')).toHaveLength(1);
    });
  });

  describe('getTotalQueuedCount', () => {
    it('returns 0 for empty queues', () => {
      expect(store.getTotalQueuedCount()).toBe(0);
    });

    it('sums across all projects', () => {
      store.enqueue('/project-a', makeEntry({ threadId: 'thread-1' }));
      store.enqueue('/project-a', makeEntry({ threadId: 'thread-2' }));
      store.enqueue('/project-b', makeEntry({ threadId: 'thread-3' }));

      expect(store.getTotalQueuedCount()).toBe(3);
    });
  });
});
