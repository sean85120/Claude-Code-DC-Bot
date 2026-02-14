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
 * Check if a user is permitted to execute bot commands.
 *
 * Channel-level restrictions are intentionally omitted: with per-repo channel routing,
 * slash commands are guild-wide and output is automatically routed to the correct
 * project channel. Access control relies on the ALLOWED_USER_IDS whitelist.
 */
export function canExecuteCommand(
  userId: string,
  config: BotConfig,
): { allowed: boolean; reason?: string } {
  if (!isUserAuthorized(userId, config.allowedUserIds)) {
    return { allowed: false, reason: 'You do not have permission to use this command' };
  }

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
