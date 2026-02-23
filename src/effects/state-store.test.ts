import { describe, it, expect } from 'vitest';
import { StateStore } from './state-store.js';
import type { SessionState, PendingApproval } from '../types.js';

function makeSession(overrides?: Partial<SessionState>): SessionState {
  return {
    sessionId: null,
    platform: 'discord',
    status: 'running',
    threadId: 'thread-1',
    userId: 'user-1',
    startedAt: new Date(),
    lastActivityAt: new Date(),
    promptText: 'test prompt',
    cwd: '/test',
    model: 'claude-sonnet-4-5-20250929',
    toolCount: 0,
    tools: {},
    pendingApproval: null,
    abortController: new AbortController(),
    transcript: [],
    allowedTools: new Set(),
    ...overrides,
  };
}

describe('StateStore', () => {
  it('setSession / getSession', () => {
    const store = new StateStore();
    const session = makeSession();
    store.setSession('t1', session);
    expect(store.getSession('t1')).toBe(session);
  });

  it('getSession returns null when not found', () => {
    const store = new StateStore();
    expect(store.getSession('nonexistent')).toBeNull();
  });

  it('clearSession removes the session', () => {
    const store = new StateStore();
    store.setSession('t1', makeSession());
    store.clearSession('t1');
    expect(store.getSession('t1')).toBeNull();
  });

  it('updateSession partially updates', () => {
    const store = new StateStore();
    store.setSession('t1', makeSession());
    store.updateSession('t1', { status: 'completed' });
    expect(store.getSession('t1')?.status).toBe('completed');
  });

  it('updateSession does nothing for nonexistent session', () => {
    const store = new StateStore();
    // should not throw
    store.updateSession('nonexistent', { status: 'error' });
  });

  it('recordToolUse accumulates count', () => {
    const store = new StateStore();
    store.setSession('t1', makeSession());
    store.recordToolUse('t1', 'Read');
    store.recordToolUse('t1', 'Read');
    store.recordToolUse('t1', 'Write');
    const session = store.getSession('t1')!;
    expect(session.toolCount).toBe(3);
    expect(session.tools['Read']).toBe(2);
    expect(session.tools['Write']).toBe(1);
  });

  it('getAllActiveSessions excludes completed/error', () => {
    const store = new StateStore();
    store.setSession('t1', makeSession({ status: 'running' }));
    store.setSession('t2', makeSession({ status: 'completed' }));
    store.setSession('t3', makeSession({ status: 'error' }));
    store.setSession('t4', makeSession({ status: 'awaiting_permission' }));
    const active = store.getAllActiveSessions();
    expect(active.size).toBe(2);
    expect(active.has('t1')).toBe(true);
    expect(active.has('t4')).toBe(true);
  });

  it('getActiveSessionCount', () => {
    const store = new StateStore();
    store.setSession('t1', makeSession({ status: 'running' }));
    store.setSession('t2', makeSession({ status: 'completed' }));
    expect(store.getActiveSessionCount()).toBe(1);
  });

  it('setPendingApproval / getPendingApproval', () => {
    const store = new StateStore();
    store.setSession('t1', makeSession());

    const approval: PendingApproval = {
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      messageId: 'msg-1',
      resolve: () => {},
      createdAt: new Date(),
    };

    store.setPendingApproval('t1', approval);
    expect(store.getPendingApproval('t1')).toBe(approval);
    expect(store.getSession('t1')?.status).toBe('awaiting_permission');
  });

  it('recordToolUse does nothing for nonexistent session', () => {
    const store = new StateStore();
    // should not throw
    store.recordToolUse('nonexistent', 'Read');
  });

  it('getPendingApproval returns null for nonexistent session', () => {
    const store = new StateStore();
    expect(store.getPendingApproval('nonexistent')).toBeNull();
  });

  it('setPendingApproval does nothing for nonexistent session', () => {
    const store = new StateStore();
    store.setPendingApproval('nonexistent', {
      toolName: 'Bash',
      toolInput: {},
      messageId: 'msg',
      resolve: () => {},
      createdAt: new Date(),
    });
    // no session should be created
    expect(store.getSession('nonexistent')).toBeNull();
  });

  it('resolvePendingApproval does nothing when no pending approval', () => {
    const store = new StateStore();
    store.setSession('t1', makeSession());
    // should not throw
    store.resolvePendingApproval('t1', { behavior: 'deny', message: 'test' });
    expect(store.getSession('t1')?.status).toBe('running');
  });

  it('clearSession does nothing for nonexistent key', () => {
    const store = new StateStore();
    store.clearSession('nonexistent');
    // should not throw
  });

  it('updateSession updates lastActivityAt', () => {
    const store = new StateStore();
    const oldDate = new Date(2020, 0, 1);
    store.setSession('t1', makeSession({ lastActivityAt: oldDate }));
    store.updateSession('t1', { status: 'completed' });
    expect(store.getSession('t1')!.lastActivityAt.getTime()).toBeGreaterThan(oldDate.getTime());
  });

  it('getAllActiveSessions includes waiting_input', () => {
    const store = new StateStore();
    store.setSession('t1', makeSession({ status: 'waiting_input' }));
    expect(store.getAllActiveSessions().size).toBe(1);
  });

  it('addAllowedTool adds tool to session', () => {
    const store = new StateStore();
    store.setSession('t1', makeSession());
    store.addAllowedTool('t1', 'Bash');
    expect(store.getSession('t1')!.allowedTools.has('Bash')).toBe(true);
  });

  it('addAllowedTool does nothing for nonexistent session', () => {
    const store = new StateStore();
    // should not throw
    store.addAllowedTool('nonexistent', 'Bash');
  });

  it('isToolAllowed returns false for unknown session', () => {
    const store = new StateStore();
    expect(store.isToolAllowed('nonexistent', 'Bash')).toBe(false);
  });

  it('isToolAllowed returns false for tool not in set', () => {
    const store = new StateStore();
    store.setSession('t1', makeSession());
    expect(store.isToolAllowed('t1', 'Bash')).toBe(false);
  });

  it('isToolAllowed returns true after addAllowedTool', () => {
    const store = new StateStore();
    store.setSession('t1', makeSession());
    store.addAllowedTool('t1', 'Bash');
    expect(store.isToolAllowed('t1', 'Bash')).toBe(true);
    // Different tool should still be false
    expect(store.isToolAllowed('t1', 'Write')).toBe(false);
  });

  it('resolvePendingApproval', () => {
    const store = new StateStore();
    store.setSession('t1', makeSession());

    let resolved = false;
    const approval: PendingApproval = {
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      messageId: 'msg-1',
      resolve: () => { resolved = true; },
      createdAt: new Date(),
    };

    store.setPendingApproval('t1', approval);
    store.resolvePendingApproval('t1', { behavior: 'allow' });

    expect(resolved).toBe(true);
    expect(store.getPendingApproval('t1')).toBeNull();
    expect(store.getSession('t1')?.status).toBe('running');
  });
});
