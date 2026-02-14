import { describe, it, expect, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import { resolveSummaryChannel } from './summary-channel.js';
import type { BotConfig } from '../types.js';

function makeConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    discordToken: 'token',
    discordGuildId: 'guild-1',
    discordChannelId: 'general-ch',
    discordClientId: 'client-1',
    allowedUserIds: ['u1'],
    defaultCwd: '/test',
    defaultModel: 'claude-opus-4-6',
    defaultPermissionMode: 'default',
    maxMessageLength: 2000,
    streamUpdateIntervalMs: 2000,
    rateLimitWindowMs: 60000,
    rateLimitMaxRequests: 5,
    projects: [{ name: 'test', path: '/test' }],
    botRepoPath: '/bot',
    approvalTimeoutMs: 300000,
    sessionIdleTimeoutMs: 1800000,
    summaryChannelName: 'claude-daily-summary',
    summaryHourUtc: 0,
    summaryEnabled: true,
    ...overrides,
  };
}

function makeMockChannel(name: string, type = ChannelType.GuildText) {
  return {
    id: `ch-${name}`,
    name,
    type,
    send: vi.fn(),
  };
}

describe('resolveSummaryChannel', () => {
  it('returns cached channel if found', async () => {
    const summaryChannel = makeMockChannel('claude-daily-summary');
    const mockClient = {
      guilds: {
        fetch: vi.fn().mockResolvedValue({
          channels: {
            cache: {
              find: vi.fn().mockReturnValue(summaryChannel),
            },
            fetch: vi.fn(),
            create: vi.fn(),
          },
        }),
      },
      channels: { fetch: vi.fn() },
    } as unknown as Parameters<typeof resolveSummaryChannel>[0];

    const config = makeConfig();
    const result = await resolveSummaryChannel(mockClient, config);

    expect(result).toBe(summaryChannel);
  });

  it('fetches from API when not in cache', async () => {
    const summaryChannel = makeMockChannel('claude-daily-summary');
    const mockClient = {
      guilds: {
        fetch: vi.fn().mockResolvedValue({
          channels: {
            cache: {
              find: vi.fn().mockReturnValue(null),
            },
            fetch: vi.fn().mockResolvedValue(
              new Map([['ch-1', summaryChannel]]),
            ),
            create: vi.fn(),
          },
        }),
      },
      channels: { fetch: vi.fn() },
    } as unknown as Parameters<typeof resolveSummaryChannel>[0];

    // Mock the Collection's .find method
    const fetchResult = {
      find: vi.fn().mockReturnValue(summaryChannel),
    };
    const guild = await mockClient.guilds.fetch('guild-1');
    (guild.channels.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(fetchResult);

    const config = makeConfig();
    const result = await resolveSummaryChannel(mockClient, config);

    expect(result).toBe(summaryChannel);
  });

  it('creates channel when not found anywhere', async () => {
    const createdChannel = makeMockChannel('claude-daily-summary');
    const generalChannel = { parentId: 'category-1' };

    const mockGuild = {
      channels: {
        cache: {
          find: vi.fn().mockReturnValue(null),
        },
        fetch: vi.fn().mockResolvedValue({
          find: vi.fn().mockReturnValue(null),
        }),
        create: vi.fn().mockResolvedValue(createdChannel),
      },
    };

    const mockClient = {
      guilds: {
        fetch: vi.fn().mockResolvedValue(mockGuild),
      },
      channels: {
        fetch: vi.fn().mockResolvedValue(generalChannel),
      },
    } as unknown as Parameters<typeof resolveSummaryChannel>[0];

    const config = makeConfig();
    const result = await resolveSummaryChannel(mockClient, config);

    expect(result).toBe(createdChannel);
    expect(mockGuild.channels.create).toHaveBeenCalledWith({
      name: 'claude-daily-summary',
      type: ChannelType.GuildText,
      parent: 'category-1',
      topic: 'Daily summaries of Claude Code sessions — token usage, costs, and completed work',
    });
  });

  it('creates channel at root when general channel category unavailable', async () => {
    const createdChannel = makeMockChannel('claude-daily-summary');

    const mockGuild = {
      channels: {
        cache: {
          find: vi.fn().mockReturnValue(null),
        },
        fetch: vi.fn().mockResolvedValue({
          find: vi.fn().mockReturnValue(null),
        }),
        create: vi.fn().mockResolvedValue(createdChannel),
      },
    };

    const mockClient = {
      guilds: {
        fetch: vi.fn().mockResolvedValue(mockGuild),
      },
      channels: {
        fetch: vi.fn().mockRejectedValue(new Error('Not found')),
      },
    } as unknown as Parameters<typeof resolveSummaryChannel>[0];

    const config = makeConfig();
    const result = await resolveSummaryChannel(mockClient, config);

    expect(result).toBe(createdChannel);
    expect(mockGuild.channels.create).toHaveBeenCalledWith(
      expect.objectContaining({ parent: null }),
    );
  });

  it('throws descriptive error on missing permissions (code 50013)', async () => {
    const mockGuild = {
      channels: {
        cache: {
          find: vi.fn().mockReturnValue(null),
        },
        fetch: vi.fn().mockResolvedValue({
          find: vi.fn().mockReturnValue(null),
        }),
        create: vi.fn().mockRejectedValue({ code: 50013, message: 'Missing Permissions' }),
      },
    };

    const mockClient = {
      guilds: {
        fetch: vi.fn().mockResolvedValue(mockGuild),
      },
      channels: {
        fetch: vi.fn().mockRejectedValue(new Error('Not found')),
      },
    } as unknown as Parameters<typeof resolveSummaryChannel>[0];

    const config = makeConfig();
    await expect(resolveSummaryChannel(mockClient, config)).rejects.toThrow('Manage Channels');
  });

  it('uses custom summary channel name from config', async () => {
    const customChannel = makeMockChannel('my-custom-summary');
    const mockClient = {
      guilds: {
        fetch: vi.fn().mockResolvedValue({
          channels: {
            cache: {
              find: vi.fn().mockImplementation((fn: (ch: { type: number; name: string }) => boolean) => {
                return fn(customChannel) ? customChannel : null;
              }),
            },
            fetch: vi.fn(),
            create: vi.fn(),
          },
        }),
      },
      channels: { fetch: vi.fn() },
    } as unknown as Parameters<typeof resolveSummaryChannel>[0];

    const config = makeConfig({ summaryChannelName: 'my-custom-summary' });
    const result = await resolveSummaryChannel(mockClient, config);

    expect(result).toBe(customChannel);
  });
});
