import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { StateStore } from '../effects/state-store.js';
import type { BotConfig, SessionState } from '../types.js';
import { execute } from './retry.js';

vi.mock('../effects/discord-sender.js', () => ({
  deferReply: vi.fn().mockResolvedValue(undefined),
  editReply: vi.fn().mockResolvedValue(undefined),
  sendInThread: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../modules/embeds.js', () => ({
  buildRetryEmbed: vi.fn().mockReturnValue({ title: 'retry' }),
}));

import { editReply } from '../effects/discord-sender.js';

const mockConfig: BotConfig = {
  discordToken: 'token',
  discordGuildId: 'guild',
  discordChannelId: 'channel-1',
  discordClientId: 'client-id',
  allowedUserIds: ['user-1'],
  defaultCwd: '/test',
  defaultModel: 'model',
  defaultPermissionMode: 'default',
  maxMessageLength: 2000,
  streamUpdateIntervalMs: 2000,
  rateLimitWindowMs: 60000,
  rateLimitMaxRequests: 5,
  projects: [],
};

function makeSession(threadId: string, overrides?: Partial<SessionState>): SessionState {
  return {
    sessionId: 'sess-1',
    status: 'completed',
    threadId,
    userId: 'user-1',
    startedAt: new Date(),
    lastActivityAt: new Date(),
    promptText: 'Original prompt',
    cwd: '/test',
    model: 'claude-opus-4-6',
    toolCount: 5,
    tools: { Read: 3, Write: 2 },
    pendingApproval: null,
    abortController: new AbortController(),
    transcript: [],
    ...overrides,
  };
}

function makeInteraction(inThread: boolean, threadId = 'thread-1') {
  return {
    user: { id: 'user-1' },
    channelId: inThread ? threadId : 'channel-1',
    channel: inThread
      ? { isThread: () => true, id: threadId, parentId: 'channel-1' }
      : { isThread: () => false, parentId: null },
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown;
}

describe('retry execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('replies with error for unauthorized user', async () => {
    const interaction = {
      user: { id: 'bad' },
      channelId: 'channel-1',
      channel: { parentId: null },
      reply: vi.fn().mockResolvedValue(undefined),
    } as unknown;
    const store = new StateStore();
    const startQuery = vi.fn();
    await execute(interaction as never, mockConfig, store, startQuery);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: [MessageFlags.Ephemeral] }),
    );
  });

  it('prompts when not in a Thread', async () => {
    const interaction = makeInteraction(false);
    const store = new StateStore();
    const startQuery = vi.fn();
    await execute(interaction as never, mockConfig, store, startQuery);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('thread'),
      }),
    );
  });

  it('prompts when no session', async () => {
    const interaction = makeInteraction(true);
    const store = new StateStore();
    const startQuery = vi.fn();
    await execute(interaction as never, mockConfig, store, startQuery);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('No retryable session found'),
      }),
    );
  });

  it('does not allow retry when task is running', async () => {
    const store = new StateStore();
    store.setSession('thread-1', makeSession('thread-1', { status: 'running' }));
    const interaction = makeInteraction(true);
    const startQuery = vi.fn();
    await execute(interaction as never, mockConfig, store, startQuery);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('still running'),
      }),
    );
  });

  it('does not allow retry when awaiting_permission', async () => {
    const store = new StateStore();
    store.setSession('thread-1', makeSession('thread-1', { status: 'awaiting_permission' }));
    const interaction = makeInteraction(true);
    const startQuery = vi.fn();
    await execute(interaction as never, mockConfig, store, startQuery);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('still running'),
      }),
    );
  });

  it('allows retry when completed', async () => {
    const store = new StateStore();
    store.setSession('thread-1', makeSession('thread-1', { status: 'completed' }));
    const interaction = makeInteraction(true);
    const startQuery = vi.fn().mockResolvedValue(undefined);
    await execute(interaction as never, mockConfig, store, startQuery);

    expect(editReply).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({ content: '🔄 Re-executing...' }),
    );

    // New session should keep the original prompt
    const newSession = store.getSession('thread-1');
    expect(newSession?.promptText).toBe('Original prompt');
    expect(newSession?.status).toBe('running');
    expect(newSession?.toolCount).toBe(0);
    expect(newSession?.sessionId).toBeNull();
  });

  it('allows retry when in error state', async () => {
    const store = new StateStore();
    store.setSession('thread-1', makeSession('thread-1', { status: 'error' }));
    const interaction = makeInteraction(true);
    const startQuery = vi.fn().mockResolvedValue(undefined);
    await execute(interaction as never, mockConfig, store, startQuery);
    expect(editReply).toHaveBeenCalled();
  });

  it('allows retry when in waiting_input state', async () => {
    const store = new StateStore();
    store.setSession('thread-1', makeSession('thread-1', { status: 'waiting_input' }));
    const interaction = makeInteraction(true);
    const startQuery = vi.fn().mockResolvedValue(undefined);
    await execute(interaction as never, mockConfig, store, startQuery);
    expect(editReply).toHaveBeenCalled();
  });

  it('aborts the old abortController', async () => {
    const store = new StateStore();
    const oldSession = makeSession('thread-1');
    store.setSession('thread-1', oldSession);
    const interaction = makeInteraction(true);
    const startQuery = vi.fn().mockResolvedValue(undefined);
    await execute(interaction as never, mockConfig, store, startQuery);
    expect(oldSession.abortController.signal.aborted).toBe(true);
  });
});
