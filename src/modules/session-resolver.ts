import type { ChatInputCommandInteraction } from 'discord.js';
import type { StateStore } from '../effects/state-store.js';

/**
 * Resolve threadId from interaction context
 * - If inside a thread: return that thread ID
 * - If not inside a thread: return the threadId if there is exactly 1 active session, otherwise return null
 * @param interaction - Discord command interaction
 * @param store - State store (used to query active sessions)
 * @returns Resolved threadId, or null if unable to determine
 */
export function resolveThreadId(
  interaction: ChatInputCommandInteraction,
  store: StateStore,
): string | null {
  const channel = interaction.channel;
  if (channel?.isThread()) {
    return channel.id;
  }

  // Not in a thread, try to find the only active session
  const activeSessions = store.getAllActiveSessions();
  if (activeSessions.size === 1) {
    return activeSessions.keys().next().value ?? null;
  }

  return null;
}
