import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BotConfig, PermissionMode, Project } from './types.js';

const VALID_PERMISSION_MODES: PermissionMode[] = [
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
];

/**
 * Parse environment variables into a BotConfig object
 * @param env - Key-value pairs of environment variables
 * @returns Parsed bot configuration
 */
export function parseConfig(env: Record<string, string | undefined>): BotConfig {
  const projects = loadProjects();
  return {
    discordToken: env.DISCORD_BOT_TOKEN ?? '',
    discordGuildId: env.DISCORD_GUILD_ID ?? '',
    discordChannelId: env.DISCORD_CHANNEL_ID ?? '',
    discordClientId: env.DISCORD_CLIENT_ID ?? '',
    allowedUserIds: parseCommaSeparated(env.ALLOWED_USER_IDS),
    defaultCwd: env.DEFAULT_CWD || projects[0]?.path || process.cwd(),
    defaultModel: env.DEFAULT_MODEL ?? 'claude-opus-4-6',
    defaultPermissionMode: parsePermissionMode(env.DEFAULT_PERMISSION_MODE),
    maxMessageLength: 2000,
    streamUpdateIntervalMs: 2000,
    rateLimitWindowMs: safeParseInt(env.RATE_LIMIT_WINDOW_MS, 60_000),
    rateLimitMaxRequests: safeParseInt(env.RATE_LIMIT_MAX_REQUESTS, 5),
    projects,
    botRepoPath: env.BOT_REPO_PATH || process.cwd(),
    approvalTimeoutMs: safeParseInt(env.APPROVAL_TIMEOUT_MS, 5 * 60 * 1000),
    sessionIdleTimeoutMs: safeParseInt(env.SESSION_IDLE_TIMEOUT_MS, 30 * 60 * 1000),
    summaryChannelName: (env.SUMMARY_CHANNEL_NAME ?? 'claude-daily-summary')
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100) || 'claude-daily-summary',
    summaryHourUtc: Math.min(23, Math.max(0, safeParseInt(env.SUMMARY_HOUR_UTC, 0))),
    summaryEnabled: env.SUMMARY_ENABLED !== 'false',
    hideReadResults: env.HIDE_READ_RESULTS === 'true',
    hideSearchResults: env.HIDE_SEARCH_RESULTS === 'true',
    hideAllToolEmbeds: env.HIDE_ALL_TOOL_EMBEDS === 'true',
    compactToolEmbeds: env.COMPACT_TOOL_EMBEDS === 'true',
  };
}

/**
 * Validate configuration, returning an array of error messages (empty array means passed)
 * @param config - The bot configuration to validate
 * @returns Array of error messages (empty array means validation passed)
 */
export function validateConfig(config: BotConfig): string[] {
  const errors: string[] = [];

  if (!config.discordToken) {
    errors.push('DISCORD_BOT_TOKEN is not set');
  }
  if (!config.discordGuildId) {
    errors.push('DISCORD_GUILD_ID is not set');
  }
  if (!config.discordChannelId) {
    errors.push('DISCORD_CHANNEL_ID is not set');
  }
  if (config.allowedUserIds.length === 0) {
    errors.push('ALLOWED_USER_IDS is not set (at least one allowed user ID is required)');
  }
  if (config.projects.length === 0) {
    errors.push('projects.json is not set or is empty (at least one project is required)');
  }
  if (config.projects.length > 0 && !config.projects.some((p) => p.path === config.defaultCwd)) {
    errors.push(`DEFAULT_CWD "${config.defaultCwd}" is not in the allowed paths of projects.json`);
  }

  return errors;
}

function parseCommaSeparated(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function safeParseInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parsePermissionMode(value: string | undefined): PermissionMode {
  if (value && VALID_PERMISSION_MODES.includes(value as PermissionMode)) {
    return value as PermissionMode;
  }
  return 'default';
}

/**
 * Load the project list from projects.json
 * @param filePath - Optional file path (defaults to projects.json)
 * @returns Array of projects
 */
export function loadProjects(filePath?: string): Project[] {
  const path = filePath ?? resolve(process.cwd(), 'projects.json');
  try {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw) as unknown[];
    return data.filter(
      (item): item is Project =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).name === 'string' &&
        typeof (item as Record<string, unknown>).path === 'string',
    );
  } catch {
    return [];
  }
}
