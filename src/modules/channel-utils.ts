/** Prefix for auto-created project channels to avoid collisions with existing channels */
const CHANNEL_PREFIX = 'claude-';

/**
 * Normalize a project name into a valid Discord channel name.
 * - Adds "claude-" prefix to avoid collisions with existing channels
 * - Lowercase
 * - Replace non-alphanumeric characters (except hyphens) with hyphens
 * - Collapse consecutive hyphens
 * - Remove leading/trailing hyphens
 * - Truncate to 100 characters (Discord limit)
 *
 * @param name - The project name
 * @returns A valid Discord channel name with "claude-" prefix
 */
export function normalizeChannelName(name: string): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!normalized) return '';
  return `${CHANNEL_PREFIX}${normalized}`.slice(0, 100);
}

/**
 * Extract the channel name from a Discord interaction's channel object.
 *
 * Returns `undefined` if the channel has no `name` property (e.g. DMs, partial channels).
 *
 * @param channel - The interaction's channel (may be partial)
 * @returns The channel name, or undefined
 */
export function getChannelName(channel: unknown): string | undefined {
  if (channel && typeof channel === 'object' && 'name' in channel) {
    const name = (channel as { name: unknown }).name;
    return typeof name === 'string' ? name : undefined;
  }
  return undefined;
}
