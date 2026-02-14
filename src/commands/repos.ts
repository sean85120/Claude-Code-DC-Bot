import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BotConfig, Project } from '../types.js';
import { canExecuteCommand } from '../modules/permissions.js';
import { deployCommands } from '../effects/command-deployer.js';
import { logger } from '../effects/logger.js';

const log = logger.child({ module: 'Repos' });

/**
 * Build the /repos slash command definition
 * @param projects - Current project list (used for remove choices)
 */
export function buildReposCommand(projects: Project[]) {
  return new SlashCommandBuilder()
    .setName('repos')
    .setDescription('Manage the project repository list')
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('List all registered projects'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a new project')
        .addStringOption((opt) =>
          opt
            .setName('name')
            .setDescription('Project display name')
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('path')
            .setDescription('Absolute path to the project directory')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) => {
      sub
        .setName('remove')
        .setDescription('Remove a project')
        .addStringOption((opt) => {
          opt
            .setName('name')
            .setDescription('Project name to remove')
            .setRequired(true);
          for (const p of projects.slice(0, 25)) {
            opt.addChoices({ name: p.name, value: p.name });
          }
          return opt;
        });
      return sub;
    });
}

/**
 * Execute the /repos command
 */
export async function execute(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
): Promise<void> {
  const auth = canExecuteCommand(interaction.user.id, config);
  if (!auth.allowed) {
    await interaction.reply({
      content: `❌ ${auth.reason}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'list':
      await handleList(interaction, config);
      break;
    case 'add':
      await handleAdd(interaction, config);
      break;
    case 'remove':
      await handleRemove(interaction, config);
      break;
  }
}

async function handleList(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
): Promise<void> {
  if (config.projects.length === 0) {
    await interaction.reply({
      content: 'No projects registered.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const lines = config.projects.map(
    (p, i) => `**${i + 1}.** ${p.name} — \`${p.path}\``,
  );

  await interaction.reply({
    embeds: [
      {
        title: 'Registered Projects',
        description: lines.join('\n'),
        color: 0x7289da,
      },
    ],
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleAdd(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
): Promise<void> {
  const name = interaction.options.getString('name', true);
  const path = interaction.options.getString('path', true);

  // Check for duplicate name
  if (config.projects.some((p) => p.name === name)) {
    await interaction.reply({
      content: `❌ A project named "${name}" already exists`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Check for duplicate path
  if (config.projects.some((p) => p.path === path)) {
    await interaction.reply({
      content: `❌ A project with path \`${path}\` already exists`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  // Add to in-memory config
  config.projects.push({ name, path });

  // Write to disk
  writeProjectsFile(config.projects);

  // Re-register commands so /prompt cwd dropdown updates
  try {
    await deployCommands(
      config.discordToken,
      config.discordClientId,
      config.discordGuildId,
      config.projects,
    );
  } catch (err) {
    log.warn({ err }, 'Failed to re-register commands after adding project');
  }

  log.info({ name, path }, 'Project added');

  await interaction.editReply({
    embeds: [
      {
        title: 'Project Added',
        description: `**${name}** — \`${path}\``,
        color: 0x43b581,
      },
    ],
  });
}

async function handleRemove(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
): Promise<void> {
  const name = interaction.options.getString('name', true);

  const index = config.projects.findIndex((p) => p.name === name);
  if (index === -1) {
    await interaction.reply({
      content: `❌ No project named "${name}" found`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const removed = config.projects.splice(index, 1)[0];

  // Write to disk
  writeProjectsFile(config.projects);

  // Re-register commands
  try {
    await deployCommands(
      config.discordToken,
      config.discordClientId,
      config.discordGuildId,
      config.projects,
    );
  } catch (err) {
    log.warn({ err }, 'Failed to re-register commands after removing project');
  }

  log.info({ name: removed.name, path: removed.path }, 'Project removed');

  await interaction.editReply({
    embeds: [
      {
        title: 'Project Removed',
        description: `**${removed.name}** — \`${removed.path}\``,
        color: 0xf04747,
      },
    ],
  });
}

function writeProjectsFile(projects: Project[]): void {
  const filePath = resolve(process.cwd(), 'projects.json');
  writeFileSync(filePath, JSON.stringify(projects, null, 2) + '\n', 'utf-8');
}
