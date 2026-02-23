import type { FileAttachment } from '../types.js';

// ─── Platform Types ─────────────────────────────────

/** Supported platform identifiers */
export type PlatformType = 'discord' | 'slack' | 'whatsapp';

/** Platform-agnostic message reference */
export interface PlatformMessage {
  id: string;
  threadId: string;
  platform: PlatformType;
}

/** Platform-agnostic rich message (replaces Discord APIEmbed) */
export interface RichMessage {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline: boolean }>;
  footer?: string;
  timestamp?: string;
  /** Prefix emoji + label (maps from APIEmbed author.name) */
  author?: string;
}

/** Platform-agnostic action button */
export interface ActionButton {
  id: string;
  label: string;
  style: 'primary' | 'success' | 'danger' | 'secondary';
  emoji?: string;
}

/** Platform-agnostic interaction (command, button click, or message) */
export interface PlatformInteraction {
  userId: string;
  threadId: string;
  platform: PlatformType;
  /** For button clicks */
  actionId?: string;
  /** For text messages / commands */
  text?: string;
  /** Slash command name */
  commandName?: string;
  /** Slash command args */
  commandArgs?: Record<string, unknown>;
  /** File attachments */
  attachments?: FileAttachment[];
  /** Raw platform-specific interaction object */
  raw: unknown;
}

// ─── Platform Adapter Interface ─────────────────────

/** Abstract platform adapter — all platform I/O goes through this interface */
export interface PlatformAdapter {
  /** Platform identifier */
  readonly platform: PlatformType;

  /** Maximum message length for this platform */
  readonly messageLimit: number;

  /** Initialize the platform client (login, connect, etc.) */
  initialize(): Promise<void>;

  /** Gracefully shut down the platform client */
  shutdown(): Promise<void>;

  /** Create a new thread/conversation */
  createThread(channelId: string, name: string): Promise<string>;

  /** Send plain text to a thread, auto-chunking if needed */
  sendText(threadId: string, text: string): Promise<PlatformMessage[]>;

  /** Send a rich message (embed/block/formatted text) to a thread */
  sendRichMessage(threadId: string, message: RichMessage): Promise<PlatformMessage>;

  /** Send a rich message with action buttons */
  sendRichMessageWithButtons(
    threadId: string,
    message: RichMessage,
    buttons: ActionButton[],
  ): Promise<PlatformMessage>;

  /** Edit a plain text message */
  editText(messageRef: PlatformMessage, text: string): Promise<void>;

  /** Edit a rich message */
  editRichMessage(messageRef: PlatformMessage, message: RichMessage): Promise<void>;

  /** Delete a message */
  deleteMessage(messageRef: PlatformMessage): Promise<void>;

  /** Send an ephemeral reply (only visible to the user) */
  replyEphemeral(interaction: PlatformInteraction, text: string): Promise<void>;

  /** Defer a reply (show typing indicator) */
  deferReply(interaction: PlatformInteraction): Promise<void>;

  /** Edit a deferred reply */
  editDeferredReply(interaction: PlatformInteraction, text: string): Promise<void>;

  /** Format a user mention */
  mentionUser(userId: string): string;

  /** Register a command handler */
  onCommand(handler: (interaction: PlatformInteraction) => Promise<void>): void;

  /** Register a button click handler */
  onButtonClick(handler: (interaction: PlatformInteraction) => Promise<void>): void;

  /** Register a thread message handler */
  onThreadMessage(handler: (interaction: PlatformInteraction) => Promise<void>): void;

  /** Download file attachments from a message/interaction */
  downloadAttachments(interaction: PlatformInteraction): Promise<FileAttachment[]>;

  /** Archive/close a thread */
  archiveThread(threadId: string): Promise<void>;

  /** Unarchive/reopen a thread */
  unarchiveThread(threadId: string): Promise<void>;

  /** Send a plain text message without chunking (for streaming updates) */
  sendPlainText(threadId: string, text: string): Promise<PlatformMessage>;
}
