import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { BotConfig, SessionState } from '../types.js';
import type { StateStore } from '../effects/state-store.js';
import { logger } from '../effects/logger.js';
import { canExecuteCommand } from '../modules/permissions.js';
import { truncate } from '../modules/formatters.js';

const log = logger.child({ module: 'Retry' });
import { resolveThreadId } from '../modules/session-resolver.js';
import { buildRetryEmbed } from '../modules/embeds.js';
import { deferReply, editReply, sendInThread } from '../effects/discord-sender.js';

/** /retry command definition: re-execute the last prompt in the thread */
export const data = new SlashCommandBuilder()
  .setName('retry')
  .setDescription('Re-execute the last prompt in the current thread');

/**
 * Executes the /retry command: aborts the existing session and re-executes with the same prompt
 * @param interaction - Discord command interaction object
 * @param config - Bot configuration
 * @param store - Session state store
 * @param startClaudeQuery - Callback function to start a Claude query
 * @returns void
 */
export async function execute(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  store: StateStore,
  startClaudeQuery: (session: SessionState, threadId: string) => Promise<void>,
): Promise<void> {
  const auth = canExecuteCommand(interaction.user.id, config);
  if (!auth.allowed) {
    await interaction.reply({ content: `❌ ${auth.reason}`, flags: [MessageFlags.Ephemeral] });
    return;
  }

  const threadId = resolveThreadId(interaction, store);
  if (!threadId) {
    await interaction.reply({ content: '⚠️ Please use this command within a session thread', flags: [MessageFlags.Ephemeral] });
    return;
  }

  const session = store.getSession(threadId);
  if (!session) {
    await interaction.reply({ content: '⚠️ No retryable session found', flags: [MessageFlags.Ephemeral] });
    return;
  }

  // Only allow retry when not currently running
  if (session.status === 'running' || session.status === 'awaiting_permission') {
    await interaction.reply({ content: '⚠️ Task is still running, cannot retry', flags: [MessageFlags.Ephemeral] });
    return;
  }

  await deferReply(interaction);

  // Abort existing session (if not already aborted)
  if (!session.abortController.signal.aborted) {
    session.abortController.abort();
  }

  // Create new session (no resume, re-execute from scratch)
  const newAbortController = new AbortController();
  const newSession: SessionState = {
    sessionId: null,
    status: 'running',
    threadId,
    userId: session.userId,
    startedAt: new Date(),
    lastActivityAt: new Date(),
    promptText: session.promptText,
    cwd: session.cwd,
    model: session.model,
    toolCount: 0,
    tools: {},
    pendingApproval: null,
    abortController: newAbortController,
    transcript: [],
    allowedTools: new Set(),
  };

  store.setSession(threadId, newSession);

  // Send retry embed
  const channel = interaction.channel;
  if (channel?.isThread()) {
    const retryEmbed = buildRetryEmbed(session.promptText);
    await sendInThread(channel, retryEmbed);
  }

  await editReply(interaction, { content: '🔄 Re-executing...' });

  // Start new query
  startClaudeQuery(newSession, threadId).catch(async (error) => {
    log.error({ err: error, threadId, prompt: truncate(session.promptText, 40) }, 'Query error');
    store.updateSession(threadId, { status: 'error' });
  });
}
