import WAWebJS from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import type { BotConfig, FileAttachment } from '../../types.js';
import type {
  PlatformAdapter,
  PlatformMessage,
  RichMessage,
  ActionButton,
  PlatformInteraction,
  PlatformType,
} from '../types.js';
import { richMessageToText, actionButtonsToNumberedList, parseTextCommand, parseNumberedReply } from './converter.js';
import { WhatsAppSessionTracker } from './session-tracker.js';
import { chunkMessage } from '../../modules/formatters.js';
import { logger } from '../../effects/logger.js';

const log = logger.child({ module: 'WhatsAppAdapter' });

const { Client: WAClient, LocalAuth } = WAWebJS;

/** Pending approval buttons state for a thread */
interface PendingButtons {
  buttons: ActionButton[];
  threadId: string;
}

/** WhatsApp implementation of PlatformAdapter */
export class WhatsAppAdapter implements PlatformAdapter {
  readonly platform: PlatformType = 'whatsapp';
  readonly messageLimit = 4096;

  private client: WAWebJS.Client;
  private config: BotConfig;
  private sessionTracker = new WhatsAppSessionTracker();
  private commandHandler?: (interaction: PlatformInteraction) => Promise<void>;
  private buttonHandler?: (interaction: PlatformInteraction) => Promise<void>;
  private threadMessageHandler?: (interaction: PlatformInteraction) => Promise<void>;

  /** Track pending button selections per chat */
  private pendingButtons = new Map<string, PendingButtons>();

  /** Message counter for generating IDs */
  private messageCounter = 0;

  constructor(config: BotConfig) {
    this.config = config;
    this.client = new WAClient({
      authStrategy: new LocalAuth(),
      puppeteer: { headless: true },
    });
  }

  async initialize(): Promise<void> {
    this.client.on('qr', (qr: string) => {
      log.info('WhatsApp QR code received, scan to authenticate:');
      qrcode.generate(qr, { small: true });
    });

    this.client.on('authenticated', () => {
      log.info('WhatsApp authenticated');
    });

    this.client.on('ready', () => {
      log.info('WhatsApp client ready');
    });

    this.client.on('message', async (message: WAWebJS.Message) => {
      try {
        await this.handleIncomingMessage(message);
      } catch (error) {
        log.error({ err: error }, 'WhatsApp message handling error');
      }
    });

    await this.client.initialize();
  }

  async shutdown(): Promise<void> {
    await this.client.destroy();
  }

  async createThread(channelId: string, name: string): Promise<string> {
    // In WhatsApp, "threads" are virtual — we create a session for the chat
    const threadId = this.sessionTracker.createSession(channelId);
    // Send a header message
    await this.client.sendMessage(channelId, `*${name}*`);
    return threadId;
  }

  async sendText(threadId: string, text: string): Promise<PlatformMessage[]> {
    const chatId = WhatsAppSessionTracker.extractChatId(threadId);
    const chunks = chunkMessage(text, this.messageLimit);
    const messages: PlatformMessage[] = [];

    for (const chunk of chunks) {
      await this.client.sendMessage(chatId, chunk);
      const id = this.nextMessageId();
      messages.push({ id, threadId, platform: 'whatsapp' });
    }
    return messages;
  }

  async sendRichMessage(threadId: string, message: RichMessage): Promise<PlatformMessage> {
    const chatId = WhatsAppSessionTracker.extractChatId(threadId);
    const text = richMessageToText(message);
    await this.client.sendMessage(chatId, text);
    const id = this.nextMessageId();
    return { id, threadId, platform: 'whatsapp' };
  }

  async sendRichMessageWithButtons(
    threadId: string,
    message: RichMessage,
    buttons: ActionButton[],
  ): Promise<PlatformMessage> {
    const chatId = WhatsAppSessionTracker.extractChatId(threadId);
    const text = richMessageToText(message);
    const buttonList = actionButtonsToNumberedList(buttons);
    const combined = `${text}\n\n${buttonList}`;

    await this.client.sendMessage(chatId, combined);

    // Store pending buttons so we can match numbered replies
    this.pendingButtons.set(chatId, { buttons, threadId });

    const id = this.nextMessageId();
    return { id, threadId, platform: 'whatsapp' };
  }

  async editText(_messageRef: PlatformMessage, _text: string): Promise<void> {
    // WhatsApp doesn't support message editing in whatsapp-web.js
    // No-op: streaming will accumulate and send final text only
  }

  async editRichMessage(_messageRef: PlatformMessage, _message: RichMessage): Promise<void> {
    // No-op
  }

  async deleteMessage(_messageRef: PlatformMessage): Promise<void> {
    // No-op for WhatsApp
  }

  async replyEphemeral(interaction: PlatformInteraction, text: string): Promise<void> {
    // WhatsApp has no ephemeral messages; send as regular message
    const chatId = WhatsAppSessionTracker.extractChatId(interaction.threadId);
    await this.client.sendMessage(chatId, text);
  }

  async deferReply(interaction: PlatformInteraction): Promise<void> {
    // Send a "thinking" indicator
    const chatId = WhatsAppSessionTracker.extractChatId(interaction.threadId);
    await this.client.sendMessage(chatId, '_Thinking..._');
  }

  async editDeferredReply(interaction: PlatformInteraction, text: string): Promise<void> {
    // Send as a new message (can't edit)
    const chatId = WhatsAppSessionTracker.extractChatId(interaction.threadId);
    await this.client.sendMessage(chatId, text);
  }

  mentionUser(_userId: string): string {
    // WhatsApp direct chat doesn't need @mentions
    return '';
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
    if (!raw || typeof raw !== 'object' || !('hasMedia' in raw)) return [];

    const waMessage = raw as WAWebJS.Message;
    if (!waMessage.hasMedia) return [];

    try {
      const media = await waMessage.downloadMedia();
      if (!media) return [];

      const type = media.mimetype.startsWith('image/') ? 'image' as const
        : media.mimetype === 'application/pdf' ? 'document' as const
        : 'text' as const;

      const attachment: FileAttachment = {
        type,
        base64: media.data,
        mediaType: media.mimetype,
        filename: media.filename || 'file',
      };

      if (type === 'text') {
        attachment.textContent = Buffer.from(media.data, 'base64').toString('utf-8');
      }

      return [attachment];
    } catch (error) {
      log.error({ err: error }, 'Failed to download WhatsApp media');
      return [];
    }
  }

  async archiveThread(_threadId: string): Promise<void> {
    // No-op for WhatsApp
  }

  async unarchiveThread(_threadId: string): Promise<void> {
    // No-op for WhatsApp
  }

  async sendPlainText(threadId: string, text: string): Promise<PlatformMessage> {
    const chatId = WhatsAppSessionTracker.extractChatId(threadId);
    await this.client.sendMessage(chatId, text);
    const id = this.nextMessageId();
    return { id, threadId, platform: 'whatsapp' };
  }

  /** Get session tracker for external access */
  getSessionTracker(): WhatsAppSessionTracker {
    return this.sessionTracker;
  }

  // ─── Internal ─────────────────────────────

  private nextMessageId(): string {
    return `wa-msg-${++this.messageCounter}`;
  }

  private isAllowedNumber(chatId: string): boolean {
    if (this.config.whatsappAllowedNumbers.length === 0) return true;
    // chatId format: number@c.us
    const number = chatId.replace('@c.us', '');
    return this.config.whatsappAllowedNumbers.some((n) => number.endsWith(n));
  }

  private async handleIncomingMessage(message: WAWebJS.Message): Promise<void> {
    // Ignore group messages (only support direct chats)
    const chat = await message.getChat();
    if (chat.isGroup) return;

    const chatId = message.from;

    // Check allowed numbers
    if (!this.isAllowedNumber(chatId)) return;

    const body = message.body.trim();
    if (!body && !message.hasMedia) return;

    // Check if this is a numbered reply to pending buttons
    const pending = this.pendingButtons.get(chatId);
    if (pending && this.buttonHandler) {
      const idx = parseNumberedReply(body, pending.buttons.length);
      if (idx >= 0) {
        const button = pending.buttons[idx];
        this.pendingButtons.delete(chatId);

        const pi: PlatformInteraction = {
          userId: chatId,
          threadId: pending.threadId,
          platform: 'whatsapp',
          actionId: button.id,
          raw: message,
        };
        await this.buttonHandler(pi);
        return;
      }
    }

    // Check if this is a text command
    const cmd = parseTextCommand(body);
    if (cmd && this.commandHandler) {
      const threadId = this.sessionTracker.getActiveThreadId(chatId) ?? chatId;
      const pi: PlatformInteraction = {
        userId: chatId,
        threadId,
        platform: 'whatsapp',
        commandName: cmd.command,
        commandArgs: { text: cmd.args },
        raw: message,
      };
      await this.commandHandler(pi);
      return;
    }

    // Otherwise, treat as a follow-up message to the active session
    const activeThreadId = this.sessionTracker.getActiveThreadId(chatId);
    if (activeThreadId && this.threadMessageHandler) {
      const pi: PlatformInteraction = {
        userId: chatId,
        threadId: activeThreadId,
        platform: 'whatsapp',
        text: body,
        raw: message,
      };
      await this.threadMessageHandler(pi);
    }
  }
}
