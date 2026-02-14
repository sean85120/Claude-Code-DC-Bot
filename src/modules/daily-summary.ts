import type { APIEmbed } from 'discord.js';
import type { CompletedSessionRecord, DailyRecord, RepoSummary } from '../types.js';
import { COLORS } from '../types.js';
import { formatNumber, formatCost, formatDuration, truncate } from './formatters.js';
import { mergeTokenUsage } from './token-usage.js';

/**
 * Group completed sessions by repository (project path)
 * @param sessions - Array of completed session records
 * @returns Array of repo summaries, sorted by session count descending
 */
export function groupSessionsByRepo(sessions: CompletedSessionRecord[]): RepoSummary[] {
  const repoMap = new Map<string, RepoSummary>();

  for (const session of sessions) {
    const key = session.projectPath;
    const existing = repoMap.get(key);

    if (existing) {
      existing.sessions.push(session);
      existing.totalSessions++;
      existing.totalCostUsd += session.costUsd;
      existing.totalUsage = mergeTokenUsage(existing.totalUsage, session.usage);
    } else {
      repoMap.set(key, {
        projectName: session.projectName,
        projectPath: session.projectPath,
        sessions: [session],
        totalSessions: 1,
        totalCostUsd: session.costUsd,
        totalUsage: { ...session.usage },
      });
    }
  }

  return Array.from(repoMap.values()).sort((a, b) => b.totalSessions - a.totalSessions);
}

/**
 * Build a Discord embed for the daily summary
 * @param record - The daily record containing all session data
 * @param repoSummaries - Sessions grouped by repository
 * @returns A Discord embed object
 */
export function buildDailySummaryEmbed(
  record: DailyRecord,
  repoSummaries: RepoSummary[],
): APIEmbed {
  if (record.sessions.length === 0) {
    return {
      color: COLORS.Info,
      author: { name: '📅 Daily Summary' },
      title: `Summary for ${record.date}`,
      description: 'No completed sessions today. Take a break! ☕',
      timestamp: new Date().toISOString(),
    };
  }

  const fields: APIEmbed['fields'] = [
    {
      name: '📊 Overall Stats',
      value: [
        `Sessions: **${record.sessions.length}**`,
        `Repositories: **${repoSummaries.length}**`,
        `Total Tokens: **${formatNumber(record.totalUsage.total)}**`,
        `Total Cost: **${formatCost(record.totalCostUsd)}**`,
        `Total Duration: **${formatDuration(record.totalDurationMs)}**`,
      ].join('\n'),
      inline: false,
    },
  ];

  // Token breakdown
  fields.push({
    name: '🪙 Token Breakdown',
    value: [
      `Input: **${formatNumber(record.totalUsage.input)}**`,
      `Output: **${formatNumber(record.totalUsage.output)}**`,
      record.totalUsage.cacheRead > 0
        ? `Cache Read: **${formatNumber(record.totalUsage.cacheRead)}**`
        : null,
      record.totalUsage.cacheWrite > 0
        ? `Cache Write: **${formatNumber(record.totalUsage.cacheWrite)}**`
        : null,
    ]
      .filter(Boolean)
      .join('\n'),
    inline: true,
  });

  // Per-repo breakdown (up to 5 repos)
  for (const repo of repoSummaries.slice(0, 5)) {
    const sessionList = repo.sessions
      .slice(0, 3)
      .map((s) => `• ${truncate(s.promptText, 60)}`)
      .join('\n');

    const moreCount =
      repo.sessions.length > 3 ? `\n_...and ${repo.sessions.length - 3} more_` : '';

    fields.push({
      name: `🗂️ ${repo.projectName} (${repo.totalSessions} sessions)`,
      value: [
        sessionList + moreCount,
        `**Tokens:** ${formatNumber(repo.totalUsage.total)} · **Cost:** ${formatCost(repo.totalCostUsd)}`,
      ].join('\n'),
      inline: false,
    });
  }

  if (repoSummaries.length > 5) {
    fields.push({
      name: '📦 Other Projects',
      value: `${repoSummaries.length - 5} more project(s) with completed sessions`,
      inline: false,
    });
  }

  return {
    color: COLORS.Info,
    author: { name: '📅 Daily Summary' },
    title: `Summary for ${record.date}`,
    description: `Completed **${record.sessions.length}** Claude Code session(s) today across **${repoSummaries.length}** repository/repositories.`,
    fields,
    timestamp: new Date().toISOString(),
  };
}
