import { App, type BlockAction, type SlashCommand } from '@slack/bolt';
import type { BotConfig, FileAttachment } from '../../types.js';
import type {
  PlatformAdapter,
  PlatformMessage,
  RichMessage,
  ActionButton,
  PlatformInteraction,
  PlatformType,
} from '../types.js';
import { richMessageToBlocks, actionButtonsToSlackActions, richMessageToFallbackText } from './converter.js';
import { chunkMessage } from '../../modules/formatters.js';
import { logger } from '../../effects/logger.js';

const log = logger.child({ module: 'SlackAdapter' });

/**
 * Parse a composite Slack thread ID back to channel + thread_ts
 * Format: `{channelId}:{thread_ts}`
 */
function parseThreadId(threadId: string): { channel: string; thread_ts: string } {
  const idx = threadId.indexOf(':');
  if (idx < 0) throw new Error(`Invalid Slack threadId: ${threadId}`);
  return { channel: threadId.slice(0, idx), thread_ts: threadId.slice(idx + 1) };
}

/** Slack implementation of PlatformAdapter */
export class SlackAdapter implements PlatformAdapter {
  readonly platform: PlatformType = 'slack';
  readonly messageLimit = 4000;

  private app: App;
  private config: BotConfig;
  private commandHandler?: (interaction: PlatformInteraction) => Promise<void>;
  private buttonHandler?: (interaction: PlatformInteraction) => Promise<void>;
  private threadMessageHandler?: (interaction: PlatformInteraction) => Promise<void>;

  /** Map of message ts → { channel, ts } for editing/deleting */
  private messageCache = new Map<string, { channel: string; ts: string }>();

  constructor(config: BotConfig) {
    this.config = config;
    this.app = new App({
      token: config.slackBotToken,
      appToken: config.slackAppToken,
      signingSecret: config.slackSigningSecret,
      socketMode: true,
    });
  }

  /** Get the underlying Slack App (for features needing direct access) */
  getApp(): App {
    return this.app;
  }

  async initialize(): Promise<void> {
    // Register slash commands
    const slashCommands = ['claude-prompt', 'claude-stop', 'claude-status', 'claude-history', 'claude-retry'];
    for (const cmd of slashCommands) {
      this.app.command(`/${cmd}`, async ({ command, ack }) => {
        await ack();
        if (this.commandHandler) {
          const pi = this.slashCommandToPI(command);
          await this.commandHandler(pi);
        }
      });
    }

    // Register button actions (match all action_ids)
    this.app.action(/.*/, async ({ action, body, ack }) => {
      await ack();
      if (this.buttonHandler && body.type === 'block_actions') {
        const blockAction = body as BlockAction;
        const btn = action as { action_id: string };
        const userId = blockAction.user.id;
        const channel = blockAction.channel?.id ?? '';
        const threadTs = blockAction.message?.thread_ts ?? blockAction.message?.ts ?? '';
        const threadId = threadTs ? `${channel}:${threadTs}` : channel;

        const pi: PlatformInteraction = {
          userId,
          threadId,
          platform: 'slack',
          actionId: btn.action_id,
          raw: body,
        };
        await this.buttonHandler(pi);
      }
    });

    // Register message events for thread follow-ups
    this.app.message(async ({ message, event }) => {
      // Only handle threaded messages (replies)
      if (!('thread_ts' in event) || !event.thread_ts) return;
      // Ignore bot messages
      if ('bot_id' in event) return;
      if (!('user' in event) || !event.user) return;

      const threadId = `${event.channel}:${event.thread_ts}`;

      if (this.threadMessageHandler) {
        const pi: PlatformInteraction = {
          userId: event.user,
          threadId,
          platform: 'slack',
          text: 'text' in event ? (event.text ?? '') : '',
          raw: message,
        };
        await this.threadMessageHandler(pi);
      }
    });

    await this.app.start();
    log.info('Slack adapter initialized (Socket Mode)');
  }

  async shutdown(): Promise<void> {
    await this.app.stop();
  }

  async createThread(channelId: string, name: string): Promise<string> {
    // In Slack, threads are created by posting a message and using its ts as thread_ts
    const result = await this.app.client.chat.postMessage({
      channel: channelId,
      text: name,
    });
    const ts = result.ts!;
    return `${channelId}:${ts}`;
  }

  async sendText(threadId: string, text: string): Promise<PlatformMessage[]> {
    const { channel, thread_ts } = parseThreadId(threadId);
    const chunks = chunkMessage(text, this.messageLimit);
    const messages: PlatformMessage[] = [];

    for (const chunk of chunks) {
      const result = await this.app.client.chat.postMessage({
        channel,
        thread_ts,
        text: chunk,
      });
      const ts = result.ts!;
      this.messageCache.set(ts, { channel, ts });
      messages.push({ id: ts, threadId, platform: 'slack' });
    }
    return messages;
  }

  async sendRichMessage(threadId: string, message: RichMessage): Promise<PlatformMessage> {
    const { channel, thread_ts } = parseThreadId(threadId);
    const blocks = richMessageToBlocks(message);
    const fallback = richMessageToFallbackText(message);

    const result = await this.app.client.chat.postMessage({
      channel,
      thread_ts,
      text: fallback,
      blocks,
    });

    const ts = result.ts!;
    this.messageCache.set(ts, { channel, ts });
    return { id: ts, threadId, platform: 'slack' };
  }

  async sendRichMessageWithButtons(
    threadId: string,
    message: RichMessage,
    buttons: ActionButton[],
  ): Promise<PlatformMessage> {
    const { channel, thread_ts } = parseThreadId(threadId);
    const blocks = richMessageToBlocks(message);
    const actionsBlock = actionButtonsToSlackActions(buttons);
    blocks.push(actionsBlock);

    const fallback = richMessageToFallbackText(message);
    const result = await this.app.client.chat.postMessage({
      channel,
      thread_ts,
      text: fallback,
      blocks,
    });

    const ts = result.ts!;
    this.messageCache.set(ts, { channel, ts });
    return { id: ts, threadId, platform: 'slack' };
  }

  async editText(messageRef: PlatformMessage, text: string): Promise<void> {
    const cached = this.messageCache.get(messageRef.id);
    if (!cached) return;

    await this.app.client.chat.update({
      channel: cached.channel,
      ts: cached.ts,
      text,
    });
  }

  async editRichMessage(messageRef: PlatformMessage, message: RichMessage): Promise<void> {
    const cached = this.messageCache.get(messageRef.id);
    if (!cached) return;

    const blocks = richMessageToBlocks(message);
    const fallback = richMessageToFallbackText(message);

    await this.app.client.chat.update({
      channel: cached.channel,
      ts: cached.ts,
      text: fallback,
      blocks,
    });
  }

  async deleteMessage(messageRef: PlatformMessage): Promise<void> {
    const cached = this.messageCache.get(messageRef.id);
    if (!cached) return;

    await this.app.client.chat.delete({
      channel: cached.channel,
      ts: cached.ts,
    });
    this.messageCache.delete(messageRef.id);
  }

  async replyEphemeral(interaction: PlatformInteraction, text: string): Promise<void> {
    // For Slack, ephemeral messages require channel + user
    const raw = interaction.raw;
    if (raw && typeof raw === 'object' && 'response_url' in raw) {
      // Slash command - use response_url
      const cmd = raw as SlashCommand;
      await this.app.client.chat.postEphemeral({
        channel: cmd.channel_id,
        user: interaction.userId,
        text,
      });
    } else if (raw && typeof raw === 'object' && 'channel' in raw) {
      const body = raw as BlockAction;
      const channel = body.channel?.id ?? '';
      if (channel) {
        await this.app.client.chat.postEphemeral({
          channel,
          user: interaction.userId,
          text,
        });
      }
    }
  }

  async deferReply(_interaction: PlatformInteraction): Promise<void> {
    // Slack slash commands are already ack'd; no explicit defer needed
  }

  async editDeferredReply(interaction: PlatformInteraction, text: string): Promise<void> {
    // Post the response in the channel/thread as a regular message
    const raw = interaction.raw;
    if (raw && typeof raw === 'object' && 'channel_id' in raw) {
      const cmd = raw as SlashCommand;
      await this.app.client.chat.postMessage({
        channel: cmd.channel_id,
        text,
      });
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
    const raw = interaction.raw;
    if (!raw || typeof raw !== 'object' || !('files' in raw)) return [];

    const slackFiles = (raw as { files?: Array<{ url_private_download?: string; mimetype?: string; name?: string; size?: number }> }).files;
    if (!slackFiles) return [];

    const files: FileAttachment[] = [];
    for (const file of slackFiles) {
      if (!file.url_private_download) continue;
      const size = file.size ?? 0;
      if (size > 20 * 1024 * 1024) continue;

      try {
        const response = await fetch(file.url_private_download, {
          headers: { Authorization: `Bearer ${this.config.slackBotToken}` },
        });
        const buffer = Buffer.from(await response.arrayBuffer());
        const mediaType = file.mimetype ?? 'application/octet-stream';
        const filename = file.name ?? 'file';

        // Determine type
        let type: 'image' | 'document' | 'text' = 'text';
        if (mediaType.startsWith('image/')) type = 'image';
        else if (mediaType === 'application/pdf') type = 'document';

        const attachment: FileAttachment = {
          type,
          base64: buffer.toString('base64'),
          mediaType,
          filename,
        };
        if (type === 'text') {
          attachment.textContent = buffer.toString('utf-8');
        }
        files.push(attachment);
      } catch (error) {
        log.error({ err: error, filename: file.name }, 'Failed to download Slack file');
      }
    }
    return files;
  }

  async archiveThread(_threadId: string): Promise<void> {
    // Slack threads can't be archived individually; no-op
  }

  async unarchiveThread(_threadId: string): Promise<void> {
    // No-op for Slack
  }

  async sendPlainText(threadId: string, text: string): Promise<PlatformMessage> {
    const { channel, thread_ts } = parseThreadId(threadId);
    const result = await this.app.client.chat.postMessage({
      channel,
      thread_ts,
      text,
    });
    const ts = result.ts!;
    this.messageCache.set(ts, { channel, ts });
    return { id: ts, threadId, platform: 'slack' };
  }

  // ─── Internal Helpers ─────────────────────────────

  private slashCommandToPI(command: SlashCommand): PlatformInteraction {
    // Map slash command name to a unified command name
    // /claude-prompt → prompt, /claude-stop → stop, etc.
    const commandName = command.command.replace('/claude-', '');
    const threadTs = command.thread_ts ?? '';
    const threadId = threadTs ? `${command.channel_id}:${threadTs}` : command.channel_id;

    return {
      userId: command.user_id,
      threadId,
      platform: 'slack',
      commandName,
      commandArgs: { text: command.text },
      raw: command,
    };
  }
}
