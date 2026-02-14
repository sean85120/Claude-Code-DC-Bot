import type { BotConfig, Project } from '../types.js';

/**
 * Check if a user is in the allowed list
 * @param userId - User ID
 * @param allowedIds - List of allowed user IDs
 * @returns Whether the user is in the allowed list
 */
export function isUserAuthorized(userId: string, allowedIds: string[]): boolean {
  return allowedIds.includes(userId);
}

/**
 * Check if a channel is the designated channel (including thread parent channel)
 * @param channelId - Current channel ID
 * @param allowedChannelId - Allowed channel ID
 * @param parentChannelId - Thread parent channel ID (optional)
 * @returns Whether it is an allowed channel
 */
export function isChannelAuthorized(
  channelId: string,
  allowedChannelId: string,
  parentChannelId?: string | null,
): boolean {
  return channelId === allowedChannelId || parentChannelId === allowedChannelId;
}

/**
 * Comprehensive check for user and channel permissions
 * @param userId - User ID
 * @param channelId - Current channel ID
 * @param config - Bot configuration
 * @param parentChannelId - Thread parent channel ID (optional)
 * @returns Check result (including whether allowed and denial reason)
 */
export function canExecuteCommand(
  userId: string,
  _channelId: string,
  config: BotConfig,
  _parentChannelId?: string | null,
): { allowed: boolean; reason?: string } {
  if (!isUserAuthorized(userId, config.allowedUserIds)) {
    return { allowed: false, reason: 'You do not have permission to use this command' };
  }

  // Channel restriction removed — sessions are routed to per-repo channels automatically
  return { allowed: true };
}

/**
 * Check if a CWD is in the allowed project paths
 * @param cwd - Working directory to check
 * @param projects - List of allowed projects
 * @returns Whether it is an allowed working directory
 */
export function isAllowedCwd(cwd: string, projects: Project[]): boolean {
  return projects.some((p) => p.path === cwd);
}
