import {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  type ChatInputCommandInteraction,
  type TextChannel,
  type Client,
} from 'discord.js';
import { randomUUID } from 'node:crypto';
import type { BotConfig, SessionState, Project, QueueEntry } from '../types.js';
import type { StateStore } from '../effects/state-store.js';
import type { RateLimitStore } from '../effects/rate-limit-store.js';
import type { QueueStore } from '../effects/queue-store.js';
import type { BudgetStore } from '../effects/budget-store.js';
import { logger } from '../effects/logger.js';
import { canExecuteCommand, isAllowedCwd, checkChannelRepoRestriction, getProjectFromChannel } from '../modules/permissions.js';
import { getChannelName } from '../modules/channel-utils.js';

const log = logger.child({ module: 'Claude' });
import { buildSessionStartEmbed, buildErrorEmbed, buildQueuedEmbed } from '../modules/embeds.js';
import { truncate } from '../modules/formatters.js';
import { checkRateLimit, recordRequest } from '../modules/rate-limiter.js';
import {
  deferReply,
  editReply,
  createThread,
  sendInThread,
} from '../effects/discord-sender.js';
import { resolveProjectChannel } from '../effects/channel-manager.js';

/**
 * Dynamically builds the /prompt slash command definition based on the project list
 * @param projects - The list of allowed projects to choose from
 * @returns A SlashCommandBuilder with message, cwd, and model options
 */
export function buildPromptCommand(projects: Project[]) {
  const builder = new SlashCommandBuilder()
    .setName('prompt')
    .setDescription('Send a prompt to Claude Code')
    .addStringOption((opt) =>
      opt.setName('message').setDescription('Prompt content').setRequired(true),
    )
    .addStringOption((opt) => {
      opt.setName('repo').setDescription('Target repository (auto-detected in project channels)');
      for (const p of projects.slice(0, 25)) {
        opt.addChoices({ name: `${p.name} — ${p.path}`, value: p.path });
      }
      return opt;
    })
    .addStringOption((opt) =>
      opt
        .setName('model')
        .setDescription('Model name (optional)')
        .addChoices(
          { name: 'Claude Opus 4.6', value: 'claude-opus-4-6' },
          { name: 'Claude Sonnet 4.5', value: 'claude-sonnet-4-5-20250929' },
          { name: 'Claude Haiku 4.5', value: 'claude-haiku-4-5-20251001' },
        ),
    );
  return builder;
}

/**
 * Executes the /prompt command: validates permissions and rate limits, resolves the target channel, creates a thread, and starts a Claude query
 * @param interaction - Discord command interaction object
 * @param config - Bot configuration
 * @param store - Session state store
 * @param startClaudeQuery - Callback function to start a Claude query
 * @param rateLimitStore - Rate limit store (optional)
 * @param client - Discord client (optional, enables channel-per-repo routing)
 * @param queueStore - Queue store (optional, enables per-project queuing)
 * @returns void
 */
export async function execute(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  store: StateStore,
  startClaudeQuery: (session: SessionState, threadId: string) => Promise<void>,
  rateLimitStore?: RateLimitStore,
  client?: Client,
  queueStore?: QueueStore,
  budgetStore?: BudgetStore,
): Promise<void> {
  const auth = canExecuteCommand(interaction.user.id, config);
  if (!auth.allowed) {
    await interaction.reply({ content: `❌ ${auth.reason}`, flags: [MessageFlags.Ephemeral] });
    return;
  }

  // Rate limit check
  if (rateLimitStore) {
    const rateLimitResult = checkRateLimit(
      rateLimitStore.getEntry(interaction.user.id),
      { windowMs: config.rateLimitWindowMs, maxRequests: config.rateLimitMaxRequests },
      Date.now(),
    );
    if (!rateLimitResult.allowed) {
      const waitSec = Math.ceil((rateLimitResult.retryAfterMs ?? 0) / 1000);
      await interaction.reply({
        content: `⚠️ Too many requests, please try again in ${waitSec} seconds`,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
  }

  // Budget check
  if (budgetStore) {
    const budgetResult = budgetStore.checkBudget(config);
    if (budgetResult) {
      await interaction.reply({
        content: `🚫 **${budgetResult.period}** budget exceeded — $${budgetResult.spent.toFixed(2)} / $${budgetResult.limit.toFixed(2)}. Use \`/budget view\` for details.`,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
  }

  const message = interaction.options.getString('message', true);
  let cwd = interaction.options.getString('repo');
  const model = interaction.options.getString('model') || config.defaultModel;
  const channelName = getChannelName(interaction.channel);
  const repoWasAutoDetected = !cwd;

  // Auto-detect repo from project channel if not explicitly provided
  if (!cwd) {
    if (channelName) {
      const project = getProjectFromChannel(channelName, config.projects);
      if (project) {
        cwd = project.path;
      }
    }
    if (!cwd) {
      await interaction.reply({
        content: '❌ Please specify a repo or run this command in a project channel',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
  }

  if (!isAllowedCwd(cwd, config.projects)) {
    await interaction.reply({ content: '❌ Working directory is not in the allowed project list', flags: [MessageFlags.Ephemeral] });
    return;
  }

  // Channel-repo restriction: project channels can only run their own repo
  // Skip when auto-detected (already matched channel → project) or in the general channel
  if (!repoWasAutoDetected && interaction.channelId !== config.discordChannelId && channelName) {
    const restriction = checkChannelRepoRestriction(channelName, cwd, config.projects);
    if (!restriction.allowed) {
      await interaction.reply({ content: `❌ ${restriction.reason}`, flags: [MessageFlags.Ephemeral] });
      return;
    }
  }

  await deferReply(interaction);

  // Record rate limit
  if (rateLimitStore) {
    rateLimitStore.setEntry(
      interaction.user.id,
      recordRequest(
        rateLimitStore.getEntry(interaction.user.id),
        Date.now(),
        config.rateLimitWindowMs,
      ),
    );
  }

  // Resolve target channel for this project
  let targetChannel: TextChannel;
  let channelCreated = false;

  if (client) {
    // Channel-per-repo routing: resolve or create the project-specific channel
    const selectedProject = config.projects.find((p) => p.path === cwd);
    const isBotRepo = cwd === config.botRepoPath;

    try {
      const result = await resolveProjectChannel(
        client,
        config.discordGuildId,
        config.discordChannelId,
        selectedProject?.name ?? 'unknown',
        isBotRepo,
      );
      targetChannel = result.channel;
      channelCreated = result.created;
    } catch (error) {
      await editReply(interaction, {
        content: `❌ Unable to resolve project channel: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }
  } else {
    // Fallback: use the channel where the command was invoked (backward compat / tests)
    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) {
      await editReply(interaction, { content: '❌ This command can only be used in a text channel' });
      return;
    }
    targetChannel = channel as TextChannel;
  }

  const threadName = `Session: ${truncate(message, 30)}`;
  const thread = await createThread(targetChannel, threadName);

  // Create session
  const abortController = new AbortController();
  const session: SessionState = {
    sessionId: null,
    status: 'running',
    threadId: thread.id,
    userId: interaction.user.id,
    startedAt: new Date(),
    lastActivityAt: new Date(),
    promptText: message,
    cwd,
    model,
    toolCount: 0,
    tools: {},
    pendingApproval: null,
    abortController,
    transcript: [],
  };

  // Record initial user message to transcript
  session.transcript.push({
    timestamp: new Date(),
    type: 'user',
    content: message.slice(0, 2000),
  });

  // Check if project is busy — if so, enqueue instead of starting immediately
  if (queueStore && queueStore.isProjectBusy(cwd, store)) {
    session.status = 'queued';
    store.setSession(thread.id, session);

    const entry: QueueEntry = {
      id: randomUUID(),
      userId: interaction.user.id,
      promptText: message,
      cwd,
      model,
      threadId: thread.id,
      queuedAt: new Date(),
    };
    const position = queueStore.enqueue(cwd, entry);

    log.info({ threadId: thread.id, position, cwd, prompt: truncate(message, 40) }, 'Session queued');

    const queueEmbed = buildQueuedEmbed(position, message, cwd);
    await sendInThread(thread, queueEmbed);

    await editReply(interaction, {
      content: channelCreated
        ? `📋 Queued at position #${position} in <#${targetChannel.id}> → <#${thread.id}>`
        : `📋 Queued at position #${position} → <#${thread.id}>`,
    });
    return;
  }

  // Not queued — start immediately
  session.status = 'running';
  store.setSession(thread.id, session);

  // Send start embed to thread
  const startEmbed = buildSessionStartEmbed(message, cwd, model);
  await sendInThread(thread, startEmbed);

  await editReply(interaction, {
    content: channelCreated
      ? `🚀 Task started in newly created <#${targetChannel.id}> → <#${thread.id}>`
      : `🚀 Task started → <#${thread.id}>`,
  });

  // Start Claude query (async, do not await)
  startClaudeQuery(session, thread.id).catch(async (error) => {
    log.error({ err: error, threadId: thread.id, prompt: truncate(message, 40) }, 'Query error');
    const errorEmbed = buildErrorEmbed(
      error instanceof Error ? error.message : String(error),
    );
    try {
      await sendInThread(thread, errorEmbed);
    } catch {
      // Thread may no longer exist
    }
    store.clearSession(thread.id);
  });
}
