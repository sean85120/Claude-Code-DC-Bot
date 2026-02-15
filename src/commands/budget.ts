import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { BotConfig } from '../types.js';
import { COLORS } from '../types.js';
import type { BudgetStore } from '../effects/budget-store.js';
import { canExecuteCommand } from '../modules/permissions.js';
import { formatCost } from '../modules/formatters.js';

/**
 * Build the /budget slash command definition
 */
export function buildBudgetCommand() {
  return new SlashCommandBuilder()
    .setName('budget')
    .setDescription('View or manage cost budget limits')
    .addSubcommand((sub) =>
      sub.setName('view').setDescription('View current spending vs budget limits'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Set a budget limit')
        .addStringOption((opt) =>
          opt
            .setName('period')
            .setDescription('Budget period')
            .setRequired(true)
            .addChoices(
              { name: 'Daily', value: 'daily' },
              { name: 'Weekly', value: 'weekly' },
              { name: 'Monthly', value: 'monthly' },
            ),
        )
        .addNumberOption((opt) =>
          opt
            .setName('amount')
            .setDescription('Limit in USD (e.g. 5.00)')
            .setRequired(true)
            .setMinValue(0.01),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('clear')
        .setDescription('Remove a budget limit')
        .addStringOption((opt) =>
          opt
            .setName('period')
            .setDescription('Budget period to clear')
            .setRequired(true)
            .addChoices(
              { name: 'Daily', value: 'daily' },
              { name: 'Weekly', value: 'weekly' },
              { name: 'Monthly', value: 'monthly' },
            ),
        ),
    );
}

export const data = buildBudgetCommand();

/**
 * Execute the /budget command
 */
export async function execute(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  budgetStore: BudgetStore,
): Promise<void> {
  const auth = canExecuteCommand(interaction.user.id, config);
  if (!auth.allowed) {
    await interaction.reply({ content: `❌ ${auth.reason}`, flags: [MessageFlags.Ephemeral] });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'view') {
    await handleView(interaction, config, budgetStore);
  } else if (subcommand === 'set') {
    await handleSet(interaction, config, budgetStore);
  } else if (subcommand === 'clear') {
    await handleClear(interaction, config, budgetStore);
  }
}

function formatLimit(limit: number): string {
  return limit > 0 ? formatCost(limit) : 'Unlimited';
}

function formatBar(spent: number, limit: number): string {
  if (limit <= 0) return '';
  const pct = Math.min(100, (spent / limit) * 100);
  const filled = Math.round(pct / 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  return ` [${bar}] ${pct.toFixed(0)}%`;
}

async function handleView(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  budgetStore: BudgetStore,
): Promise<void> {
  const daily = budgetStore.getDailySpend();
  const weekly = budgetStore.getWeeklySpend();
  const monthly = budgetStore.getMonthlySpend();

  const lines = [
    `**Daily** — ${formatCost(daily)} / ${formatLimit(config.budgetDailyLimitUsd)}${formatBar(daily, config.budgetDailyLimitUsd)}`,
    `**Weekly** — ${formatCost(weekly)} / ${formatLimit(config.budgetWeeklyLimitUsd)}${formatBar(weekly, config.budgetWeeklyLimitUsd)}`,
    `**Monthly** — ${formatCost(monthly)} / ${formatLimit(config.budgetMonthlyLimitUsd)}${formatBar(monthly, config.budgetMonthlyLimitUsd)}`,
  ];

  const warnings = budgetStore.getWarnings(config);
  if (warnings.length > 0) {
    lines.push('');
    for (const w of warnings) {
      const emoji = w.percentage >= 100 ? '🚫' : '⚠️';
      lines.push(`${emoji} **${w.period}** budget at ${w.percentage.toFixed(0)}%`);
    }
  }

  await interaction.reply({
    embeds: [{
      title: '💰 Budget Overview',
      description: lines.join('\n'),
      color: warnings.some((w) => w.percentage >= 100) ? COLORS.Error : COLORS.PreToolUse,
    }],
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleSet(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  budgetStore: BudgetStore,
): Promise<void> {
  const period = interaction.options.getString('period', true) as 'daily' | 'weekly' | 'monthly';
  const amount = interaction.options.getNumber('amount', true);

  budgetStore.setLimit(config, period, amount);

  await interaction.reply({
    embeds: [{
      title: '💰 Budget Updated',
      description: `**${period}** limit set to **${formatCost(amount)}**`,
      color: COLORS.PostToolUse,
    }],
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleClear(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  budgetStore: BudgetStore,
): Promise<void> {
  const period = interaction.options.getString('period', true) as 'daily' | 'weekly' | 'monthly';

  budgetStore.setLimit(config, period, 0);

  await interaction.reply({
    embeds: [{
      title: '💰 Budget Cleared',
      description: `**${period}** limit removed (unlimited)`,
      color: COLORS.PostToolUse,
    }],
    flags: [MessageFlags.Ephemeral],
  });
}
