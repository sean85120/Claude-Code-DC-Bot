import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import type { BotConfig } from '../types.js';
import { execute } from './repos.js';

// Mock node:fs — controls existsSync and writeFileSync behavior
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Mock command deployer
vi.mock('../effects/command-deployer.js', () => ({
  deployCommands: vi.fn().mockResolvedValue(undefined),
}));

import { existsSync } from 'node:fs';

const mockedExistsSync = vi.mocked(existsSync);

function makeConfig(overrides?: Partial<BotConfig>): BotConfig {
  return {
    discordToken: 'token',
    discordGuildId: 'guild',
    discordChannelId: 'channel-1',
    discordClientId: 'client-id',
    allowedUserIds: ['user-1'],
    defaultCwd: '/existing-project',
    defaultModel: 'claude-opus-4-6',
    defaultPermissionMode: 'default',
    maxMessageLength: 2000,
    streamUpdateIntervalMs: 2000,
    rateLimitWindowMs: 60000,
    rateLimitMaxRequests: 5,
    projects: [{ name: 'existing-project', path: '/existing-project' }],
    botRepoPath: '/existing-project',
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
    ...overrides,
  };
}

function makeInteraction(subcommand: string, options: Record<string, string>) {
  return {
    user: { id: 'user-1' },
    options: {
      getSubcommand: vi.fn().mockReturnValue(subcommand),
      getString: vi.fn((name: string) => options[name] ?? null),
    },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  } as unknown;
}

describe('repos execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Authorization ────────────────────────────────

  it('denies unauthorized user', async () => {
    const interaction = makeInteraction('list', {});
    (interaction as Record<string, unknown>).user = { id: 'unauthorized' };
    const config = makeConfig();
    await execute(interaction as never, config);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: [MessageFlags.Ephemeral],
        content: expect.stringContaining('permission'),
      }),
    );
  });

  // ─── List ────────────────────────────────────────

  it('lists projects', async () => {
    const interaction = makeInteraction('list', {});
    const config = makeConfig();
    await execute(interaction as never, config);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({ title: 'Registered Projects' }),
        ]),
      }),
    );
  });

  it('shows message when no projects registered', async () => {
    const interaction = makeInteraction('list', {});
    const config = makeConfig({ projects: [] });
    await execute(interaction as never, config);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'No projects registered.',
      }),
    );
  });

  // ─── Add: duplicate checks ────────────────────────

  it('rejects duplicate project name', async () => {
    const interaction = makeInteraction('add', { name: 'existing-project', path: '/new-path' });
    const config = makeConfig();
    await execute(interaction as never, config);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('already exists'),
      }),
    );
  });

  it('rejects duplicate project path', async () => {
    const interaction = makeInteraction('add', { name: 'new-project', path: '/existing-project' });
    const config = makeConfig();
    await execute(interaction as never, config);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('already exists'),
      }),
    );
  });

  // ─── Add: path existence ─────────────────────────

  it('rejects path that does not exist on disk', async () => {
    mockedExistsSync.mockReturnValue(false);
    const interaction = makeInteraction('add', { name: 'new-project', path: '/nonexistent' });
    const config = makeConfig();
    await execute(interaction as never, config);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('does not exist'),
      }),
    );
  });

  // ─── Add: git repository check ────────────────────

  it('rejects path without .git folder', async () => {
    // First call: path exists. Second call: .git does not exist
    mockedExistsSync.mockImplementation((p: unknown) => {
      if (typeof p === 'string' && p.endsWith('.git')) return false;
      return true;
    });
    const interaction = makeInteraction('add', { name: 'new-project', path: '/no-git-dir' });
    const config = makeConfig();
    await execute(interaction as never, config);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('not a git repository'),
      }),
    );
  });

  it('accepts path with .git folder and adds project', async () => {
    mockedExistsSync.mockReturnValue(true);
    const interaction = makeInteraction('add', { name: 'new-project', path: '/valid-repo' });
    const config = makeConfig();
    const initialCount = config.projects.length;

    await execute(interaction as never, config);

    // Should have deferred and edited reply with success
    expect((interaction as Record<string, unknown>).deferReply).toHaveBeenCalled();
    expect((interaction as Record<string, unknown>).editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({ title: 'Project Added' }),
        ]),
      }),
    );
    // Project should be added to in-memory config
    expect(config.projects).toHaveLength(initialCount + 1);
    expect(config.projects.find((p) => p.name === 'new-project')).toBeDefined();
  });

  // ─── Remove ──────────────────────────────────────

  it('rejects removing non-existent project', async () => {
    const interaction = makeInteraction('remove', { name: 'ghost-project' });
    const config = makeConfig();
    await execute(interaction as never, config);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('No project named'),
      }),
    );
  });

  it('removes existing project', async () => {
    const interaction = makeInteraction('remove', { name: 'existing-project' });
    const config = makeConfig();
    await execute(interaction as never, config);
    expect((interaction as Record<string, unknown>).deferReply).toHaveBeenCalled();
    expect((interaction as Record<string, unknown>).editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({ title: 'Project Removed' }),
        ]),
      }),
    );
    expect(config.projects.find((p) => p.name === 'existing-project')).toBeUndefined();
  });

  // ─── Rename ──────────────────────────────────────

  it('rejects renaming non-existent project', async () => {
    const interaction = makeInteraction('rename', { name: 'ghost-project', 'new-name': 'new-name' });
    const config = makeConfig();
    await execute(interaction as never, config);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('No project named'),
      }),
    );
  });

  it('rejects renaming to an already-taken name', async () => {
    const config = makeConfig({
      projects: [
        { name: 'project-a', path: '/project-a' },
        { name: 'project-b', path: '/project-b' },
      ],
    });
    const interaction = makeInteraction('rename', { name: 'project-a', 'new-name': 'project-b' });
    await execute(interaction as never, config);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('already exists'),
      }),
    );
  });

  it('renames project successfully', async () => {
    const config = makeConfig();
    const interaction = makeInteraction('rename', { name: 'existing-project', 'new-name': 'renamed-project' });
    await execute(interaction as never, config);
    expect((interaction as Record<string, unknown>).deferReply).toHaveBeenCalled();
    expect((interaction as Record<string, unknown>).editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({ title: 'Project Renamed' }),
        ]),
      }),
    );
    expect(config.projects.find((p) => p.name === 'renamed-project')).toBeDefined();
    expect(config.projects.find((p) => p.name === 'existing-project')).toBeUndefined();
  });
});
