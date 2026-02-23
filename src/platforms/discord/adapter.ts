import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  ChannelType,
  ThreadAutoArchiveDuration,
  type Interaction,
  type Message,
  type ThreadChannel,
  type TextChannel,
} from 'discord.js';
import type { BotConfig, FileAttachment } from '../../types.js';
import type {
  PlatformAdapter,
  PlatformMessage,
  RichMessage,
  ActionButton,
  PlatformInteraction,
  PlatformType,
} from '../types.js';
import { richMessageToEmbed, actionButtonsToRows } from './converter.js';
import { chunkMessage } from '../../modules/formatters.js';
import { logger } from '../../effects/logger.js';

const log = logger.child({ module: 'DiscordAdapter' });

/** Discord implementation of PlatformAdapter */
export class DiscordAdapter implements PlatformAdapter {
  readonly platform: PlatformType = 'discord';
  readonly messageLimit = 2000;

  private client: Client;
  private config: BotConfig;
  private commandHandler?: (interaction: PlatformInteraction) => Promise<void>;
  private buttonHandler?: (interaction: PlatformInteraction) => Promise<void>;
  private threadMessageHandler?: (interaction: PlatformInteraction) => Promise<void>;

  /** Map of message IDs to raw Discord Message objects (for editing/deleting) */
  private messageCache = new Map<string, Message>();

  /** Map of interaction IDs to raw Discord Interaction objects (for ephemeral replies) */
  private interactionCache = new Map<string, Interaction>();

  constructor(config: BotConfig) {
    this.config = config;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
  }

  /** Get the underlying Discord Client (for features that need direct access) */
  getClient(): Client {
    return this.client;
  }

  async initialize(): Promise<void> {
    this.client.once('clientReady', () => {});

    this.client.on('interactionCreate', async (interaction) => {
      try {
        // Store raw interaction for ephemeral replies
        const interactionId = interaction.id;
        this.interactionCache.set(interactionId, interaction);

        if (interaction.isChatInputCommand()) {
          if (this.commandHandler) {
            const platformInteraction = this.discordInteractionToPI(interaction);
            await this.commandHandler(platformInteraction);
          }
        } else if (interaction.isButton()) {
          if (this.buttonHandler) {
            const platformInteraction = this.discordInteractionToPI(interaction);
            await this.buttonHandler(platformInteraction);
          }
        } else if (interaction.isModalSubmit()) {
          // Modal submissions are handled through the button handler
          if (this.buttonHandler) {
            const platformInteraction = this.discordInteractionToPI(interaction);
            await this.buttonHandler(platformInteraction);
          }
        }
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

    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return;
      if (!message.channel.isThread()) return;

      try {
        if (this.threadMessageHandler) {
          const platformInteraction: PlatformInteraction = {
            userId: message.author.id,
            threadId: message.channel.id,
            platform: 'discord',
            text: message.content,
            raw: message,
          };
          await this.threadMessageHandler(platformInteraction);
        }
      } catch (error) {
        log.error({ err: error }, 'Message handling error');
      }
    });

    await this.client.login(this.config.discordToken);
  }

  async shutdown(): Promise<void> {
    this.client.destroy();
  }

  async createThread(channelId: string, name: string): Promise<string> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new Error(`Channel ${channelId} is not a text channel`);
    }
    const thread = await (channel as TextChannel).threads.create({
      name,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
      type: ChannelType.PublicThread,
    });
    return thread.id;
  }

  async sendText(threadId: string, text: string): Promise<PlatformMessage[]> {
    const thread = await this.getThread(threadId);
    const chunks = chunkMessage(text, this.messageLimit);
    const messages: PlatformMessage[] = [];
    for (const chunk of chunks) {
      const msg = await thread.send(chunk);
      this.messageCache.set(msg.id, msg);
      messages.push({ id: msg.id, threadId, platform: 'discord' });
    }
    return messages;
  }

  async sendRichMessage(threadId: string, message: RichMessage): Promise<PlatformMessage> {
    const thread = await this.getThread(threadId);
    const embed = richMessageToEmbed(message);
    const msg = await thread.send({ embeds: [embed] });
    this.messageCache.set(msg.id, msg);
    return { id: msg.id, threadId, platform: 'discord' };
  }

  async sendRichMessageWithButtons(
    threadId: string,
    message: RichMessage,
    buttons: ActionButton[],
  ): Promise<PlatformMessage> {
    const thread = await this.getThread(threadId);
    const embed = richMessageToEmbed(message);
    const rows = actionButtonsToRows(buttons);
    const msg = await thread.send({ embeds: [embed], components: rows });
    this.messageCache.set(msg.id, msg);
    return { id: msg.id, threadId, platform: 'discord' };
  }

  async editText(messageRef: PlatformMessage, text: string): Promise<void> {
    const msg = await this.getMessage(messageRef);
    await msg.edit({ content: text, embeds: [], components: [] });
  }

  async editRichMessage(messageRef: PlatformMessage, message: RichMessage): Promise<void> {
    const msg = await this.getMessage(messageRef);
    const embed = richMessageToEmbed(message);
    await msg.edit({ embeds: [embed], components: [] });
  }

  async deleteMessage(messageRef: PlatformMessage): Promise<void> {
    const msg = await this.getMessage(messageRef);
    await msg.delete();
    this.messageCache.delete(messageRef.id);
  }

  async replyEphemeral(interaction: PlatformInteraction, text: string): Promise<void> {
    const raw = interaction.raw;
    if (raw && typeof raw === 'object' && 'reply' in raw) {
      const discordInteraction = raw as Interaction;
      if (discordInteraction.isRepliable()) {
        if (discordInteraction.replied || discordInteraction.deferred) {
          await discordInteraction.followUp({ content: text, flags: [MessageFlags.Ephemeral] });
        } else {
          await discordInteraction.reply({ content: text, flags: [MessageFlags.Ephemeral] });
        }
      }
    }
  }

  async deferReply(interaction: PlatformInteraction): Promise<void> {
    const raw = interaction.raw;
    if (raw && typeof raw === 'object' && 'deferReply' in raw) {
      const discordInteraction = raw as Interaction;
      if (discordInteraction.isRepliable() && !discordInteraction.replied && !discordInteraction.deferred) {
        await discordInteraction.deferReply();
      }
    }
  }

  async editDeferredReply(interaction: PlatformInteraction, text: string): Promise<void> {
    const raw = interaction.raw;
    if (raw && typeof raw === 'object' && 'editReply' in raw) {
      const discordInteraction = raw as Interaction;
      if (discordInteraction.isRepliable()) {
        await discordInteraction.editReply({ content: text });
      }
    }
  }

  mentionUser(userId: string): string {
    return `<@${userId}>`;
  }

  onCommand(handler: (interaction: PlatformInteraction) => Promise<void>): void {
    this.commandHandler = handler;
  }

  onButtonClick(handler: (interaction: PlatformInteraction) => Promise<void>): void {
    this.buttonHandler = handler;
  }

  onThreadMessage(handler: (interaction: PlatformInteraction) => Promise<void>): void {
    this.threadMessageHandler = handler;
  }

  async downloadAttachments(interaction: PlatformInteraction): Promise<FileAttachment[]> {
    // Thread message handler passes raw Discord Message
    const raw = interaction.raw;
    if (raw && typeof raw === 'object' && 'attachments' in raw) {
      const message = raw as Message;
      return this.downloadMessageAttachments(message);
    }
    return [];
  }

  async archiveThread(threadId: string): Promise<void> {
    const thread = await this.getThread(threadId);
    await thread.setArchived(true);
  }

  async unarchiveThread(threadId: string): Promise<void> {
    const thread = await this.getThread(threadId);
    if (thread.archived) await thread.setArchived(false);
  }

  async sendPlainText(threadId: string, text: string): Promise<PlatformMessage> {
    const thread = await this.getThread(threadId);
    const msg = await thread.send(text);
    this.messageCache.set(msg.id, msg);
    return { id: msg.id, threadId, platform: 'discord' };
  }

  // ─── Internal Helpers ─────────────────────────────

  private async getThread(threadId: string): Promise<ThreadChannel> {
    const channel = await this.client.channels.fetch(threadId);
    if (!channel?.isThread()) {
      throw new Error(`Channel ${threadId} is not a thread`);
    }
    const thread = channel as ThreadChannel;
    if (thread.archived) await thread.setArchived(false);
    return thread;
  }

  private async getMessage(ref: PlatformMessage): Promise<Message> {
    const cached = this.messageCache.get(ref.id);
    if (cached) return cached;

    const thread = await this.getThread(ref.threadId);
    const msg = await thread.messages.fetch(ref.id);
    this.messageCache.set(ref.id, msg);
    return msg;
  }

  private discordInteractionToPI(interaction: Interaction): PlatformInteraction {
    const pi: PlatformInteraction = {
      userId: interaction.user.id,
      threadId: interaction.channelId ?? '',
      platform: 'discord',
      raw: interaction,
    };

    if (interaction.isChatInputCommand()) {
      pi.commandName = interaction.commandName;
      pi.commandArgs = {};
      for (const opt of interaction.options.data) {
        pi.commandArgs[opt.name] = opt.value;
      }
    } else if (interaction.isButton()) {
      pi.actionId = interaction.customId;
    } else if (interaction.isModalSubmit()) {
      pi.actionId = interaction.customId;
    }

    return pi;
  }

  private async downloadMessageAttachments(message: Message): Promise<FileAttachment[]> {
    const { classifyAttachment } = await import('../../handlers/thread-message-handler.js');
    const files: FileAttachment[] = [];
    const MAX_FILE_SIZE = 20 * 1024 * 1024;
    const MAX_TEXT_FILE_SIZE = 1 * 1024 * 1024;

    for (const [, attachment] of message.attachments) {
      const fileType = classifyAttachment(attachment.contentType, attachment.name);
      if (!fileType) continue;

      const sizeLimit = fileType === 'text' ? MAX_TEXT_FILE_SIZE : MAX_FILE_SIZE;
      if (attachment.size > sizeLimit) continue;

      try {
        const response = await fetch(attachment.url);
        const buffer = Buffer.from(await response.arrayBuffer());

        const fileAttachment: FileAttachment = {
          type: fileType,
          base64: buffer.toString('base64'),
          mediaType: attachment.contentType || 'application/octet-stream',
          filename: attachment.name,
        };

        if (fileType === 'text') {
          fileAttachment.textContent = buffer.toString('utf-8');
        }

        files.push(fileAttachment);
      } catch (error) {
        log.error({ err: error, filename: attachment.name }, 'Failed to download file');
      }
    }

    return files;
  }
}
