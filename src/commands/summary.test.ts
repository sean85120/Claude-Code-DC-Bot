import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import type { BotConfig } from '../types.js';
import { execute } from './summary.js';

vi.mock('../effects/discord-sender.js', () => ({
  deferReplyEphemeral: vi.fn().mockResolvedValue(undefined),
  editReply: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../modules/daily-summary.js', () => ({
  groupSessionsByRepo: vi.fn().mockReturnValue([]),
  buildDailySummaryEmbed: vi.fn().mockReturnValue({ title: 'summary' }),
}));

vi.mock('../effects/summary-channel.js', () => ({
  resolveSummaryChannel: vi.fn(),
}));

vi.mock('../effects/logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

import { editReply, deferReplyEphemeral } from '../effects/discord-sender.js';
import { groupSessionsByRepo, buildDailySummaryEmbed } from '../modules/daily-summary.js';
import { resolveSummaryChannel } from '../effects/summary-channel.js';

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
  summaryChannelName: 'claude-daily-summary',
  summaryHourUtc: 0,
  summaryEnabled: true,
};

const mockEmptyRecord = {
  date: '2025-06-15',
  sessions: [],
  totalCostUsd: 0,
  totalUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, costUsd: 0 },
  totalDurationMs: 0,
};

let mockChannelSend: ReturnType<typeof vi.fn>;

function makeSummaryStore(todayRecord = mockEmptyRecord, recordByDate?: typeof mockEmptyRecord) {
  return {
    getTodayRecord: vi.fn().mockReturnValue(todayRecord),
    getRecordByDate: vi.fn().mockReturnValue(recordByDate),
    recordCompletedSession: vi.fn(),
    getYesterdayRecord: vi.fn(),
    clearToday: vi.fn(),
  } as never;
}

function makeInteraction(dateValue: string | null = null) {
  return {
    user: { id: 'user-1' },
    options: {
      getString: vi.fn().mockReturnValue(dateValue),
    },
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown;
}

const mockClient = {} as never;

describe('summary execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Create a fresh send mock each time, then wire it into the resolved channel
    mockChannelSend = vi.fn().mockResolvedValue(undefined);
    vi.mocked(resolveSummaryChannel).mockResolvedValue({
      id: 'summary-ch-1',
      send: mockChannelSend,
    } as never);
  });

  it('replies with error for unauthorized user', async () => {
    const interaction = {
      user: { id: 'bad-user' },
      options: { getString: vi.fn().mockReturnValue(null) },
      reply: vi.fn().mockResolvedValue(undefined),
    } as unknown;
    const store = makeSummaryStore();
    await execute(interaction as never, mockConfig, store as never, mockClient);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: [MessageFlags.Ephemeral] }),
    );
    expect(deferReplyEphemeral).not.toHaveBeenCalled();
  });

  it('posts today summary when no date param', async () => {
    const store = makeSummaryStore();
    const interaction = makeInteraction(null);
    await execute(interaction as never, mockConfig, store as never, mockClient);

    expect(deferReplyEphemeral).toHaveBeenCalled();
    expect(groupSessionsByRepo).toHaveBeenCalledWith(mockEmptyRecord.sessions);
    expect(buildDailySummaryEmbed).toHaveBeenCalled();
    expect(resolveSummaryChannel).toHaveBeenCalledWith(mockClient, mockConfig);
    expect(mockChannelSend).toHaveBeenCalledWith({ embeds: [{ title: 'summary' }] });
    expect(editReply).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        content: expect.stringContaining('Summary for'),
      }),
    );
  });

  it('posts historical summary for valid date param', async () => {
    const historicalRecord = { ...mockEmptyRecord, date: '2025-06-10' };
    const store = makeSummaryStore(mockEmptyRecord, historicalRecord);
    const interaction = makeInteraction('2025-06-10');
    await execute(interaction as never, mockConfig, store as never, mockClient);

    expect((store as Record<string, unknown>).getRecordByDate).toHaveBeenCalledWith('2025-06-10');
    expect(groupSessionsByRepo).toHaveBeenCalledWith(historicalRecord.sessions);
    expect(mockChannelSend).toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        content: expect.stringContaining('2025-06-10'),
      }),
    );
  });

  it('replies with error for invalid date format', async () => {
    const store = makeSummaryStore();
    const interaction = makeInteraction('not-a-date');
    await execute(interaction as never, mockConfig, store as never, mockClient);

    expect(editReply).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        content: expect.stringContaining('Invalid date format'),
      }),
    );
    expect(mockChannelSend).not.toHaveBeenCalled();
  });

  it('posts empty summary for date with no record', async () => {
    const store = makeSummaryStore(mockEmptyRecord, undefined);
    const interaction = makeInteraction('2025-01-01');
    await execute(interaction as never, mockConfig, store as never, mockClient);

    // Should still build and post an embed (with empty data)
    expect(groupSessionsByRepo).toHaveBeenCalledWith([]);
    expect(buildDailySummaryEmbed).toHaveBeenCalled();
    expect(mockChannelSend).toHaveBeenCalled();
  });

  it('replies with failure when channel post fails', async () => {
    vi.mocked(resolveSummaryChannel).mockRejectedValueOnce(new Error('No permission'));
    const store = makeSummaryStore();
    const interaction = makeInteraction(null);
    await execute(interaction as never, mockConfig, store as never, mockClient);

    expect(editReply).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        content: expect.stringContaining('Failed to post summary'),
      }),
    );
  });
});
