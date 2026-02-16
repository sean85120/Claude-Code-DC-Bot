import { REST, Routes } from 'discord.js';
import type { Project } from '../types.js';
import { buildPromptCommand } from '../commands/prompt.js';
import { data as stopData } from '../commands/stop.js';
import { data as statusData } from '../commands/status.js';
import { data as historyData } from '../commands/history.js';
import { data as retryData } from '../commands/retry.js';
import { buildSettingsCommand } from '../commands/settings.js';
import { buildReposCommand } from '../commands/repos.js';
import { data as summaryData } from '../commands/summary.js';
import { buildBudgetCommand } from '../commands/budget.js';
import { buildTemplateCommand } from '../commands/template.js';
import { buildScheduleCommand } from '../commands/schedule.js';
import { data as logsData } from '../commands/logs.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'Deploy' });

/**
 * Build the full array of slash command JSON payloads
 * @param projects - Current project list (used for /prompt cwd choices)
 * @returns Array of command JSON objects
 */
export function buildCommandArray(projects: Project[]) {
  return [
    buildPromptCommand(projects).toJSON(),
    stopData.toJSON(),
    statusData.toJSON(),
    historyData.toJSON(),
    retryData.toJSON(),
    buildSettingsCommand().toJSON(),
    buildReposCommand(projects).toJSON(),
    summaryData.toJSON(),
    buildBudgetCommand().toJSON(),
    buildTemplateCommand(projects).toJSON(),
    buildScheduleCommand(projects).toJSON(),
    logsData.toJSON(),
  ];
}

/**
 * Register all slash commands with Discord via the REST API
 * @param token - Discord bot token
 * @param clientId - Discord application client ID
 * @param guildId - Discord guild ID
 * @param projects - Current project list
 */
export async function deployCommands(
  token: string,
  clientId: string,
  guildId: string,
  projects: Project[],
): Promise<void> {
  const commands = buildCommandArray(projects);
  const rest = new REST({ version: '10' }).setToken(token);

  log.info(`Registering ${commands.length} commands...`);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: commands,
  });
  log.info('Command registration complete');
}
