import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { StateStore } from '../effects/state-store.js';
import { UsageStore } from '../effects/usage-store.js';
import { createInteractionHandler } from './interaction-handler.js';
import type { BotConfig, PendingApproval } from '../types.js';
import type { RateLimitStore } from '../effects/rate-limit-store.js';
import { LogStore } from '../effects/log-store.js';

// Mock discord-sender for recovery tests
vi.mock('../effects/discord-sender.js', () => ({
  sendInThread: vi.fn().mockResolvedValue({ id: 'msg1' }),
  sendTextInThread: vi.fn().mockResolvedValue([]),
}));

// Mock embeds for recovery tests
vi.mock('../modules/embeds.js', () => ({
  buildSessionStartEmbed: vi.fn().mockReturnValue({ title: 'Start' }),
  buildErrorEmbed: vi.fn().mockReturnValue({ title: 'Error' }),
}));

// Mock all command modules
vi.mock('../commands/prompt.js', () => ({
  execute: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../commands/stop.js', () => ({
  execute: vi.fn().mockResolvedValue(undefined),
  executeStop: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../commands/status.js', () => ({
  execute: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../commands/history.js', () => ({
  execute: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../commands/retry.js', () => ({
  execute: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../commands/settings.js', () => ({
  execute: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../commands/repos.js', () => ({
  execute: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../commands/summary.js', () => ({
  execute: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./ask-handler.js', () => ({
  handleAskOptionClick: vi.fn().mockResolvedValue(undefined),
  handleAskSubmit: vi.fn().mockResolvedValue(undefined),
  handleAskOther: vi.fn().mockResolvedValue(undefined),
  handleAskModalSubmit: vi.fn().mockResolvedValue(undefined),
}));

import * as promptCmd from '../commands/prompt.js';
import * as stopCmd from '../commands/stop.js';
import * as statusCmd from '../commands/status.js';
import * as historyCmd from '../commands/history.js';
import * as retryCmd from '../commands/retry.js';
import * as summaryCmd from '../commands/summary.js';
import { handleAskOptionClick, handleAskSubmit, handleAskOther, handleAskModalSubmit } from './ask-handler.js';

const mockConfig: BotConfig = {
  discordToken: 'token',
  discordGuildId: 'guild',
  discordChannelId: 'channel',
  discordClientId: 'client-id',
  allowedUserIds: ['user1'],
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
  hideReadResults: false,
  hideSearchResults: false,
  hideAllToolEmbeds: false,
  compactToolEmbeds: false,
  budgetDailyLimitUsd: 0,
  budgetWeeklyLimitUsd: 0,
  budgetMonthlyLimitUsd: 0,
  showGitSummary: true,
  dataDir: '/tmp/test-data',
};

function makeDeps(store?: StateStore) {
  return {
    config: mockConfig,
    store: store || new StateStore(),
    client: {} as never,
    startClaudeQuery: vi.fn().mockResolvedValue(undefined),
    rateLimitStore: { getEntry: vi.fn(), setEntry: vi.fn() } as unknown as RateLimitStore,
    usageStore: new UsageStore(),
    summaryStore: {} as never,
    logStore: new LogStore(),
  };
}

function makeSlashInteraction(commandName: string) {
  return {
    isChatInputCommand: () => true,
    isButton: () => false,
    isModalSubmit: () => false,
    commandName,
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown;
}

function makeButtonInteraction(customId: string, extras: Record<string, unknown> = {}) {
  return {
    isChatInputCommand: () => false,
    isButton: () => true,
    isModalSubmit: () => false,
    customId,
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    user: { id: 'user1' },
    ...extras,
  } as unknown;
}

function makeModalInteraction(customId: string) {
  return {
    isChatInputCommand: () => false,
    isButton: () => false,
    isModalSubmit: () => true,
    customId,
    reply: vi.fn().mockResolvedValue(undefined),
    fields: {
      getTextInputValue: vi.fn().mockReturnValue('answer'),
    },
  } as unknown;
}

describe('createInteractionHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Slash Commands routing', () => {
    it('routes /prompt', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      await handler(makeSlashInteraction('prompt') as never);
      expect(promptCmd.execute).toHaveBeenCalledTimes(1);
    });

    it('routes /stop', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      await handler(makeSlashInteraction('stop') as never);
      expect(stopCmd.execute).toHaveBeenCalledTimes(1);
    });

    it('routes /status', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      await handler(makeSlashInteraction('status') as never);
      expect(statusCmd.execute).toHaveBeenCalledTimes(1);
    });

    it('routes /history', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      await handler(makeSlashInteraction('history') as never);
      expect(historyCmd.execute).toHaveBeenCalledTimes(1);
    });

    it('routes /retry', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      await handler(makeSlashInteraction('retry') as never);
      expect(retryCmd.execute).toHaveBeenCalledTimes(1);
    });

    it('routes /summary', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      await handler(makeSlashInteraction('summary') as never);
      expect(summaryCmd.execute).toHaveBeenCalledTimes(1);
    });

    it('replies with error for unknown command', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      const interaction = makeSlashInteraction('unknown');
      await handler(interaction as never);
      expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: '❌ Unknown command' }),
      );
    });
  });

  describe('Button interactions', () => {
    it('approve button approves pending request', async () => {
      const store = new StateStore();
      store.setSession('t1', {
        sessionId: null,
        status: 'awaiting_permission',
        threadId: 't1',
        userId: 'user1',
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
        allowedTools: new Set(),
      });

      const resolveResult = vi.fn();
      const approval: PendingApproval = {
        toolName: 'Bash',
        toolInput: { command: 'ls' },
        messageId: 'msg-1',
        resolve: resolveResult,
        createdAt: new Date(),
      };
      store.setPendingApproval('t1', approval);

      const deps = makeDeps(store);
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('approve:t1');
      await handler(interaction as never);

      expect(resolveResult).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'allow' }),
      );
      expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: '✅ Approved' }),
      );
    });

    it('approve replies expired when no pending request', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('approve:t1');
      await handler(interaction as never);
      expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: '⚠️ This request has expired' }),
      );
    });

    it('deny button denies pending request', async () => {
      const store = new StateStore();
      store.setSession('t1', {
        sessionId: null,
        status: 'awaiting_permission',
        threadId: 't1',
        userId: 'user1',
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
        allowedTools: new Set(),
      });

      const resolveResult = vi.fn();
      store.setPendingApproval('t1', {
        toolName: 'Write',
        toolInput: {},
        messageId: 'msg-1',
        resolve: resolveResult,
        createdAt: new Date(),
      });

      const deps = makeDeps(store);
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('deny:t1');
      await handler(interaction as never);

      expect(resolveResult).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'deny' }),
      );
      expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: '❌ Denied' }),
      );
    });

    it('confirm_stop executes stop', async () => {
      const store = new StateStore();
      store.setSession('t1', {
        sessionId: null,
        status: 'running',
        threadId: 't1',
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
        allowedTools: new Set(),
      });

      const deps = makeDeps(store);
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('confirm_stop:t1');
      await handler(interaction as never);

      expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: '🛑 Task has been stopped' }),
      );
      expect(stopCmd.executeStop).toHaveBeenCalledWith('t1', store, deps.client, deps.queueStore);
    });

    it('confirm_stop replies ended when no session', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('confirm_stop:t1');
      await handler(interaction as never);
      expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: '⚠️ This task has ended' }),
      );
    });

    it('cancel_stop replies cancelled', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('cancel_stop:t1');
      await handler(interaction as never);
      expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: '✅ Stop cancelled' }),
      );
    });

    it('ask button routes to handleAskOptionClick', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('ask:t1:0:2');
      await handler(interaction as never);
      expect(handleAskOptionClick).toHaveBeenCalledWith(
        interaction, 't1', 0, 2, expect.any(Object),
      );
    });

    it('ask backward compatible with legacy format (two segments)', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('ask:t1:2');
      await handler(interaction as never);
      expect(handleAskOptionClick).toHaveBeenCalledWith(
        interaction, 't1', 0, 2, expect.any(Object),
      );
    });

    it('ask_submit routes to handleAskSubmit', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('ask_submit:t1:1');
      await handler(interaction as never);
      expect(handleAskSubmit).toHaveBeenCalledWith(
        interaction, 't1', 1, expect.any(Object),
      );
    });

    it('ask_other routes to handleAskOther', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('ask_other:t1:0');
      await handler(interaction as never);
      expect(handleAskOther).toHaveBeenCalledWith(
        interaction, 't1', 0, expect.any(Object),
      );
    });
  });

  describe('Modal interactions', () => {
    it('ask_modal routes to handleAskModalSubmit', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      const interaction = makeModalInteraction('ask_modal:t1:2');
      await handler(interaction as never);
      expect(handleAskModalSubmit).toHaveBeenCalledWith(
        interaction, 't1', 2, expect.any(Object),
      );
    });

    it('ask_modal defaults qIdx to 0', async () => {
      const deps = makeDeps();
      const handler = createInteractionHandler(deps);
      const interaction = makeModalInteraction('ask_modal:t1');
      await handler(interaction as never);
      expect(handleAskModalSubmit).toHaveBeenCalledWith(
        interaction, 't1', 0, expect.any(Object),
      );
    });
  });

  describe('Recovery button interactions', () => {
    function makeRecoveryDeps(store?: StateStore) {
      return {
        config: { ...mockConfig, projects: [{ name: 'test', path: '/test' }] },
        store: store || new StateStore(),
        client: {
          channels: {
            fetch: vi.fn().mockResolvedValue({
              isThread: () => true,
              id: 't1',
              archived: false,
              setArchived: vi.fn(),
              send: vi.fn().mockResolvedValue({ id: 'msg1' }),
            }),
          },
        } as never,
        startClaudeQuery: vi.fn().mockResolvedValue(undefined),
        rateLimitStore: { getEntry: vi.fn(), setEntry: vi.fn() } as unknown as RateLimitStore,
        usageStore: new UsageStore(),
        summaryStore: {} as never,
        recoveryStore: { persist: vi.fn(), remove: vi.fn() },
        logStore: new LogStore(),
      };
    }

    it('recovery_retry rejects unauthorized user', async () => {
      const deps = makeRecoveryDeps();
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('recovery_retry:t1', {
        user: { id: 'unauthorized-user' },
      });
      await handler(interaction as never);
      expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('do not have permission') }),
      );
    });

    it('recovery_retry rejects disallowed cwd', async () => {
      const deps = makeRecoveryDeps();
      (deps.config as { projects: Array<{ name: string; path: string }> }).projects = [{ name: 'other', path: '/other' }];
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('recovery_retry:t1', {
        message: {
          embeds: [{
            description: 'Test prompt',
            fields: [{ name: 'Working Directory', value: '`/disallowed`' }],
          }],
        },
      });
      await handler(interaction as never);
      expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('no longer in the allowed project list') }),
      );
    });

    it('recovery_retry starts session for authorized user with valid cwd', async () => {
      const deps = makeRecoveryDeps();
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('recovery_retry:t1', {
        message: {
          embeds: [{
            description: 'Test prompt',
            fields: [{ name: 'Working Directory', value: '`/test`' }],
          }],
        },
      });
      await handler(interaction as never);
      expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Retrying') }),
      );
      expect(deps.startClaudeQuery).toHaveBeenCalledTimes(1);
    });

    it('recovery_dismiss removes buttons and acknowledges', async () => {
      const deps = makeRecoveryDeps();
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('recovery_dismiss:t1');
      await handler(interaction as never);
      expect((interaction as Record<string, unknown>).update).toHaveBeenCalledWith({ components: [] });
      expect((interaction as Record<string, unknown>).followUp).toHaveBeenCalledWith(
        expect.objectContaining({ content: '✅ Dismissed' }),
      );
    });

    it('recovery_retry rejects when session already running', async () => {
      const store = new StateStore();
      store.setSession('t1', {
        sessionId: null,
        status: 'running',
        threadId: 't1',
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
        allowedTools: new Set(),
      });
      const deps = makeRecoveryDeps(store);
      const handler = createInteractionHandler(deps);
      const interaction = makeButtonInteraction('recovery_retry:t1');
      await handler(interaction as never);
      expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('already active') }),
      );
    });
  });
});
