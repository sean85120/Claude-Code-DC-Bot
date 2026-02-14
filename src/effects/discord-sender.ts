import {
  type APIEmbed,
  type SendableChannels,
  type TextChannel,
  type ThreadChannel,
  type Message,
  type ChatInputCommandInteraction,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ChannelType,
  ThreadAutoArchiveDuration,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
} from 'discord.js';
import type { AskState } from '../types.js';
import { chunkMessage } from '../modules/formatters.js';

/** Maximum character count for a Discord message */
const MAX_MESSAGE_LENGTH = 2000;

// ─── Basic Sending ───────────────────────────────────

/**
 * Send an Embed to a channel
 *
 * @param channel - The target sendable channel
 * @param embed - The Embed object to send
 * @returns The sent Discord message
 */
export async function sendEmbed(
  channel: SendableChannels,
  embed: APIEmbed,
): Promise<Message> {
  return channel.send({ embeds: [embed] });
}

/**
 * Send an Embed with approve/deny buttons for tool permission approval
 *
 * @param channel - The target channel or Thread
 * @param embed - The Embed object to send
 * @param threadId - The corresponding Thread ID, used for button customId binding
 * @returns The sent Discord message
 */
export async function sendEmbedWithApprovalButtons(
  channel: SendableChannels | ThreadChannel,
  embed: APIEmbed,
  threadId: string,
): Promise<Message> {
  const approve = new ButtonBuilder()
    .setCustomId(`approve:${threadId}`)
    .setLabel('Approve')
    .setStyle(ButtonStyle.Success)
    .setEmoji('✅');

  const deny = new ButtonBuilder()
    .setCustomId(`deny:${threadId}`)
    .setLabel('Deny')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('❌');

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(approve, deny);

  return channel.send({
    embeds: [embed],
    components: [row],
  });
}

/**
 * Build question option buttons from AskState, supporting multi-select toggle state
 *
 * @param threadId - The corresponding Thread ID, used for button customId binding
 * @param askState - The current question interaction tracking state
 * @returns Array of button rows (up to 5 rows)
 */
export function buildQuestionButtons(
  threadId: string,
  askState: AskState,
): ActionRowBuilder<ButtonBuilder>[] {
  const { currentQuestionIndex, questions, selectedOptions, isMultiSelect } = askState;
  const q = questions[currentQuestionIndex];
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let currentRow = new ActionRowBuilder<ButtonBuilder>();

  for (let i = 0; i < q.options.length; i++) {
    if (currentRow.components.length >= 4) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder<ButtonBuilder>();
    }
    const isSelected = selectedOptions.has(i);
    const btn = new ButtonBuilder()
      .setCustomId(`ask:${threadId}:${currentQuestionIndex}:${i}`)
      .setLabel(q.options[i].label.slice(0, 80))
      .setStyle(isSelected ? ButtonStyle.Success : ButtonStyle.Primary);
    currentRow.addComponents(btn);
  }

  // "Other" button
  if (currentRow.components.length >= 5) {
    rows.push(currentRow);
    currentRow = new ActionRowBuilder<ButtonBuilder>();
  }
  const otherBtn = new ButtonBuilder()
    .setCustomId(`ask_other:${threadId}:${currentQuestionIndex}`)
    .setLabel('Other')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('✏️');
  currentRow.addComponents(otherBtn);

  // Add "Confirm Selection" button for multi-select
  if (isMultiSelect) {
    if (currentRow.components.length >= 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder<ButtonBuilder>();
    }
    const submitBtn = new ButtonBuilder()
      .setCustomId(`ask_submit:${threadId}:${currentQuestionIndex}`)
      .setLabel('Confirm Selection')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅');
    currentRow.addComponents(submitBtn);
  }

  rows.push(currentRow);
  return rows.slice(0, 5);
}

/**
 * Send an Embed with pre-built buttons for AskUserQuestion interaction
 *
 * @param channel - The target channel or Thread
 * @param embed - The Embed object to send
 * @param buttons - Pre-built array of button rows
 * @returns The sent Discord message
 */
export async function sendEmbedWithAskButtons(
  channel: SendableChannels | ThreadChannel,
  embed: APIEmbed,
  buttons: ActionRowBuilder<ButtonBuilder>[],
): Promise<Message> {
  return channel.send({
    embeds: [embed],
    components: buttons,
  });
}

/**
 * Build a Modal dialog for the "Other" custom answer option
 *
 * @param threadId - The corresponding Thread ID, used for Modal customId binding
 * @param questionText - The question text, used as the input field label
 * @param qIdx - The current question index, defaults to 0
 * @returns The built Modal object
 */
export function buildAnswerModal(threadId: string, questionText: string, qIdx = 0): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`ask_modal:${threadId}:${qIdx}`)
    .setTitle('Custom Answer');

  const input = new TextInputBuilder()
    .setCustomId('answer_text')
    .setLabel(questionText.slice(0, 45))
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(500);

  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  modal.addComponents(row);
  return modal;
}

/**
 * Update a message's Embed and remove all buttons
 *
 * @param message - The Discord message to update
 * @param embed - The new Embed object
 * @returns The updated Discord message
 */
export async function updateMessageEmbed(
  message: Message,
  embed: APIEmbed,
): Promise<Message> {
  return message.edit({ embeds: [embed], components: [] });
}

/**
 * Edit a message to plain text, clearing Embeds and buttons
 *
 * @param message - The Discord message to edit
 * @param text - The new plain text content
 * @returns The edited Discord message
 */
export async function editMessageText(
  message: Message,
  text: string,
): Promise<Message> {
  return message.edit({ content: text, embeds: [], components: [] });
}

/**
 * Send a single plain text message to a Thread without splitting, used for streaming updates
 *
 * @param thread - The target Thread
 * @param text - The plain text content to send
 * @returns The sent Discord message
 */
export async function sendPlainInThread(
  thread: ThreadChannel,
  text: string,
): Promise<Message> {
  if (thread.archived) await thread.setArchived(false);
  return thread.send(text);
}

// ─── Thread ─────────────────────────────────────────

/**
 * Create a public Thread in a text channel
 *
 * @param channel - The parent text channel
 * @param name - The Thread name
 * @returns The created Thread
 */
export async function createThread(
  channel: TextChannel,
  name: string,
): Promise<ThreadChannel> {
  return channel.threads.create({
    name,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
    type: ChannelType.PublicThread,
  });
}

/**
 * Send an Embed to a Thread, automatically unarchiving if archived
 *
 * @param thread - The target Thread
 * @param embed - The Embed object to send
 * @returns The sent Discord message
 */
export async function sendInThread(
  thread: ThreadChannel,
  embed: APIEmbed,
): Promise<Message> {
  if (thread.archived) await thread.setArchived(false);
  return thread.send({ embeds: [embed] });
}

/**
 * Send text to a Thread, automatically splitting into multiple messages when exceeding the length limit
 *
 * @param thread - The target Thread
 * @param text - The text content to send
 * @returns Array of all sent Discord messages
 */
export async function sendTextInThread(
  thread: ThreadChannel,
  text: string,
): Promise<Message[]> {
  if (thread.archived) await thread.setArchived(false);
  const chunks = chunkMessage(text, MAX_MESSAGE_LENGTH);
  const messages: Message[] = [];
  for (const chunk of chunks) {
    messages.push(await thread.send(chunk));
  }
  return messages;
}

// ─── Interaction Responses ───────────────────────────

/**
 * Defer reply to an interaction, showing a "thinking..." indicator
 *
 * @param interaction - Discord slash command interaction
 * @returns void
 */
export async function deferReply(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply();
}

/**
 * Defer reply to an interaction (ephemeral), visible only to the invoker
 *
 * @param interaction - Discord slash command interaction
 * @returns void
 */
export async function deferReplyEphemeral(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
}

/**
 * Edit a deferred interaction reply
 *
 * @param interaction - Discord slash command interaction
 * @param options - Edit options, may include text, Embeds, buttons, or attachments
 * @returns The edited Discord message
 */
export async function editReply(
  interaction: ChatInputCommandInteraction,
  options: { content?: string; embeds?: APIEmbed[]; components?: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] },
): Promise<Message> {
  return interaction.editReply(options);
}

/**
 * Send a follow-up message
 *
 * @param interaction - Discord slash command interaction
 * @param options - Send options, may include text or Embeds
 * @returns The sent Discord message
 */
export async function sendFollowUp(
  interaction: ChatInputCommandInteraction,
  options: { content?: string; embeds?: APIEmbed[] },
): Promise<Message> {
  return interaction.followUp(options);
}
