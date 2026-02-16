import { ChannelType, type Client, type TextChannel } from 'discord.js';
import { normalizeChannelName } from '../modules/channel-utils.js';

export { normalizeChannelName };

/** In-flight channel creation promises, keyed by normalized channel name */
const pendingCreations = new Map<string, Promise<{ channelId: string; channel: TextChannel; created: boolean }>>();

/**
 * Resolve the target Discord text channel for a project.
 *
 * - If `isBotRepo` is true, returns the general channel directly.
 * - Otherwise, searches for an existing channel matching the normalized project name.
 * - If no channel exists, creates one in the same category as the general channel.
 * - Uses a per-name mutex to prevent duplicate channel creation under concurrent requests.
 *
 * @param client - Discord.js client
 * @param guildId - The Discord guild (server) ID
 * @param generalChannelId - The general channel ID (DISCORD_CHANNEL_ID)
 * @param projectName - The project name to resolve a channel for
 * @param isBotRepo - Whether this project is the bot's own repository
 * @returns The resolved channel info: channelId, channel object, and whether it was newly created
 */
export async function resolveProjectChannel(
  client: Client,
  guildId: string,
  generalChannelId: string,
  projectName: string,
  isBotRepo: boolean,
): Promise<{ channelId: string; channel: TextChannel; created: boolean }> {
  // Bot repo always uses the general channel
  if (isBotRepo) {
    const generalChannel = await client.channels.fetch(generalChannelId);
    if (!generalChannel || generalChannel.type !== ChannelType.GuildText) {
      throw new Error('General channel not found or is not a text channel');
    }
    return { channelId: generalChannelId, channel: generalChannel as TextChannel, created: false };
  }

  const channelName = normalizeChannelName(projectName);
  if (!channelName) {
    throw new Error(`Invalid project name: "${projectName}" produces an empty channel name`);
  }

  // Deduplicate concurrent creation requests for the same channel name
  const existing = pendingCreations.get(channelName);
  if (existing) {
    return existing;
  }

  const promise = resolveOrCreateChannel(client, guildId, generalChannelId, channelName, projectName);
  pendingCreations.set(channelName, promise);
  try {
    return await promise;
  } finally {
    pendingCreations.delete(channelName);
  }
}

async function resolveOrCreateChannel(
  client: Client,
  guildId: string,
  generalChannelId: string,
  channelName: string,
  projectName: string,
): Promise<{ channelId: string; channel: TextChannel; created: boolean }> {
  const guild = await client.guilds.fetch(guildId);

  // Search cache first, then fetch
  const cached = guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildText && ch.name === channelName,
  );
  if (cached) {
    return { channelId: cached.id, channel: cached as TextChannel, created: false };
  }

  // Fetch from API in case cache is stale
  const allChannels = await guild.channels.fetch();
  const found = allChannels.find(
    (ch) => ch !== null && ch.type === ChannelType.GuildText && ch.name === channelName,
  );

  if (found) {
    return { channelId: found.id, channel: found as TextChannel, created: false };
  }

  // Get the category of the general channel so new channels go in the same place
  let categoryId: string | null = null;
  try {
    const generalChannel = await client.channels.fetch(generalChannelId);
    if (generalChannel && 'parentId' in generalChannel) {
      categoryId = generalChannel.parentId ?? null;
    }
  } catch {
    // If we can't fetch the general channel's category, create at root level
  }

  // Create the channel
  try {
    const newChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: categoryId,
      topic: `Sessions for project: ${projectName}`,
    });

    return { channelId: newChannel.id, channel: newChannel as TextChannel, created: true };
  } catch (error: unknown) {
    const discordError = error as { code?: number; message?: string };
    if (discordError.code === 50013) {
      throw new Error(
        'Bot lacks permission to create channels. Please grant the "Manage Channels" permission.',
      );
    }
    throw new Error(
      `Failed to create channel "${channelName}": ${discordError.message ?? String(error)}`,
    );
  }
}
