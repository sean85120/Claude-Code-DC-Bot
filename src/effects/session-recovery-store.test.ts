import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionRecoveryStore } from './session-recovery-store.js';
import type { SessionState } from '../types.js';

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: 'sess-123',
    status: 'running',
    threadId: 'thread-1',
    userId: 'user-1',
    startedAt: new Date('2025-01-01T10:00:00Z'),
    lastActivityAt: new Date('2025-01-01T10:05:00Z'),
    promptText: 'Fix the bug',
    cwd: '/home/user/project',
    model: 'claude-opus-4-6',
    toolCount: 3,
    tools: { Read: 2, Edit: 1 },
    pendingApproval: null,
    abortController: new AbortController(),
    transcript: [],
    ...overrides,
  };
}

describe('SessionRecoveryStore', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'recovery-test-'));
  });

  afterEach(() => {
    const filePath = join(tempDir, 'active-sessions.json');
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  });

  it('starts with empty sessions when no file exists', () => {
    const store = new SessionRecoveryStore(tempDir);
    expect(store.getRecoverableSessions()).toEqual([]);
    expect(store.getCount()).toBe(0);
  });

  it('persists a session to disk', () => {
    const store = new SessionRecoveryStore(tempDir);
    const session = makeSession();
    store.persist(session);

    expect(store.getCount()).toBe(1);

    // Verify file was written by creating a new store from the same dir
    const store2 = new SessionRecoveryStore(tempDir);
    const recovered = store2.getRecoverableSessions();
    expect(recovered).toHaveLength(1);
    expect(recovered[0].threadId).toBe('thread-1');
    expect(recovered[0].userId).toBe('user-1');
    expect(recovered[0].promptText).toBe('Fix the bug');
    expect(recovered[0].cwd).toBe('/home/user/project');
    expect(recovered[0].model).toBe('claude-opus-4-6');
    expect(recovered[0].status).toBe('running');
  });

  it('updates an existing session on re-persist', () => {
    const store = new SessionRecoveryStore(tempDir);
    const session = makeSession();
    store.persist(session);

    // Update status
    const updated = makeSession({ status: 'awaiting_permission' });
    store.persist(updated);

    expect(store.getCount()).toBe(1);
    const recovered = store.getRecoverableSessions();
    expect(recovered[0].status).toBe('awaiting_permission');
  });

  it('persists multiple sessions', () => {
    const store = new SessionRecoveryStore(tempDir);
    store.persist(makeSession({ threadId: 'thread-1' }));
    store.persist(makeSession({ threadId: 'thread-2', userId: 'user-2' }));
    store.persist(makeSession({ threadId: 'thread-3', userId: 'user-3' }));

    expect(store.getCount()).toBe(3);
  });

  it('removes a session by threadId', () => {
    const store = new SessionRecoveryStore(tempDir);
    store.persist(makeSession({ threadId: 'thread-1' }));
    store.persist(makeSession({ threadId: 'thread-2' }));

    store.remove('thread-1');

    expect(store.getCount()).toBe(1);
    const recovered = store.getRecoverableSessions();
    expect(recovered[0].threadId).toBe('thread-2');
  });

  it('remove is a no-op for non-existent threadId', () => {
    const store = new SessionRecoveryStore(tempDir);
    store.persist(makeSession({ threadId: 'thread-1' }));

    store.remove('non-existent');

    expect(store.getCount()).toBe(1);
  });

  it('clearAll removes all sessions', () => {
    const store = new SessionRecoveryStore(tempDir);
    store.persist(makeSession({ threadId: 'thread-1' }));
    store.persist(makeSession({ threadId: 'thread-2' }));

    store.clearAll();

    expect(store.getCount()).toBe(0);

    // Verify cleared on disk
    const store2 = new SessionRecoveryStore(tempDir);
    expect(store2.getCount()).toBe(0);
  });

  it('getRecoverableSessions returns a copy (not a reference)', () => {
    const store = new SessionRecoveryStore(tempDir);
    store.persist(makeSession());

    const sessions = store.getRecoverableSessions();
    sessions.pop();

    // Original should be unaffected
    expect(store.getCount()).toBe(1);
  });

  it('survives corrupted file gracefully', async () => {
    // Write invalid JSON to the file
    const { writeFileSync } = await import('node:fs');
    const filePath = join(tempDir, 'active-sessions.json');
    writeFileSync(filePath, 'not valid json{{{', 'utf-8');

    const store = new SessionRecoveryStore(tempDir);
    expect(store.getRecoverableSessions()).toEqual([]);
    expect(store.getCount()).toBe(0);
  });

  it('survives non-array file content', async () => {
    const { writeFileSync } = await import('node:fs');
    const filePath = join(tempDir, 'active-sessions.json');
    writeFileSync(filePath, '{"not": "an array"}', 'utf-8');

    const store = new SessionRecoveryStore(tempDir);
    expect(store.getRecoverableSessions()).toEqual([]);
  });

  it('serializes dates as ISO strings', () => {
    const store = new SessionRecoveryStore(tempDir);
    const session = makeSession({
      startedAt: new Date('2025-06-15T12:30:00Z'),
      lastActivityAt: new Date('2025-06-15T12:35:00Z'),
    });
    store.persist(session);

    const recovered = store.getRecoverableSessions();
    expect(recovered[0].startedAt).toBe('2025-06-15T12:30:00.000Z');
    expect(recovered[0].lastActivityAt).toBe('2025-06-15T12:35:00.000Z');
  });
});
