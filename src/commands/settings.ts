import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BotConfig, PermissionMode } from '../types.js';
import { canExecuteCommand } from '../modules/permissions.js';
import { logger } from '../effects/logger.js';

const log = logger.child({ module: 'Settings' });

const VALID_PERMISSION_MODES: PermissionMode[] = [
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
];

/** Keys that can be edited via /settings update */
const EDITABLE_KEYS = [
  'DEFAULT_MODEL',
  'DEFAULT_CWD',
  'DEFAULT_PERMISSION_MODE',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_MAX_REQUESTS',
] as const;

type EditableKey = (typeof EDITABLE_KEYS)[number];

/** Map from env key to BotConfig field */
const KEY_TO_CONFIG: Record<EditableKey, keyof BotConfig> = {
  DEFAULT_MODEL: 'defaultModel',
  DEFAULT_CWD: 'defaultCwd',
  DEFAULT_PERMISSION_MODE: 'defaultPermissionMode',
  RATE_LIMIT_WINDOW_MS: 'rateLimitWindowMs',
  RATE_LIMIT_MAX_REQUESTS: 'rateLimitMaxRequests',
};

/**
 * Build the /settings slash command definition
 */
export function buildSettingsCommand() {
  return new SlashCommandBuilder()
    .setName('settings')
    .setDescription('View or update bot settings')
    .addSubcommand((sub) =>
      sub.setName('view').setDescription('View current bot settings'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('update')
        .setDescription('Update a bot setting')
        .addStringOption((opt) =>
          opt
            .setName('key')
            .setDescription('Setting key to update')
            .setRequired(true)
            .addChoices(
              ...EDITABLE_KEYS.map((k) => ({ name: k, value: k })),
            ),
        )
        .addStringOption((opt) =>
          opt
            .setName('value')
            .setDescription('New value for the setting')
            .setRequired(true),
        ),
    );
}

/**
 * Execute the /settings command
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

  if (subcommand === 'view') {
    await handleView(interaction, config);
  } else if (subcommand === 'update') {
    await handleUpdate(interaction, config);
  }
}

async function handleView(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
): Promise<void> {
  const lines = [
    `**DEFAULT_MODEL** — \`${config.defaultModel}\``,
    `**DEFAULT_CWD** — \`${config.defaultCwd}\``,
    `**DEFAULT_PERMISSION_MODE** — \`${config.defaultPermissionMode}\``,
    `**RATE_LIMIT_WINDOW_MS** — \`${config.rateLimitWindowMs}\``,
    `**RATE_LIMIT_MAX_REQUESTS** — \`${config.rateLimitMaxRequests}\``,
  ];

  await interaction.reply({
    embeds: [
      {
        title: 'Bot Settings',
        description: lines.join('\n'),
        color: 0x7289da,
      },
    ],
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleUpdate(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
): Promise<void> {
  const key = interaction.options.getString('key', true) as EditableKey;
  const value = interaction.options.getString('value', true);
  const configField = KEY_TO_CONFIG[key];

  // Validate value
  const validationError = validateValue(key, value, config);
  if (validationError) {
    await interaction.reply({
      content: `❌ ${validationError}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Get old value
  const oldValue = String(config[configField]);

  // Mutate in-memory config
  const typedConfig = config as unknown as Record<string, unknown>;
  if (key === 'RATE_LIMIT_WINDOW_MS' || key === 'RATE_LIMIT_MAX_REQUESTS') {
    typedConfig[configField] = parseInt(value, 10);
  } else {
    typedConfig[configField] = value;
  }

  // Update .env file on disk
  try {
    updateEnvFile(key, value);
  } catch (err) {
    log.warn({ err, key }, 'Failed to update .env file');
  }

  log.info({ key, oldValue, newValue: value }, 'Setting updated');

  await interaction.reply({
    embeds: [
      {
        title: 'Setting Updated',
        description: `**${key}**\n\`${oldValue}\` → \`${value}\``,
        color: 0x43b581,
      },
    ],
    flags: [MessageFlags.Ephemeral],
  });
}

function validateValue(
  key: EditableKey,
  value: string,
  config: BotConfig,
): string | null {
  switch (key) {
    case 'DEFAULT_PERMISSION_MODE':
      if (!VALID_PERMISSION_MODES.includes(value as PermissionMode)) {
        return `Invalid permission mode. Valid options: ${VALID_PERMISSION_MODES.join(', ')}`;
      }
      return null;

    case 'DEFAULT_CWD':
      if (!config.projects.some((p) => p.path === value)) {
        return `Path is not in the allowed project list. Use \`/repos add\` first.`;
      }
      return null;

    case 'RATE_LIMIT_WINDOW_MS':
    case 'RATE_LIMIT_MAX_REQUESTS': {
      const n = parseInt(value, 10);
      if (Number.isNaN(n) || n <= 0) {
        return `Value must be a positive integer`;
      }
      return null;
    }

    default:
      return null;
  }
}

function updateEnvFile(key: string, value: string): void {
  const envPath = resolve(process.cwd(), '.env');
  let content: string;
  try {
    content = readFileSync(envPath, 'utf-8');
  } catch {
    content = '';
  }

  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }

  writeFileSync(envPath, content, 'utf-8');
}
