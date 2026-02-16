import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import type { BotConfig } from '../types.js';
import { LogStore } from '../effects/log-store.js';
import { execute } from './logs.js';

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

function makeInteraction(options: Record<string, string | number | null> = {}, overrides?: Record<string, unknown>) {
  return {
    user: { id: 'user-1' },
    options: {
      getString: vi.fn((name: string) => options[name] ?? null),
      getInteger: vi.fn((name: string) => options[name] ?? null),
    },
    reply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown;
}

describe('logs execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('denies unauthorized user', async () => {
    const logStore = new LogStore();
    const interaction = makeInteraction({}, { user: { id: 'unauthorized' } });
    await execute(interaction as never, mockConfig, logStore);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('permission'),
        flags: [MessageFlags.Ephemeral],
      }),
    );
  });

  it('shows no entries message for empty store', async () => {
    const logStore = new LogStore();
    const interaction = makeInteraction();
    await execute(interaction as never, mockConfig, logStore);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('No log entries'),
        flags: [MessageFlags.Ephemeral],
      }),
    );
  });

  it('returns formatted entries', async () => {
    const logStore = new LogStore();
    logStore.push({
      timestamp: new Date('2025-01-01T12:30:45Z'),
      level: 'info',
      module: 'Bot',
      message: 'Started up',
    });
    logStore.push({
      timestamp: new Date('2025-01-01T12:31:00Z'),
      level: 'error',
      module: 'Claude',
      message: 'Query failed',
    });

    const interaction = makeInteraction();
    await execute(interaction as never, mockConfig, logStore);

    const replyCall = (interaction as Record<string, unknown>).reply as ReturnType<typeof vi.fn>;
    expect(replyCall).toHaveBeenCalled();
    const replyArg = replyCall.mock.calls[0][0] as { embeds: Array<{ description: string; title: string }> };
    expect(replyArg.embeds).toHaveLength(1);
    expect(replyArg.embeds[0].title).toContain('Recent Logs');
    expect(replyArg.embeds[0].description).toContain('Started up');
    expect(replyArg.embeds[0].description).toContain('Query failed');
  });

  it('respects level filter', async () => {
    const logStore = new LogStore();
    logStore.push({ timestamp: new Date(), level: 'info', module: 'Bot', message: 'info msg' });
    logStore.push({ timestamp: new Date(), level: 'error', module: 'Bot', message: 'error msg' });

    const interaction = makeInteraction({ level: 'error' });
    await execute(interaction as never, mockConfig, logStore);

    const replyCall = (interaction as Record<string, unknown>).reply as ReturnType<typeof vi.fn>;
    const replyArg = replyCall.mock.calls[0][0] as { embeds: Array<{ description: string }> };
    expect(replyArg.embeds[0].description).toContain('error msg');
    expect(replyArg.embeds[0].description).not.toContain('info msg');
  });

  it('respects module filter', async () => {
    const logStore = new LogStore();
    logStore.push({ timestamp: new Date(), level: 'info', module: 'Bot', message: 'bot msg' });
    logStore.push({ timestamp: new Date(), level: 'info', module: 'Claude', message: 'claude msg' });

    const interaction = makeInteraction({ module: 'claude' });
    await execute(interaction as never, mockConfig, logStore);

    const replyCall = (interaction as Record<string, unknown>).reply as ReturnType<typeof vi.fn>;
    const replyArg = replyCall.mock.calls[0][0] as { embeds: Array<{ description: string }> };
    expect(replyArg.embeds[0].description).toContain('claude msg');
    expect(replyArg.embeds[0].description).not.toContain('bot msg');
  });

  it('respects count filter', async () => {
    const logStore = new LogStore();
    for (let i = 0; i < 10; i++) {
      logStore.push({ timestamp: new Date(), level: 'info', module: 'Bot', message: `msg-${i}` });
    }

    const interaction = makeInteraction({ count: 2 });
    await execute(interaction as never, mockConfig, logStore);

    const replyCall = (interaction as Record<string, unknown>).reply as ReturnType<typeof vi.fn>;
    const replyArg = replyCall.mock.calls[0][0] as { embeds: Array<{ footer: { text: string } }> };
    expect(replyArg.embeds[0].footer.text).toContain('2');
  });
});
