import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { StateStore } from '../effects/state-store.js';
import type { BotConfig } from '../types.js';
import { execute } from './history.js';

vi.mock('../effects/discord-sender.js', () => ({
  deferReplyEphemeral: vi.fn().mockResolvedValue(undefined),
  editReply: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../modules/transcript-formatter.js', () => ({
  formatTranscript: vi.fn().mockReturnValue('# Transcript'),
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

describe('history execute', () => {
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
    await execute(interaction as never, mockConfig, store);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: [MessageFlags.Ephemeral] }),
    );
  });

  it('prompts when not in a Thread', async () => {
    const interaction = makeInteraction(false);
    const store = new StateStore();
    await execute(interaction as never, mockConfig, store);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('thread'),
      }),
    );
  });

  it('prompts when no transcript', async () => {
    const store = new StateStore();
    store.setSession('thread-1', {
      sessionId: null,
      status: 'running',
      threadId: 'thread-1',
      userId: 'user-1',
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
    const interaction = makeInteraction(true);
    await execute(interaction as never, mockConfig, store);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('no conversation history'),
      }),
    );
  });

  it('exports as Markdown file when transcript exists', async () => {
    const store = new StateStore();
    store.setSession('thread-1', {
      sessionId: null,
      status: 'completed',
      threadId: 'thread-1',
      userId: 'user-1',
      startedAt: new Date(),
      lastActivityAt: new Date(),
      promptText: 'test',
      cwd: '/test',
      model: 'model',
      toolCount: 0,
      tools: {},
      pendingApproval: null,
      abortController: new AbortController(),
      transcript: [
        { timestamp: new Date(), type: 'assistant' as const, content: 'Hello' },
      ],
    });
    const interaction = makeInteraction(true);
    await execute(interaction as never, mockConfig, store);
    expect(editReply).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        content: expect.stringContaining('1 entries'),
        files: expect.any(Array),
      }),
    );
  });
});
