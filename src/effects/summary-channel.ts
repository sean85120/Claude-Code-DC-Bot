import { ChannelType, type Client, type TextChannel } from 'discord.js';
import type { BotConfig } from '../types.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'SummaryChannel' });

/**
 * Resolve or create the daily summary channel.
 *
 * Follows the same pattern as channel-manager.ts:
 * - Searches cache first, then fetches from API
 * - Creates the channel in the same category as the general channel if not found
 *
 * @param client - Discord.js client
 * @param config - Bot configuration
 * @returns The summary text channel
 */
export async function resolveSummaryChannel(
  client: Client,
  config: BotConfig,
): Promise<TextChannel> {
  const guild = await client.guilds.fetch(config.discordGuildId);

  // Search cache first
  const cached = guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildText && ch.name === config.summaryChannelName,
  );
  if (cached) {
    return cached as TextChannel;
  }

  // Fetch from API in case cache is stale
  const allChannels = await guild.channels.fetch();
  const found = allChannels.find(
    (ch) => ch !== null && ch.type === ChannelType.GuildText && ch.name === config.summaryChannelName,
  );
  if (found) {
    return found as TextChannel;
  }

  // Get the category of the general channel so new channel goes in the same place
  let categoryId: string | null = null;
  try {
    const generalChannel = await client.channels.fetch(config.discordChannelId);
    if (generalChannel && 'parentId' in generalChannel) {
      categoryId = generalChannel.parentId ?? null;
    }
  } catch {
    // Create at root level if we can't get the category
  }

  // Create the summary channel
  try {
    const newChannel = await guild.channels.create({
      name: config.summaryChannelName,
      type: ChannelType.GuildText,
      parent: categoryId,
      topic: 'Daily summaries of Claude Code sessions — token usage, costs, and completed work',
    });

    log.info({ channelName: config.summaryChannelName }, 'Created daily summary channel');
    return newChannel as TextChannel;
  } catch (error: unknown) {
    const discordError = error as { code?: number; message?: string };
    if (discordError.code === 50013) {
      throw new Error(
        'Bot lacks permission to create channels. Please grant the "Manage Channels" permission.',
      );
    }
    throw new Error(
      `Failed to create summary channel "${config.summaryChannelName}": ${discordError.message ?? String(error)}`,
    );
  }
}
