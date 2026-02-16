import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelType, MessageFlags } from 'discord.js';
import { StateStore } from '../effects/state-store.js';
import type { BotConfig, PromptTemplate } from '../types.js';
import { execute } from './template.js';

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

import { deferReply } from '../effects/discord-sender.js';

const mockConfig: BotConfig = {
  discordToken: 'token',
  discordGuildId: 'guild',
  discordChannelId: 'general-channel',
  discordClientId: 'client-id',
  allowedUserIds: ['user-1'],
  defaultCwd: '/my-app',
  defaultModel: 'claude-opus-4-6',
  defaultPermissionMode: 'default',
  maxMessageLength: 2000,
  streamUpdateIntervalMs: 2000,
  rateLimitWindowMs: 60000,
  rateLimitMaxRequests: 5,
  projects: [
    { name: 'my-app', path: '/my-app' },
    { name: 'backend', path: '/backend' },
  ],
  botRepoPath: '/my-app',
  approvalTimeoutMs: 300000,
  sessionIdleTimeoutMs: 1800000,
  summaryChannelName: 'claude-daily-summary',
  summaryHourUtc: 0,
  summaryEnabled: true,
  hideReadResults: false,
  hideSearchResults: false,
  hideAllToolEmbeds: false,
  compactToolEmbeds: false,
  budgetDailyLimitUsd: 0,
  budgetWeeklyLimitUsd: 0,
  budgetMonthlyLimitUsd: 0,
  showGitSummary: true,
  dataDir: '/tmp',
};

const myAppTemplate: PromptTemplate = {
  name: 'run-tests',
  promptText: 'Run all tests',
  cwd: '/my-app',
  createdBy: 'user-1',
  createdAt: new Date().toISOString(),
};

const backendTemplate: PromptTemplate = {
  name: 'deploy',
  promptText: 'Deploy to production',
  cwd: '/backend',
  createdBy: 'user-1',
  createdAt: new Date().toISOString(),
};

function makeTemplateStore(templates: PromptTemplate[] = []) {
  const store = new Map<string, PromptTemplate>();
  for (const t of templates) store.set(t.name, t);
  return {
    get: vi.fn((name: string) => store.get(name) ?? null),
    list: vi.fn(() => [...store.values()]),
    save: vi.fn((t: PromptTemplate) => store.set(t.name, t)),
    delete: vi.fn((name: string) => store.delete(name)),
  };
}

function makeInteraction(subcommand: string, options: Record<string, string | null>, overrides?: Record<string, unknown>) {
  return {
    user: { id: 'user-1' },
    channelId: 'general-channel',
    channel: {
      type: ChannelType.GuildText,
      name: 'general',
      parentId: null,
    },
    options: {
      getSubcommand: vi.fn().mockReturnValue(subcommand),
      getString: vi.fn((name: string) => options[name] ?? null),
    },
    reply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown;
}

describe('template execute — channel-repo restriction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('denies template run with wrong repo in project channel', async () => {
    const templateStore = makeTemplateStore([backendTemplate]);
    const interaction = makeInteraction('run', { name: 'deploy' }, {
      channelId: 'app-channel-id',
      channel: {
        type: ChannelType.GuildText,
        name: 'claude-my-app', // channel for my-app, but template targets /backend
        parentId: null,
      },
    });
    const store = new StateStore();
    const startQuery = vi.fn();
    await execute(interaction as never, mockConfig, store, templateStore as never, startQuery);

    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('dedicated to'),
        flags: [MessageFlags.Ephemeral],
      }),
    );
    expect(startQuery).not.toHaveBeenCalled();
    expect(deferReply).not.toHaveBeenCalled();
  });

  it('allows template run with matching repo in project channel', async () => {
    const templateStore = makeTemplateStore([myAppTemplate]);
    const interaction = makeInteraction('run', { name: 'run-tests' }, {
      channelId: 'app-channel-id',
      channel: {
        type: ChannelType.GuildText,
        name: 'claude-my-app', // matches template cwd /my-app
        parentId: null,
      },
    });
    const store = new StateStore();
    const startQuery = vi.fn().mockResolvedValue(undefined);
    await execute(interaction as never, mockConfig, store, templateStore as never, startQuery);

    expect(deferReply).toHaveBeenCalled();
    expect(store.getSession('thread-1')).not.toBeNull();
  });

  it('allows any template from general channel', async () => {
    const templateStore = makeTemplateStore([backendTemplate]);
    const interaction = makeInteraction('run', { name: 'deploy' }, {
      channelId: 'general-channel', // matches config.discordChannelId
      channel: {
        type: ChannelType.GuildText,
        name: 'general',
        parentId: null,
      },
    });
    const store = new StateStore();
    const startQuery = vi.fn().mockResolvedValue(undefined);
    await execute(interaction as never, mockConfig, store, templateStore as never, startQuery);

    expect(deferReply).toHaveBeenCalled();
    expect(store.getSession('thread-1')).not.toBeNull();
  });

  it('allows any template from non-project channel', async () => {
    const templateStore = makeTemplateStore([backendTemplate]);
    const interaction = makeInteraction('run', { name: 'deploy' }, {
      channelId: 'random-channel-id',
      channel: {
        type: ChannelType.GuildText,
        name: 'off-topic',
        parentId: null,
      },
    });
    const store = new StateStore();
    const startQuery = vi.fn().mockResolvedValue(undefined);
    await execute(interaction as never, mockConfig, store, templateStore as never, startQuery);

    expect(deferReply).toHaveBeenCalled();
    expect(store.getSession('thread-1')).not.toBeNull();
  });

  it('denies from second project channel selecting first project template', async () => {
    const templateStore = makeTemplateStore([myAppTemplate]);
    const interaction = makeInteraction('run', { name: 'run-tests' }, {
      channelId: 'backend-channel-id',
      channel: {
        type: ChannelType.GuildText,
        name: 'claude-backend', // channel for backend, template targets /my-app
        parentId: null,
      },
    });
    const store = new StateStore();
    const startQuery = vi.fn();
    await execute(interaction as never, mockConfig, store, templateStore as never, startQuery);

    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('dedicated to'),
        flags: [MessageFlags.Ephemeral],
      }),
    );
    expect(startQuery).not.toHaveBeenCalled();
  });
});

describe('template execute — basic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('denies unauthorized user', async () => {
    const templateStore = makeTemplateStore();
    const interaction = makeInteraction('list', {}, { user: { id: 'unauthorized' } });
    const store = new StateStore();
    const startQuery = vi.fn();
    await execute(interaction as never, mockConfig, store, templateStore as never, startQuery);

    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('permission'),
        flags: [MessageFlags.Ephemeral],
      }),
    );
  });

  it('run replies with error for unknown template', async () => {
    const templateStore = makeTemplateStore();
    const interaction = makeInteraction('run', { name: 'nonexistent' });
    const store = new StateStore();
    const startQuery = vi.fn();
    await execute(interaction as never, mockConfig, store, templateStore as never, startQuery);

    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('not found'),
      }),
    );
  });

  it('run rejects template with disallowed cwd', async () => {
    const badTemplate: PromptTemplate = {
      name: 'bad',
      promptText: 'test',
      cwd: '/removed-project',
      createdBy: 'user-1',
      createdAt: new Date().toISOString(),
    };
    const templateStore = makeTemplateStore([badTemplate]);
    const interaction = makeInteraction('run', { name: 'bad' });
    const store = new StateStore();
    const startQuery = vi.fn();
    await execute(interaction as never, mockConfig, store, templateStore as never, startQuery);

    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('no longer in the allowed project list'),
      }),
    );
  });
});
