import { MessageFlags, type ButtonInteraction, type ModalSubmitInteraction } from 'discord.js';
import type { PendingApproval } from '../types.js';
import type { StateStore } from '../effects/state-store.js';
import { buildAskQuestionStepEmbed, buildAskCompletedEmbed } from '../modules/embeds.js';
import { buildQuestionButtons, buildAnswerModal } from '../effects/discord-sender.js';
import { richMessageToEmbed } from '../platforms/discord/converter.js';
import { logger } from '../effects/logger.js';

const log = logger.child({ module: 'AskHandler' });

/** Dependency injection interface for the AskUserQuestion handler */
export interface AskHandlerDeps {
  store: StateStore;
}

/**
 * Advances to the next question or finalizes all questions
 */
async function advanceOrFinalize(
  threadId: string,
  pending: PendingApproval,
  interaction: ButtonInteraction | ModalSubmitInteraction,
  store: StateStore,
): Promise<void> {
  const askState = pending.askState!;
  const nextIdx = askState.currentQuestionIndex + 1;

  if (nextIdx >= askState.totalQuestions) {
    // All questions answered -> resolve
    const toolInput = pending.toolInput as Record<string, unknown>;
    const summaryEmbed = buildAskCompletedEmbed(askState);

    if (interaction.isButton()) {
      await interaction.update({ embeds: [richMessageToEmbed(summaryEmbed)], components: [] });
    } else {
      // Modal submit: reply to modal, then edit original message
      const lastAnswer = askState.collectedAnswers[String(askState.currentQuestionIndex)] || '';
      await interaction.reply({ content: `✅ Answered: **${lastAnswer}**`, flags: [MessageFlags.Ephemeral] });
      try {
        const channel = interaction.channel ?? await interaction.client.channels.fetch(interaction.channelId!);
        if (channel && 'messages' in channel) {
          const msg = await channel.messages.fetch(pending.messageId);
          await msg.edit({ embeds: [richMessageToEmbed(summaryEmbed)], components: [] });
        }
      } catch (e) {
        log.warn({ threadId, error: e }, 'Unable to update original message');
      }
    }

    store.resolvePendingApproval(threadId, {
      behavior: 'allow',
      updatedInput: { ...toolInput, answers: askState.collectedAnswers },
    });

    log.info({ threadId, answers: askState.collectedAnswers }, 'All questions answered');
  } else {
    // Advance to next question
    askState.currentQuestionIndex = nextIdx;
    askState.selectedOptions = new Set();
    askState.isMultiSelect = askState.questions[nextIdx].multiSelect;

    const nextEmbed = buildAskQuestionStepEmbed(askState);
    const nextButtons = buildQuestionButtons(threadId, askState);

    if (interaction.isButton()) {
      await interaction.update({ embeds: [richMessageToEmbed(nextEmbed)], components: nextButtons });
    } else {
      // Modal submit
      const lastAnswer = askState.collectedAnswers[String(nextIdx - 1)] || '';
      await interaction.reply({ content: `✅ Answered: **${lastAnswer}**`, flags: [MessageFlags.Ephemeral] });
      try {
        const channel = interaction.channel ?? await interaction.client.channels.fetch(interaction.channelId!);
        if (channel && 'messages' in channel) {
          const msg = await channel.messages.fetch(pending.messageId);
          await msg.edit({ embeds: [richMessageToEmbed(nextEmbed)], components: nextButtons });
        }
      } catch (e) {
        log.warn({ threadId, error: e }, 'Unable to update original message');
      }
    }

    log.info({ threadId, nextQuestion: nextIdx }, 'Advancing to next question');
  }
}

/**
 * Handles option button clicks (single-select advances directly, multi-select toggles selected state)
 *
 * @param interaction - Discord button interaction event
 * @param threadId - The corresponding Thread ID
 * @param qIdx - Current question index
 * @param optIdx - The clicked option index
 * @param deps - AskHandler dependencies
 * @returns void
 */
export async function handleAskOptionClick(
  interaction: ButtonInteraction,
  threadId: string,
  qIdx: number,
  optIdx: number,
  deps: AskHandlerDeps,
): Promise<void> {
  const pending = deps.store.getPendingApproval(threadId);

  if (!pending?.askState) {
    await interaction.reply({ content: '⚠️ This request has expired', flags: [MessageFlags.Ephemeral] });
    return;
  }

  const { askState } = pending;

  if (qIdx !== askState.currentQuestionIndex) {
    await interaction.reply({ content: '⚠️ This option has expired', flags: [MessageFlags.Ephemeral] });
    return;
  }

  if (askState.isMultiSelect) {
    // Multi-select: toggle selected state
    if (askState.selectedOptions.has(optIdx)) {
      askState.selectedOptions.delete(optIdx);
    } else {
      askState.selectedOptions.add(optIdx);
    }

    const embed = buildAskQuestionStepEmbed(askState);
    const buttons = buildQuestionButtons(threadId, askState);
    await interaction.update({ embeds: [richMessageToEmbed(embed)], components: buttons });
  } else {
    // Single-select: record answer and advance
    const selectedLabel = askState.questions[qIdx].options[optIdx]?.label || `Option ${optIdx + 1}`;
    askState.collectedAnswers[String(qIdx)] = selectedLabel;
    await advanceOrFinalize(threadId, pending, interaction, deps.store);
  }
}

/**
 * Handles multi-select confirm button, recording selected options as the answer and advancing to the next question
 *
 * @param interaction - Discord button interaction event
 * @param threadId - The corresponding Thread ID
 * @param qIdx - Current question index
 * @param deps - AskHandler dependencies
 * @returns void
 */
export async function handleAskSubmit(
  interaction: ButtonInteraction,
  threadId: string,
  qIdx: number,
  deps: AskHandlerDeps,
): Promise<void> {
  const pending = deps.store.getPendingApproval(threadId);

  if (!pending?.askState) {
    await interaction.reply({ content: '⚠️ This request has expired', flags: [MessageFlags.Ephemeral] });
    return;
  }

  const { askState } = pending;

  if (qIdx !== askState.currentQuestionIndex) {
    await interaction.reply({ content: '⚠️ This option has expired', flags: [MessageFlags.Ephemeral] });
    return;
  }

  if (askState.selectedOptions.size === 0) {
    await interaction.reply({ content: '⚠️ Please select at least one option', flags: [MessageFlags.Ephemeral] });
    return;
  }

  const q = askState.questions[qIdx];
  const selectedLabels = Array.from(askState.selectedOptions)
    .sort((a, b) => a - b)
    .map((i) => q.options[i]?.label || `Option ${i + 1}`);
  askState.collectedAnswers[String(qIdx)] = selectedLabels.join(', ');

  await advanceOrFinalize(threadId, pending, interaction, deps.store);
}

/**
 * Handles "Other" button click, showing a Modal for the user to enter a custom answer
 *
 * @param interaction - Discord button interaction event
 * @param threadId - The corresponding Thread ID
 * @param qIdx - Current question index
 * @param deps - AskHandler dependencies
 * @returns void
 */
export async function handleAskOther(
  interaction: ButtonInteraction,
  threadId: string,
  qIdx: number,
  deps: AskHandlerDeps,
): Promise<void> {
  const pending = deps.store.getPendingApproval(threadId);

  if (!pending?.askState) {
    await interaction.reply({ content: '⚠️ This request has expired', flags: [MessageFlags.Ephemeral] });
    return;
  }

  if (qIdx !== pending.askState.currentQuestionIndex) {
    await interaction.reply({ content: '⚠️ This option has expired', flags: [MessageFlags.Ephemeral] });
    return;
  }

  const questionText = pending.askState.questions[qIdx]?.question || 'Please enter your answer';
  const modal = buildAnswerModal(threadId, questionText, qIdx);
  await interaction.showModal(modal);
}

/**
 * Handles Modal submit, recording the user's custom text as the answer and advancing to the next question
 *
 * @param interaction - Discord Modal submit interaction event
 * @param threadId - The corresponding Thread ID
 * @param qIdx - Current question index
 * @param deps - AskHandler dependencies
 * @returns void
 */
export async function handleAskModalSubmit(
  interaction: ModalSubmitInteraction,
  threadId: string,
  qIdx: number,
  deps: AskHandlerDeps,
): Promise<void> {
  const pending = deps.store.getPendingApproval(threadId);

  if (!pending?.askState) {
    await interaction.reply({ content: '⚠️ This request has expired', flags: [MessageFlags.Ephemeral] });
    return;
  }

  if (qIdx !== pending.askState.currentQuestionIndex) {
    await interaction.reply({ content: '⚠️ This option has expired', flags: [MessageFlags.Ephemeral] });
    return;
  }

  const answerText = interaction.fields.getTextInputValue('answer_text');
  pending.askState.collectedAnswers[String(qIdx)] = answerText;

  await advanceOrFinalize(threadId, pending, interaction, deps.store);
}
