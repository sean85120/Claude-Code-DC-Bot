import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { StateStore } from '../effects/state-store.js';
import type { BotConfig, SessionState } from '../types.js';
import { execute, executeStop } from './stop.js';

vi.mock('../effects/discord-sender.js', () => ({
  deferReply: vi.fn().mockResolvedValue(undefined),
  editReply: vi.fn().mockResolvedValue(undefined),
  sendInThread: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../modules/embeds.js', () => ({
  buildStopPreviewEmbed: vi.fn().mockReturnValue({ title: 'preview' }),
  buildStopConfirmEmbed: vi.fn().mockReturnValue({ title: 'confirmed' }),
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
  botRepoPath: '/test',
  approvalTimeoutMs: 300000,
  sessionIdleTimeoutMs: 1800000,
};

function makeSession(threadId: string, overrides?: Partial<SessionState>): SessionState {
  return {
    sessionId: null,
    status: 'running',
    threadId,
    userId: 'user-1',
    startedAt: new Date(),
    lastActivityAt: new Date(),
    promptText: 'test',
    cwd: '/test',
    model: 'model',
    toolCount: 3,
    tools: { Read: 2, Bash: 1 },
    pendingApproval: null,
    abortController: new AbortController(),
    transcript: [],
    ...overrides,
  };
}

function makeInteraction(overrides?: Record<string, unknown>) {
  return {
    user: { id: 'user-1' },
    channelId: 'channel-1',
    channel: {
      isThread: () => true,
      id: 'thread-1',
      parentId: 'channel-1',
    },
    reply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown;
}

describe('stop execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('replies with error for unauthorized user', async () => {
    const interaction = makeInteraction({ user: { id: 'bad' } });
    const store = new StateStore();
    await execute(interaction as never, mockConfig, store, {} as never);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: [MessageFlags.Ephemeral] }),
    );
  });

  it('prompts when no active session', async () => {
    const interaction = makeInteraction({
      channel: { isThread: () => false, parentId: null },
      channelId: 'channel-1',
    });
    const store = new StateStore();
    await execute(interaction as never, mockConfig, store, {} as never);
    expect(editReply).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        content: expect.stringContaining('No task is currently running'),
      }),
    );
  });

  it('displays summary and confirmation buttons when session exists', async () => {
    const store = new StateStore();
    store.setSession('thread-1', makeSession('thread-1'));

    const interaction = makeInteraction();
    await execute(interaction as never, mockConfig, store, {} as never);
    expect(editReply).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        embeds: expect.any(Array),
        components: expect.any(Array),
      }),
    );
  });
});

describe('executeStop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('silently returns when no session', async () => {
    const store = new StateStore();
    const client = { channels: { fetch: vi.fn() } };
    await executeStop('nonexistent', store, client as never);
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  it('aborts the abortController', async () => {
    const store = new StateStore();
    const session = makeSession('t1');
    store.setSession('t1', session);

    const client = {
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isThread: () => true,
          setArchived: vi.fn().mockResolvedValue(undefined),
        }),
      },
    };

    await executeStop('t1', store, client as never);
    expect(session.abortController.signal.aborted).toBe(true);
  });

  it('auto-denies pending approval requests', async () => {
    const store = new StateStore();
    const session = makeSession('t1');
    store.setSession('t1', session);

    const resolveResult = vi.fn();
    store.setPendingApproval('t1', {
      toolName: 'Bash',
      toolInput: {},
      messageId: 'msg',
      resolve: resolveResult,
      createdAt: new Date(),
    });

    const client = {
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isThread: () => true,
          setArchived: vi.fn().mockResolvedValue(undefined),
        }),
      },
    };

    await executeStop('t1', store, client as never);
    expect(resolveResult).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'deny' }),
    );
  });

  it('clears session', async () => {
    const store = new StateStore();
    store.setSession('t1', makeSession('t1'));

    const client = {
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isThread: () => true,
          setArchived: vi.fn().mockResolvedValue(undefined),
        }),
      },
    };

    await executeStop('t1', store, client as never);
    expect(store.getSession('t1')).toBeNull();
  });
});
