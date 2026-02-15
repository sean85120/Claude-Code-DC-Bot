import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { randomUUID } from 'node:crypto';
import type { BotConfig, ScheduledPrompt, ScheduleType, Project } from '../types.js';
import { COLORS } from '../types.js';
import type { ScheduleStore } from '../effects/schedule-store.js';
import { canExecuteCommand, isAllowedCwd } from '../modules/permissions.js';
import { truncate } from '../modules/formatters.js';
import { computeNextRunAt } from '../handlers/schedule-runner.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Build the /schedule slash command definition
 */
export function buildScheduleCommand(projects: Project[]) {
  return new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Manage scheduled prompts')
    .addSubcommand((sub) => {
      const s = sub
        .setName('add')
        .setDescription('Add a scheduled prompt')
        .addStringOption((opt) =>
          opt.setName('name').setDescription('Schedule name').setRequired(true),
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
            .setName('type')
            .setDescription('Schedule type')
            .setRequired(true)
            .addChoices(
              { name: 'Daily', value: 'daily' },
              { name: 'Weekly', value: 'weekly' },
              { name: 'Once', value: 'once' },
            ),
        )
        .addStringOption((opt) =>
          opt.setName('time').setDescription('Time in HH:MM UTC (e.g. 09:00)').setRequired(true),
        )
        .addIntegerOption((opt) =>
          opt
            .setName('day')
            .setDescription('Day of week for weekly (0=Sun, 1=Mon, ..., 6=Sat)')
            .setMinValue(0)
            .setMaxValue(6),
        )
        .addStringOption((opt) =>
          opt.setName('date').setDescription('Date for once (YYYY-MM-DD)'),
        );
      return s;
    })
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('List all scheduled prompts'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a scheduled prompt')
        .addStringOption((opt) =>
          opt.setName('name').setDescription('Schedule name').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('toggle')
        .setDescription('Enable or disable a schedule')
        .addStringOption((opt) =>
          opt.setName('name').setDescription('Schedule name').setRequired(true),
        ),
    );
}

/**
 * Execute the /schedule command
 */
export async function execute(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  scheduleStore: ScheduleStore,
): Promise<void> {
  const auth = canExecuteCommand(interaction.user.id, config);
  if (!auth.allowed) {
    await interaction.reply({ content: `❌ ${auth.reason}`, flags: [MessageFlags.Ephemeral] });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'add':
      await handleAdd(interaction, config, scheduleStore);
      break;
    case 'list':
      await handleList(interaction, scheduleStore);
      break;
    case 'remove':
      await handleRemove(interaction, scheduleStore);
      break;
    case 'toggle':
      await handleToggle(interaction, scheduleStore);
      break;
  }
}

function validateTime(time: string): boolean {
  return /^\d{2}:\d{2}$/.test(time) &&
    parseInt(time.split(':')[0], 10) < 24 &&
    parseInt(time.split(':')[1], 10) < 60;
}

function validateDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(new Date(date).getTime());
}

async function handleAdd(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  scheduleStore: ScheduleStore,
): Promise<void> {
  const name = interaction.options.getString('name', true).trim();
  if (name.length === 0 || name.length > 100) {
    await interaction.reply({ content: '❌ Schedule name must be 1-100 characters', flags: [MessageFlags.Ephemeral] });
    return;
  }
  if (/[@#<>]/.test(name)) {
    await interaction.reply({ content: '❌ Schedule name cannot contain @, #, <, or >', flags: [MessageFlags.Ephemeral] });
    return;
  }

  const prompt = interaction.options.getString('prompt', true);
  const cwd = interaction.options.getString('cwd', true);
  const type = interaction.options.getString('type', true) as ScheduleType;
  const time = interaction.options.getString('time', true);
  const day = interaction.options.getInteger('day');
  const date = interaction.options.getString('date');

  if (!isAllowedCwd(cwd, config.projects)) {
    await interaction.reply({ content: '❌ Working directory is not in the allowed project list', flags: [MessageFlags.Ephemeral] });
    return;
  }

  if (!validateTime(time)) {
    await interaction.reply({ content: '❌ Invalid time format. Use HH:MM (e.g. 09:00)', flags: [MessageFlags.Ephemeral] });
    return;
  }

  if (type === 'weekly' && (day === null || day === undefined)) {
    await interaction.reply({ content: '❌ Weekly schedules require the `day` option (0=Sun, 1=Mon, ..., 6=Sat)', flags: [MessageFlags.Ephemeral] });
    return;
  }

  if (type === 'once' && (!date || !validateDate(date))) {
    await interaction.reply({ content: '❌ One-time schedules require a valid `date` option (YYYY-MM-DD)', flags: [MessageFlags.Ephemeral] });
    return;
  }

  if (scheduleStore.getByName(name)) {
    await interaction.reply({ content: `❌ A schedule named "${name}" already exists`, flags: [MessageFlags.Ephemeral] });
    return;
  }

  const schedule: ScheduledPrompt = {
    id: randomUUID(),
    name,
    promptText: prompt,
    cwd,
    channelId: interaction.channelId,
    createdBy: interaction.user.id,
    createdAt: new Date().toISOString(),
    enabled: true,
    scheduleType: type,
    time,
    dayOfWeek: type === 'weekly' ? (day ?? 0) : undefined,
    onceDate: type === 'once' ? date! : undefined,
  };

  schedule.nextRunAt = computeNextRunAt(schedule);

  scheduleStore.add(schedule);

  const scheduleDesc =
    type === 'daily' ? `Daily at ${time} UTC`
    : type === 'weekly' ? `Weekly on ${DAY_NAMES[day ?? 0]} at ${time} UTC`
    : `Once on ${date} at ${time} UTC`;

  await interaction.reply({
    embeds: [{
      title: '⏰ Schedule Created',
      description: `**${name}**\n${truncate(prompt, 200)}`,
      fields: [
        { name: 'Schedule', value: scheduleDesc, inline: true },
        { name: 'Working Directory', value: `\`${cwd}\``, inline: true },
        ...(schedule.nextRunAt ? [{ name: 'Next Run', value: `<t:${Math.floor(new Date(schedule.nextRunAt).getTime() / 1000)}:R>`, inline: true }] : []),
      ],
      color: COLORS.PostToolUse,
    }],
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleList(
  interaction: ChatInputCommandInteraction,
  scheduleStore: ScheduleStore,
): Promise<void> {
  const schedules = scheduleStore.list();

  if (schedules.length === 0) {
    await interaction.reply({ content: 'No scheduled prompts. Use `/schedule add` to create one.', flags: [MessageFlags.Ephemeral] });
    return;
  }

  const lines = schedules.map((s) => {
    const status = s.enabled ? '🟢' : '🔴';
    const schedDesc =
      s.scheduleType === 'daily' ? `Daily ${s.time}`
      : s.scheduleType === 'weekly' ? `${DAY_NAMES[s.dayOfWeek ?? 0]} ${s.time}`
      : `${s.onceDate} ${s.time}`;
    const nextRun = s.nextRunAt ? ` • Next: <t:${Math.floor(new Date(s.nextRunAt).getTime() / 1000)}:R>` : '';
    return `${status} **${s.name}** — ${schedDesc} UTC${nextRun}\n  ${truncate(s.promptText, 60)}`;
  });

  await interaction.reply({
    embeds: [{
      title: `⏰ Schedules (${schedules.length})`,
      description: lines.join('\n\n'),
      color: COLORS.PreToolUse,
    }],
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleRemove(
  interaction: ChatInputCommandInteraction,
  scheduleStore: ScheduleStore,
): Promise<void> {
  const name = interaction.options.getString('name', true);
  const removed = scheduleStore.remove(name);

  if (!removed) {
    await interaction.reply({ content: `❌ Schedule "${name}" not found`, flags: [MessageFlags.Ephemeral] });
    return;
  }

  await interaction.reply({
    embeds: [{
      title: '🗑️ Schedule Removed',
      description: `Schedule **${name}** has been removed`,
      color: COLORS.Error,
    }],
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleToggle(
  interaction: ChatInputCommandInteraction,
  scheduleStore: ScheduleStore,
): Promise<void> {
  const name = interaction.options.getString('name', true);
  const newState = scheduleStore.toggle(name);

  if (newState === null) {
    await interaction.reply({ content: `❌ Schedule "${name}" not found`, flags: [MessageFlags.Ephemeral] });
    return;
  }

  await interaction.reply({
    embeds: [{
      title: newState ? '🟢 Schedule Enabled' : '🔴 Schedule Disabled',
      description: `Schedule **${name}** is now ${newState ? 'enabled' : 'disabled'}`,
      color: newState ? COLORS.PostToolUse : COLORS.Error,
    }],
    flags: [MessageFlags.Ephemeral],
  });
}
