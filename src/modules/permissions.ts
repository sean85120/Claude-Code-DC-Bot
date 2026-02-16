import type { BotConfig, Project } from '../types.js';
import { normalizeChannelName } from './channel-utils.js';

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

/**
 * Check whether a repo selection is allowed in the given channel.
 *
 * Rules:
 * - Channels matching a project's normalized name only allow that project's path
 * - All other channels (including the general channel) are unrestricted
 * - The caller should skip this check for the general channel (by ID) before calling
 *
 * @param channelName - The name of the channel where the command was invoked
 * @param selectedCwd - The repo path the user selected
 * @param projects - The project list
 * @returns Object with `allowed` boolean and optional `reason` / `boundProjectName`
 */
export function checkChannelRepoRestriction(
  channelName: string,
  selectedCwd: string,
  projects: Project[],
): { allowed: boolean; reason?: string; boundProjectName?: string } {
  const boundProject = getProjectFromChannel(channelName, projects);
  if (!boundProject) {
    // No project matches this channel name — unrestricted
    return { allowed: true };
  }
  if (boundProject.path === selectedCwd) {
    return { allowed: true, boundProjectName: boundProject.name };
  }
  return {
    allowed: false,
    reason: `This channel is dedicated to **${boundProject.name}**. Please use the general channel or the correct project channel to run other repos.`,
    boundProjectName: boundProject.name,
  };
}

/**
 * Determine which project a channel belongs to based on channel name.
 *
 * Compares the channel name against each project's normalized name.
 * Returns the matching `Project` or `null` if the channel is not a project channel.
 *
 * @param channelName - The Discord channel name
 * @param projects - The project list
 * @returns The matching project or null
 */
export function getProjectFromChannel(channelName: string, projects: Project[]): Project | null {
  for (const project of projects) {
    const normalized = normalizeChannelName(project.name);
    if (normalized && channelName === normalized) {
      return project;
    }
  }
  return null;
}
