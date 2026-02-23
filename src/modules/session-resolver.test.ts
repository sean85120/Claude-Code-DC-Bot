import { describe, it, expect } from 'vitest';
import { resolveThreadId } from './session-resolver.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { StateStore } from '../effects/state-store.js';

function makeInteraction(inThread: boolean, channelId = 'ch1'): ChatInputCommandInteraction {
  return {
    channel: inThread
      ? { id: channelId, isThread: () => true }
      : { id: channelId, isThread: () => false },
  } as unknown as ChatInputCommandInteraction;
}

function makeStoreWithSessions(threadIds: string[]): StateStore {
  const store = new StateStore();
  for (const id of threadIds) {
    store.setSession(id, {
      sessionId: null,
      platform: 'discord',
      status: 'running',
      threadId: id,
      userId: 'u1',
      startedAt: new Date(),
      lastActivityAt: new Date(),
      promptText: 'test',
      cwd: '/test',
      model: 'model',
      toolCount: 0,
      tools: {},
      pendingApproval: null,
      abortController: new AbortController(),
      transcript: [],
    });
  }
  return store;
}

describe('resolveThreadId', () => {
  it('returns the thread ID when inside a thread', () => {
    const store = new StateStore();
    const result = resolveThreadId(makeInteraction(true, 'thread-123'), store);
    expect(result).toBe('thread-123');
  });

  it('returns the threadId of the single active session when not in a thread', () => {
    const store = makeStoreWithSessions(['t1']);
    const result = resolveThreadId(makeInteraction(false), store);
    expect(result).toBe('t1');
  });

  it('returns null when not in a thread and there are multiple active sessions', () => {
    const store = makeStoreWithSessions(['t1', 't2']);
    const result = resolveThreadId(makeInteraction(false), store);
    expect(result).toBeNull();
  });

  it('returns null when not in a thread and there are no active sessions', () => {
    const store = new StateStore();
    const result = resolveThreadId(makeInteraction(false), store);
    expect(result).toBeNull();
  });
});
