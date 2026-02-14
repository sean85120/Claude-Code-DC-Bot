import { describe, it, expect, vi } from 'vitest';

vi.mock('./config.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./config.js')>();
  return {
    ...original,
    loadProjects: vi.fn().mockReturnValue([{ name: 'test', path: '/test' }]),
    parseConfig: (env: Record<string, string | undefined>) => {
      // Call original but inject mocked projects
      const config = original.parseConfig(env);
      if (config.projects.length === 0) {
        config.projects = [{ name: 'test', path: '/test' }];
        if (!config.defaultCwd || config.defaultCwd === process.cwd()) {
          config.defaultCwd = '/test';
        }
      }
      return config;
    },
  };
});

import { parseConfig, validateConfig } from './config.js';

describe('parseConfig', () => {
  const minimal = {
    DISCORD_BOT_TOKEN: 'token',
    DISCORD_GUILD_ID: 'guild',
    DISCORD_CHANNEL_ID: 'channel',
    ALLOWED_USER_IDS: 'user1',
  };

  it('parses basic environment variables', () => {
    const config = parseConfig(minimal);
    expect(config.discordToken).toBe('token');
    expect(config.discordGuildId).toBe('guild');
    expect(config.discordChannelId).toBe('channel');
    expect(config.allowedUserIds).toEqual(['user1']);
  });

  it('splits multiple user IDs by comma', () => {
    const config = parseConfig({ ...minimal, ALLOWED_USER_IDS: 'a, b, c' });
    expect(config.allowedUserIds).toEqual(['a', 'b', 'c']);
  });

  it('trailing comma does not produce empty elements', () => {
    const config = parseConfig({ ...minimal, ALLOWED_USER_IDS: 'a,b,' });
    expect(config.allowedUserIds).toEqual(['a', 'b']);
  });

  it('empty string ALLOWED_USER_IDS returns empty array', () => {
    const config = parseConfig({ ...minimal, ALLOWED_USER_IDS: '' });
    expect(config.allowedUserIds).toEqual([]);
  });

  it('unset ALLOWED_USER_IDS returns empty array', () => {
    const config = parseConfig({ ...minimal, ALLOWED_USER_IDS: undefined });
    expect(config.allowedUserIds).toEqual([]);
  });

  it('default values are correct', () => {
    const config = parseConfig(minimal);
    expect(config.defaultModel).toBe('claude-opus-4-6');
    expect(config.defaultPermissionMode).toBe('default');
    expect(config.maxMessageLength).toBe(2000);
    expect(config.streamUpdateIntervalMs).toBe(2000);
    expect(config.rateLimitWindowMs).toBe(60_000);
    expect(config.rateLimitMaxRequests).toBe(5);
    expect(config.approvalTimeoutMs).toBe(300_000);
    expect(config.sessionIdleTimeoutMs).toBe(1_800_000);
    expect(config.summaryEnabled).toBe(true);
    expect(config.summaryChannelName).toBe('claude-daily-summary');
    expect(config.summaryHourUtc).toBe(0);
  });

  it('parses custom summary settings', () => {
    const config = parseConfig({
      ...minimal,
      SUMMARY_ENABLED: 'true',
      SUMMARY_CHANNEL_NAME: 'my-summaries',
      SUMMARY_HOUR_UTC: '18',
    });
    expect(config.summaryEnabled).toBe(true);
    expect(config.summaryChannelName).toBe('my-summaries');
    expect(config.summaryHourUtc).toBe(18);
  });

  it('SUMMARY_ENABLED=false disables summary', () => {
    const config = parseConfig({ ...minimal, SUMMARY_ENABLED: 'false' });
    expect(config.summaryEnabled).toBe(false);
  });

  it('SUMMARY_HOUR_UTC is clamped to 0-23', () => {
    const configHigh = parseConfig({ ...minimal, SUMMARY_HOUR_UTC: '30' });
    expect(configHigh.summaryHourUtc).toBe(23);

    const configLow = parseConfig({ ...minimal, SUMMARY_HOUR_UTC: '-5' });
    expect(configLow.summaryHourUtc).toBe(0);
  });

  it('custom numeric settings', () => {
    const config = parseConfig({
      ...minimal,
      RATE_LIMIT_WINDOW_MS: '30000',
      RATE_LIMIT_MAX_REQUESTS: '10',
    });
    expect(config.rateLimitWindowMs).toBe(30_000);
    expect(config.rateLimitMaxRequests).toBe(10);
  });

  it('non-numeric env vars fall back to defaults (NaN guard)', () => {
    const config = parseConfig({
      ...minimal,
      RATE_LIMIT_WINDOW_MS: 'abc',
      RATE_LIMIT_MAX_REQUESTS: 'not_a_number',
    });
    expect(config.rateLimitWindowMs).toBe(60_000);
    expect(config.rateLimitMaxRequests).toBe(5);
  });

  it('valid permission mode', () => {
    const config = parseConfig({ ...minimal, DEFAULT_PERMISSION_MODE: 'acceptEdits' });
    expect(config.defaultPermissionMode).toBe('acceptEdits');
  });

  it('invalid permission mode falls back to default', () => {
    const config = parseConfig({ ...minimal, DEFAULT_PERMISSION_MODE: 'invalid' });
    expect(config.defaultPermissionMode).toBe('default');
  });

  it('missing token results in empty string', () => {
    const config = parseConfig({});
    expect(config.discordToken).toBe('');
    expect(config.discordGuildId).toBe('');
    expect(config.discordChannelId).toBe('');
  });
});

describe('validateConfig', () => {
  it('complete config has no errors', () => {
    const config = parseConfig({
      DISCORD_BOT_TOKEN: 'token',
      DISCORD_GUILD_ID: 'guild',
      DISCORD_CHANNEL_ID: 'channel',
      ALLOWED_USER_IDS: 'user1',
    });
    expect(validateConfig(config)).toEqual([]);
  });

  it('missing token produces an error', () => {
    const config = parseConfig({
      DISCORD_GUILD_ID: 'guild',
      DISCORD_CHANNEL_ID: 'channel',
      ALLOWED_USER_IDS: 'user1',
    });
    const errors = validateConfig(config);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('DISCORD_BOT_TOKEN');
  });

  it('all fields missing produces 4 errors', () => {
    const config = parseConfig({});
    const errors = validateConfig(config);
    expect(errors.length).toBe(4);
  });
});
