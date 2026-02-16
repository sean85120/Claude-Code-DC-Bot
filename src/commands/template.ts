import {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
} from 'discord.js';
import type { BotConfig, SessionState, Project } from '../types.js';
import { COLORS } from '../types.js';
import type { StateStore } from '../effects/state-store.js';
import type { TemplateStore } from '../effects/template-store.js';
import type { QueueStore } from '../effects/queue-store.js';
import type { BudgetStore } from '../effects/budget-store.js';
import { canExecuteCommand, isAllowedCwd, checkChannelRepoRestriction } from '../modules/permissions.js';
import { getChannelName } from '../modules/channel-utils.js';
import { truncate } from '../modules/formatters.js';
import { buildSessionStartEmbed, buildErrorEmbed } from '../modules/embeds.js';
import {
  deferReply,
  editReply,
  createThread,
  sendInThread,
} from '../effects/discord-sender.js';
import { resolveProjectChannel } from '../effects/channel-manager.js';
import { logger } from '../effects/logger.js';

const log = logger.child({ module: 'Template' });

/**
 * Build the /template slash command definition
 */
export function buildTemplateCommand(projects: Project[]) {
  const builder = new SlashCommandBuilder()
    .setName('template')
    .setDescription('Manage prompt templates')
    .addSubcommand((sub) =>
      sub
        .setName('save')
        .setDescription('Save a prompt template')
        .addStringOption((opt) =>
          opt.setName('name').setDescription('Template name').setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName('prompt').setDescription('Prompt text').setRequired(true),
        )
        .addStringOption((opt) => {
          opt.setName('cwd').setDescription('Working directory').setRequired(true);
          for (const p of projects.slice(0, 25)) {
            opt.addChoices({ name: `${p.name} — ${p.path}`, value: p.path });
          }
          return opt;
        })
        .addStringOption((opt) =>
          opt
            .setName('model')
            .setDescription('Model (optional)')
            .addChoices(
              { name: 'Claude Opus 4.6', value: 'claude-opus-4-6' },
              { name: 'Claude Sonnet 4.5', value: 'claude-sonnet-4-5-20250929' },
              { name: 'Claude Haiku 4.5', value: 'claude-haiku-4-5-20251001' },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('List all saved templates'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('run')
        .setDescription('Run a saved template')
        .addStringOption((opt) =>
          opt.setName('name').setDescription('Template name').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Delete a template')
        .addStringOption((opt) =>
          opt.setName('name').setDescription('Template name').setRequired(true),
        ),
    );
  return builder;
}

/**
 * Execute the /template command
 */
export async function execute(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  store: StateStore,
  templateStore: TemplateStore,
  startClaudeQuery: (session: SessionState, threadId: string) => Promise<void>,
  client?: Client,
  queueStore?: QueueStore,
  budgetStore?: BudgetStore,
): Promise<void> {
  const auth = canExecuteCommand(interaction.user.id, config);
  if (!auth.allowed) {
    await interaction.reply({ content: `❌ ${auth.reason}`, flags: [MessageFlags.Ephemeral] });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'save':
      await handleSave(interaction, config, templateStore);
      break;
    case 'list':
      await handleList(interaction, templateStore);
      break;
    case 'run':
      await handleRun(interaction, config, store, templateStore, startClaudeQuery, client, queueStore, budgetStore);
      break;
    case 'delete':
      await handleDelete(interaction, templateStore);
      break;
  }
}

async function handleSave(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  templateStore: TemplateStore,
): Promise<void> {
  const name = interaction.options.getString('name', true).trim();
  if (name.length === 0 || name.length > 100) {
    await interaction.reply({ content: '❌ Template name must be 1-100 characters', flags: [MessageFlags.Ephemeral] });
    return;
  }
  if (/[@#<>]/.test(name)) {
    await interaction.reply({ content: '❌ Template name cannot contain @, #, <, or >', flags: [MessageFlags.Ephemeral] });
    return;
  }

  const prompt = interaction.options.getString('prompt', true);
  const cwd = interaction.options.getString('cwd', true);
  const model = interaction.options.getString('model') || undefined;

  if (!isAllowedCwd(cwd, config.projects)) {
    await interaction.reply({ content: '❌ Working directory is not in the allowed project list', flags: [MessageFlags.Ephemeral] });
    return;
  }

  templateStore.save({
    name,
    promptText: prompt,
    cwd,
    model,
    createdBy: interaction.user.id,
    createdAt: new Date().toISOString(),
  });

  await interaction.reply({
    embeds: [{
      title: '📋 Template Saved',
      description: `**${name}**\n${truncate(prompt, 200)}`,
      fields: [
        { name: 'Working Directory', value: `\`${cwd}\``, inline: true },
        ...(model ? [{ name: 'Model', value: model, inline: true }] : []),
      ],
      color: COLORS.PostToolUse,
    }],
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleList(
  interaction: ChatInputCommandInteraction,
  templateStore: TemplateStore,
): Promise<void> {
  const templates = templateStore.list();

  if (templates.length === 0) {
    await interaction.reply({
      content: 'No templates saved. Use `/template save` to create one.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const lines = templates.map((t) =>
    `**${t.name}** — ${truncate(t.promptText, 60)}\n  \`${t.cwd}\`${t.model ? ` • ${t.model}` : ''} • by <@${t.createdBy}>`,
  );

  await interaction.reply({
    embeds: [{
      title: `📋 Templates (${templates.length})`,
      description: lines.join('\n\n'),
      color: COLORS.PreToolUse,
    }],
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleRun(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  store: StateStore,
  templateStore: TemplateStore,
  startClaudeQuery: (session: SessionState, threadId: string) => Promise<void>,
  client?: Client,
  _queueStore?: QueueStore,
  budgetStore?: BudgetStore,
): Promise<void> {
  const name = interaction.options.getString('name', true);
  const template = templateStore.get(name);

  if (!template) {
    await interaction.reply({
      content: `❌ Template "${name}" not found. Use \`/template list\` to see available templates.`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (!isAllowedCwd(template.cwd, config.projects)) {
    await interaction.reply({
      content: '❌ Template working directory is no longer in the allowed project list',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Channel-repo restriction: project channels can only run their own repo
  if (interaction.channelId !== config.discordChannelId) {
    const channelName = getChannelName(interaction.channel);
    if (channelName) {
      const restriction = checkChannelRepoRestriction(channelName, template.cwd, config.projects);
      if (!restriction.allowed) {
        await interaction.reply({ content: `❌ ${restriction.reason}`, flags: [MessageFlags.Ephemeral] });
        return;
      }
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

  await deferReply(interaction);

  const model = template.model || config.defaultModel;
  const message = template.promptText;
  const cwd = template.cwd;

  // Resolve target channel
  let targetChannel: import('discord.js').TextChannel;

  if (client) {
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
    } catch (error) {
      await editReply(interaction, {
        content: `❌ Unable to resolve project channel: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }
  } else {
    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) {
      await editReply(interaction, { content: '❌ This command can only be used in a text channel' });
      return;
    }
    targetChannel = channel as import('discord.js').TextChannel;
  }

  const threadName = `Template: ${truncate(name, 30)}`;
  const thread = await createThread(targetChannel, threadName);

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
    transcript: [{ timestamp: new Date(), type: 'user', content: message.slice(0, 2000) }],
  };

  store.setSession(thread.id, session);

  const startEmbed = buildSessionStartEmbed(message, cwd, model);
  await sendInThread(thread, startEmbed);

  await editReply(interaction, {
    content: `🚀 Template "${name}" started → <#${thread.id}>`,
  });

  startClaudeQuery(session, thread.id).catch(async (error) => {
    log.error({ err: error, threadId: thread.id, template: name }, 'Template query error');
    const errorEmbed = buildErrorEmbed(error instanceof Error ? error.message : String(error));
    try {
      await sendInThread(thread, errorEmbed);
    } catch {
      // Thread may no longer exist
    }
    store.clearSession(thread.id);
  });
}

async function handleDelete(
  interaction: ChatInputCommandInteraction,
  templateStore: TemplateStore,
): Promise<void> {
  const name = interaction.options.getString('name', true);
  const deleted = templateStore.delete(name);

  if (!deleted) {
    await interaction.reply({
      content: `❌ Template "${name}" not found`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  await interaction.reply({
    embeds: [{
      title: '🗑️ Template Deleted',
      description: `Template **${name}** has been removed`,
      color: COLORS.Error,
    }],
    flags: [MessageFlags.Ephemeral],
  });
}
