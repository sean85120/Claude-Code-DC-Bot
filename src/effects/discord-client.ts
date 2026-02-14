import { Client, GatewayIntentBits, MessageFlags, type Interaction, type Message } from 'discord.js';
import type { BotConfig } from '../types.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'Discord' });

/**
 * Create and log in a Discord Client, bindng interaction and message events
 * @param config - Bot configuration
 * @param onInteraction - Slash Command / Button / Modal interaction handler
 * @param onMessageCreate - Plain message handler in Threads (for follow-up questions)
 * @returns The logged-in Discord Client instance
 */
export async function createDiscordClient(
  config: BotConfig,
  onInteraction: (interaction: Interaction) => Promise<void>,
  onMessageCreate?: (message: Message) => Promise<void>,
): Promise<Client> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  // clientReady event is handled and displayed by index.ts
  client.once('clientReady', () => {});

  client.on('interactionCreate', async (interaction) => {
    try {
      await onInteraction(interaction);
    } catch (error) {
      log.error({ err: error }, 'Interaction handling error');

      if (interaction.isRepliable()) {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: '❌ An error occurred while executing the command', flags: [MessageFlags.Ephemeral] }).catch(() => {});
        } else {
          await interaction.reply({ content: '❌ An error occurred while executing the command', flags: [MessageFlags.Ephemeral] }).catch(() => {});
        }
      }
    }
  });

  // Listen for plain messages in Threads (for follow-up questions)
  if (onMessageCreate) {
    client.on('messageCreate', async (message) => {
      try {
        await onMessageCreate(message);
      } catch (error) {
        log.error({ err: error }, 'Message handling error');
      }
    });
  }

  await client.login(config.discordToken);
  return client;
}

/**
 * Safely shut down a Discord Client
 * @param client - The Client instance to shut down
 */
export async function destroyDiscordClient(client: Client): Promise<void> {
  client.destroy();
}
