import {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
} from 'discord.js';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BotConfig, Project } from '../types.js';
import { canExecuteCommand } from '../modules/permissions.js';
import { normalizeChannelName } from '../modules/channel-utils.js';
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
    })
    .addSubcommand((sub) => {
      sub
        .setName('rename')
        .setDescription('Rename a project')
        .addStringOption((opt) => {
          opt
            .setName('name')
            .setDescription('Current project name')
            .setRequired(true);
          for (const p of projects.slice(0, 25)) {
            opt.addChoices({ name: p.name, value: p.name });
          }
          return opt;
        })
        .addStringOption((opt) =>
          opt
            .setName('new-name')
            .setDescription('New project name')
            .setRequired(true),
        );
      return sub;
    });
}

/**
 * Execute the /repos command
 */
export async function execute(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  client?: Client,
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
    case 'rename':
      await handleRename(interaction, config, client);
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

  // Verify the path exists on disk
  if (!existsSync(path)) {
    await interaction.reply({
      content: `❌ Path \`${path}\` does not exist`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Verify the path is a git repository
  if (!existsSync(resolve(path, '.git'))) {
    await interaction.reply({
      content: `❌ Path \`${path}\` is not a git repository (no \`.git\` folder found)`,
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

/** Escape Discord markdown/mention special patterns in user-supplied text */
function escapeDiscordMarkdown(text: string): string {
  return text
    .replace(/@everyone/g, '@\u200Beveryone')
    .replace(/@here/g, '@\u200Bhere');
}

async function handleRename(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  client?: Client,
): Promise<void> {
  const name = interaction.options.getString('name', true);
  const newName = interaction.options.getString('new-name', true).trim();

  // Validate new name: length and must produce a valid channel name
  if (newName.length === 0 || newName.length > 100) {
    await interaction.reply({
      content: '❌ New project name must be 1-100 characters',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Ensure the name produces a valid normalized channel name (not empty after sanitization)
  if (!normalizeChannelName(newName)) {
    await interaction.reply({
      content: '❌ Project name must contain at least one alphanumeric character',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Find existing project
  const project = config.projects.find((p) => p.name === name);
  if (!project) {
    await interaction.reply({
      content: `❌ No project named "${escapeDiscordMarkdown(name)}" found`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Check for name conflict
  if (config.projects.some((p) => p.name === newName)) {
    await interaction.reply({
      content: `❌ A project named "${escapeDiscordMarkdown(newName)}" already exists`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const oldName = project.name;

  // Write to disk first, then mutate in-memory (rollback-safe)
  const updatedProjects = config.projects.map((p) =>
    p.name === oldName ? { ...p, name: newName } : p,
  );
  writeProjectsFile(updatedProjects);

  // Commit in-memory change after successful disk write
  project.name = newName;

  // Re-register commands so dropdowns update
  try {
    await deployCommands(
      config.discordToken,
      config.discordClientId,
      config.discordGuildId,
      config.projects,
    );
  } catch (err) {
    log.warn({ err }, 'Failed to re-register commands after renaming project');
  }

  // Auto-rename Discord channel if client is available
  let channelRenamed = false;
  if (client) {
    try {
      const guild = await client.guilds.fetch(config.discordGuildId);
      const allChannels = await guild.channels.fetch();
      const oldNormalized = normalizeChannelName(oldName);
      if (oldNormalized) {
        const channel = allChannels.find(
          (ch) => ch !== null && ch.type === ChannelType.GuildText && ch.name === oldNormalized,
        );
        if (channel) {
          const newNormalized = normalizeChannelName(newName);
          if (newNormalized) {
            await channel.setName(newNormalized);
            channelRenamed = true;
          }
        }
      }
    } catch (err) {
      log.warn({ err, oldName, newName }, 'Failed to rename Discord channel');
    }
  }

  log.info({ oldName, newName, channelRenamed }, 'Project renamed');

  const escapedOld = escapeDiscordMarkdown(oldName);
  const escapedNew = escapeDiscordMarkdown(newName);
  const descriptionLines = [`**${escapedOld}** → **${escapedNew}**`];
  if (channelRenamed) {
    descriptionLines.push('Discord channel renamed automatically.');
  }

  await interaction.editReply({
    embeds: [
      {
        title: 'Project Renamed',
        description: descriptionLines.join('\n'),
        color: 0x7289da,
      },
    ],
  });
}

function writeProjectsFile(projects: Project[]): void {
  const filePath = resolve(process.cwd(), 'projects.json');
  writeFileSync(filePath, JSON.stringify(projects, null, 2) + '\n', 'utf-8');
}
