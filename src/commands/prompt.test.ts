import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelType, MessageFlags } from 'discord.js';
import { StateStore } from '../effects/state-store.js';
import type { BotConfig } from '../types.js';
import { execute } from './prompt.js';

// Mock dependencies
vi.mock('../effects/discord-sender.js', () => ({
  deferReply: vi.fn().mockResolvedValue(undefined),
  editReply: vi.fn().mockResolvedValue(undefined),
  createThread: vi.fn().mockResolvedValue({ id: 'thread-1' }),
  sendInThread: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../modules/embeds.js', () => ({
  buildSessionStartEmbed: vi.fn().mockReturnValue({ title: 'start' }),
  buildErrorEmbed: vi.fn().mockReturnValue({ title: 'error' }),
}));

vi.mock('../effects/channel-manager.js', () => ({
  resolveProjectChannel: vi.fn(),
}));

import { deferReply, editReply } from '../effects/discord-sender.js';

const mockConfig: BotConfig = {
  discordToken: 'token',
  discordGuildId: 'guild',
  discordChannelId: 'channel-1',
  discordClientId: 'client-id',
  allowedUserIds: ['user-1'],
  defaultCwd: '/test',
  defaultModel: 'claude-opus-4-6',
  defaultPermissionMode: 'default',
  maxMessageLength: 2000,
  streamUpdateIntervalMs: 2000,
  rateLimitWindowMs: 60000,
  rateLimitMaxRequests: 5,
  projects: [{ name: 'test', path: '/test' }],
  botRepoPath: '/test',
  approvalTimeoutMs: 300000,
  sessionIdleTimeoutMs: 1800000,
};

function makeInteraction(overrides?: Record<string, unknown>) {
  return {
    user: { id: 'user-1' },
    channelId: 'any-channel',
    channel: {
      type: ChannelType.GuildText,
      parentId: null,
    },
    options: {
      getString: vi.fn((name: string, _required?: boolean) => {
        if (name === 'message') return 'Fix bug';
        if (name === 'repo') return '/test';
        if (name === 'model') return null;
        return null;
      }),
    },
    reply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown;
}

describe('prompt execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('replies with error for unauthorized user', async () => {
    const interaction = makeInteraction({
      user: { id: 'unauthorized' },
    });
    const store = new StateStore();
    const startQuery = vi.fn();
    await execute(interaction as never, mockConfig, store, startQuery);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: [MessageFlags.Ephemeral],
      }),
    );
    expect(startQuery).not.toHaveBeenCalled();
  });

  it('replies with error for disallowed cwd', async () => {
    const interaction = makeInteraction({
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'message') return 'Fix bug';
          if (name === 'repo') return '/not-allowed';
          return null;
        }),
      },
    });
    const store = new StateStore();
    const startQuery = vi.fn();
    await execute(interaction as never, mockConfig, store, startQuery);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '❌ Working directory is not in the allowed project list',
      }),
    );
  });

  it('replies with wait message when rate limit exceeded', async () => {
    const interaction = makeInteraction();
    const store = new StateStore();
    const startQuery = vi.fn();
    const rateLimitStore = {
      getEntry: vi.fn().mockReturnValue({
        timestamps: Array.from({ length: 10 }, () => Date.now()),
      }),
      setEntry: vi.fn(),
    };
    await execute(interaction as never, mockConfig, store, startQuery, rateLimitStore as never);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Too many requests'),
      }),
    );
    expect(startQuery).not.toHaveBeenCalled();
  });

  it('creates Thread and starts query in normal flow (no client, fallback)', async () => {
    const interaction = makeInteraction();
    const store = new StateStore();
    const startQuery = vi.fn().mockResolvedValue(undefined);
    await execute(interaction as never, mockConfig, store, startQuery);

    expect(deferReply).toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        content: expect.stringContaining('Task started'),
      }),
    );
    // Session should be created
    expect(store.getSession('thread-1')).not.toBeNull();
    expect(store.getSession('thread-1')?.promptText).toBe('Fix bug');
  });

  it('uses default model', async () => {
    const interaction = makeInteraction();
    const store = new StateStore();
    const startQuery = vi.fn().mockResolvedValue(undefined);
    await execute(interaction as never, mockConfig, store, startQuery);
    expect(store.getSession('thread-1')?.model).toBe('claude-opus-4-6');
  });

  it('uses specified model', async () => {
    const interaction = makeInteraction({
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'message') return 'Fix bug';
          if (name === 'repo') return '/test';
          if (name === 'model') return 'claude-haiku-4-5-20251001';
          return null;
        }),
      },
    });
    const store = new StateStore();
    const startQuery = vi.fn().mockResolvedValue(undefined);
    await execute(interaction as never, mockConfig, store, startQuery);
    expect(store.getSession('thread-1')?.model).toBe('claude-haiku-4-5-20251001');
  });

  it('records user message in transcript', async () => {
    const interaction = makeInteraction();
    const store = new StateStore();
    const startQuery = vi.fn().mockResolvedValue(undefined);
    await execute(interaction as never, mockConfig, store, startQuery);
    const session = store.getSession('thread-1');
    expect(session?.transcript).toHaveLength(1);
    expect(session?.transcript[0].type).toBe('user');
    expect(session?.transcript[0].content).toBe('Fix bug');
  });
});

describe('prompt channel-repo restriction', () => {
  const multiProjectConfig: BotConfig = {
    ...mockConfig,
    projects: [
      { name: 'my-app', path: '/my-app' },
      { name: 'backend', path: '/backend' },
    ],
    defaultCwd: '/my-app',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('denies wrong repo in a project-specific channel', async () => {
    const interaction = makeInteraction({
      channelId: 'some-project-channel', // not the general channel
      channel: {
        type: ChannelType.GuildText,
        name: 'claude-my-app',
        parentId: null,
      },
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'message') return 'Fix bug';
          if (name === 'repo') return '/backend'; // wrong repo for this channel
          if (name === 'model') return null;
          return null;
        }),
      },
    });
    const store = new StateStore();
    const startQuery = vi.fn();
    await execute(interaction as never, multiProjectConfig, store, startQuery);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('dedicated to'),
        flags: [MessageFlags.Ephemeral],
      }),
    );
    expect(startQuery).not.toHaveBeenCalled();
    expect(deferReply).not.toHaveBeenCalled();
  });

  it('allows correct repo in a project-specific channel', async () => {
    const interaction = makeInteraction({
      channelId: 'some-project-channel',
      channel: {
        type: ChannelType.GuildText,
        name: 'claude-my-app',
        parentId: null,
      },
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'message') return 'Fix bug';
          if (name === 'repo') return '/my-app'; // correct repo
          if (name === 'model') return null;
          return null;
        }),
      },
    });
    const store = new StateStore();
    const startQuery = vi.fn().mockResolvedValue(undefined);
    await execute(interaction as never, multiProjectConfig, store, startQuery);
    expect(deferReply).toHaveBeenCalled();
    expect(store.getSession('thread-1')).not.toBeNull();
  });

  it('allows any repo from the general channel', async () => {
    const interaction = makeInteraction({
      channelId: 'channel-1', // matches config.discordChannelId
      channel: {
        type: ChannelType.GuildText,
        name: 'general',
        parentId: null,
      },
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'message') return 'Fix bug';
          if (name === 'repo') return '/backend'; // different repo, but from general channel
          if (name === 'model') return null;
          return null;
        }),
      },
    });
    const store = new StateStore();
    const startQuery = vi.fn().mockResolvedValue(undefined);
    await execute(interaction as never, multiProjectConfig, store, startQuery);
    expect(deferReply).toHaveBeenCalled();
    expect(store.getSession('thread-1')).not.toBeNull();
  });

  it('allows any repo from a non-project channel', async () => {
    const interaction = makeInteraction({
      channelId: 'random-channel-id',
      channel: {
        type: ChannelType.GuildText,
        name: 'random-chat',
        parentId: null,
      },
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'message') return 'Fix bug';
          if (name === 'repo') return '/my-app';
          if (name === 'model') return null;
          return null;
        }),
      },
    });
    const store = new StateStore();
    const startQuery = vi.fn().mockResolvedValue(undefined);
    await execute(interaction as never, multiProjectConfig, store, startQuery);
    expect(deferReply).toHaveBeenCalled();
    expect(store.getSession('thread-1')).not.toBeNull();
  });

  it('skips restriction when channel has no name property', async () => {
    const interaction = makeInteraction({
      channelId: 'some-channel-id',
      channel: {
        type: ChannelType.GuildText,
        parentId: null,
        // no 'name' property
      },
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'message') return 'Fix bug';
          if (name === 'repo') return '/backend';
          if (name === 'model') return null;
          return null;
        }),
      },
    });
    const store = new StateStore();
    const startQuery = vi.fn().mockResolvedValue(undefined);
    await execute(interaction as never, multiProjectConfig, store, startQuery);
    // Should proceed without restriction since channel name is unavailable
    expect(deferReply).toHaveBeenCalled();
  });
});

describe('prompt auto-select repo', () => {
  const multiProjectConfig: BotConfig = {
    ...mockConfig,
    projects: [
      { name: 'my-app', path: '/my-app' },
      { name: 'backend', path: '/backend' },
    ],
    defaultCwd: '/my-app',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('auto-selects repo when in a project channel and repo is not specified', async () => {
    const interaction = makeInteraction({
      channelId: 'some-project-channel',
      channel: {
        type: ChannelType.GuildText,
        name: 'claude-my-app',
        parentId: null,
      },
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'message') return 'Fix bug';
          if (name === 'repo') return null; // not specified
          if (name === 'model') return null;
          return null;
        }),
      },
    });
    const store = new StateStore();
    const startQuery = vi.fn().mockResolvedValue(undefined);
    await execute(interaction as never, multiProjectConfig, store, startQuery);

    expect(deferReply).toHaveBeenCalled();
    const session = store.getSession('thread-1');
    expect(session).not.toBeNull();
    expect(session?.cwd).toBe('/my-app');
  });

  it('replies with error when repo is null and channel is not a project channel', async () => {
    const interaction = makeInteraction({
      channelId: 'channel-1', // general channel
      channel: {
        type: ChannelType.GuildText,
        name: 'general',
        parentId: null,
      },
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'message') return 'Fix bug';
          if (name === 'repo') return null;
          if (name === 'model') return null;
          return null;
        }),
      },
    });
    const store = new StateStore();
    const startQuery = vi.fn();
    await execute(interaction as never, multiProjectConfig, store, startQuery);

    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Please specify a repo'),
        flags: [MessageFlags.Ephemeral],
      }),
    );
    expect(startQuery).not.toHaveBeenCalled();
  });

  it('replies with error when repo is null and channel has no name', async () => {
    const interaction = makeInteraction({
      channelId: 'some-channel',
      channel: {
        type: ChannelType.GuildText,
        parentId: null,
        // no name
      },
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'message') return 'Fix bug';
          if (name === 'repo') return null;
          if (name === 'model') return null;
          return null;
        }),
      },
    });
    const store = new StateStore();
    const startQuery = vi.fn();
    await execute(interaction as never, multiProjectConfig, store, startQuery);

    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Please specify a repo'),
        flags: [MessageFlags.Ephemeral],
      }),
    );
    expect(startQuery).not.toHaveBeenCalled();
  });

  it('uses explicitly provided repo even in a project channel', async () => {
    const interaction = makeInteraction({
      channelId: 'channel-1', // general channel
      channel: {
        type: ChannelType.GuildText,
        name: 'general',
        parentId: null,
      },
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'message') return 'Deploy';
          if (name === 'repo') return '/backend'; // explicitly provided
          if (name === 'model') return null;
          return null;
        }),
      },
    });
    const store = new StateStore();
    const startQuery = vi.fn().mockResolvedValue(undefined);
    await execute(interaction as never, multiProjectConfig, store, startQuery);

    expect(deferReply).toHaveBeenCalled();
    const session = store.getSession('thread-1');
    expect(session).not.toBeNull();
    expect(session?.cwd).toBe('/backend');
  });
});
