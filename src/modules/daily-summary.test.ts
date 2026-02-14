import { describe, it, expect } from 'vitest';
import { groupSessionsByRepo, buildDailySummaryEmbed } from './daily-summary.js';
import type { CompletedSessionRecord, DailyRecord } from '../types.js';
import { emptyTokenUsage } from './token-usage.js';

function makeSession(overrides: Partial<CompletedSessionRecord> = {}): CompletedSessionRecord {
  return {
    threadId: 't1',
    userId: 'u1',
    projectName: 'Project A',
    projectPath: '/path/a',
    promptText: 'Implement a new feature',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 5000,
    toolCount: 3,
    usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150, costUsd: 0 },
    costUsd: 0.01,
    model: 'claude-opus-4-6',
    ...overrides,
  };
}

describe('groupSessionsByRepo', () => {
  it('returns empty array for empty sessions', () => {
    expect(groupSessionsByRepo([])).toEqual([]);
  });

  it('groups sessions by project path', () => {
    const sessions = [
      makeSession({ threadId: 't1', projectName: 'Project A', projectPath: '/path/a' }),
      makeSession({ threadId: 't2', projectName: 'Project A', projectPath: '/path/a' }),
      makeSession({ threadId: 't3', projectName: 'Project B', projectPath: '/path/b' }),
    ];

    const result = groupSessionsByRepo(sessions);

    expect(result).toHaveLength(2);
    expect(result[0].projectName).toBe('Project A');
    expect(result[0].totalSessions).toBe(2);
    expect(result[1].projectName).toBe('Project B');
    expect(result[1].totalSessions).toBe(1);
  });

  it('sorts by total sessions descending', () => {
    const sessions = [
      makeSession({ threadId: 't1', projectPath: '/path/a', projectName: 'A' }),
      makeSession({ threadId: 't2', projectPath: '/path/b', projectName: 'B' }),
      makeSession({ threadId: 't3', projectPath: '/path/b', projectName: 'B' }),
      makeSession({ threadId: 't4', projectPath: '/path/b', projectName: 'B' }),
    ];

    const result = groupSessionsByRepo(sessions);

    expect(result[0].projectName).toBe('B');
    expect(result[0].totalSessions).toBe(3);
    expect(result[1].projectName).toBe('A');
    expect(result[1].totalSessions).toBe(1);
  });

  it('accumulates cost and usage across sessions in the same repo', () => {
    const sessions = [
      makeSession({
        threadId: 't1',
        projectPath: '/path/a',
        costUsd: 0.01,
        usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150, costUsd: 0 },
      }),
      makeSession({
        threadId: 't2',
        projectPath: '/path/a',
        costUsd: 0.02,
        usage: { input: 200, output: 100, cacheRead: 10, cacheWrite: 5, total: 300, costUsd: 0 },
      }),
    ];

    const result = groupSessionsByRepo(sessions);

    expect(result).toHaveLength(1);
    expect(result[0].totalCostUsd).toBeCloseTo(0.03);
    expect(result[0].totalUsage.input).toBe(300);
    expect(result[0].totalUsage.output).toBe(150);
    expect(result[0].totalUsage.total).toBe(450);
  });
});

describe('buildDailySummaryEmbed', () => {
  it('shows no sessions message when empty', () => {
    const record: DailyRecord = {
      date: '2026-02-15',
      sessions: [],
      totalCostUsd: 0,
      totalUsage: emptyTokenUsage(),
      totalDurationMs: 0,
    };

    const embed = buildDailySummaryEmbed(record, []);

    expect(embed.title).toBe('Summary for 2026-02-15');
    expect(embed.description).toContain('No completed sessions');
  });

  it('builds summary with sessions', () => {
    const sessions = [
      makeSession({ threadId: 't1', projectName: 'Project A', projectPath: '/path/a', costUsd: 0.05 }),
      makeSession({ threadId: 't2', projectName: 'Project A', projectPath: '/path/a', costUsd: 0.03 }),
    ];

    const record: DailyRecord = {
      date: '2026-02-15',
      sessions,
      totalCostUsd: 0.08,
      totalUsage: { input: 200, output: 100, cacheRead: 0, cacheWrite: 0, total: 300, costUsd: 0 },
      totalDurationMs: 10000,
    };

    const repoSummaries = groupSessionsByRepo(sessions);
    const embed = buildDailySummaryEmbed(record, repoSummaries);

    expect(embed.title).toBe('Summary for 2026-02-15');
    expect(embed.description).toContain('2');
    expect(embed.fields).toBeDefined();
    expect(embed.fields!.length).toBeGreaterThan(0);

    // Should have overall stats field
    const overallField = embed.fields!.find((f) => f.name.includes('Overall Stats'));
    expect(overallField).toBeDefined();
    expect(overallField!.value).toContain('$0.0800');

    // Should have repo breakdown
    const repoField = embed.fields!.find((f) => f.name.includes('Project A'));
    expect(repoField).toBeDefined();
    expect(repoField!.value).toContain('Implement a new feature');
  });

  it('limits to 5 repos and shows overflow', () => {
    const sessions: CompletedSessionRecord[] = [];
    for (let i = 0; i < 7; i++) {
      sessions.push(
        makeSession({
          threadId: `t${i}`,
          projectName: `Project ${i}`,
          projectPath: `/path/${i}`,
        }),
      );
    }

    const record: DailyRecord = {
      date: '2026-02-15',
      sessions,
      totalCostUsd: 0.07,
      totalUsage: { input: 700, output: 350, cacheRead: 0, cacheWrite: 0, total: 1050, costUsd: 0 },
      totalDurationMs: 35000,
    };

    const repoSummaries = groupSessionsByRepo(sessions);
    const embed = buildDailySummaryEmbed(record, repoSummaries);

    const otherField = embed.fields!.find((f) => f.name.includes('Other Projects'));
    expect(otherField).toBeDefined();
    expect(otherField!.value).toContain('2 more');
  });

  it('includes token breakdown field', () => {
    const sessions = [makeSession({ costUsd: 0.01 })];
    const record: DailyRecord = {
      date: '2026-02-15',
      sessions,
      totalCostUsd: 0.01,
      totalUsage: { input: 100, output: 50, cacheRead: 20, cacheWrite: 0, total: 150, costUsd: 0 },
      totalDurationMs: 5000,
    };

    const repoSummaries = groupSessionsByRepo(sessions);
    const embed = buildDailySummaryEmbed(record, repoSummaries);

    const tokenField = embed.fields!.find((f) => f.name.includes('Token Breakdown'));
    expect(tokenField).toBeDefined();
    expect(tokenField!.value).toContain('Input');
    expect(tokenField!.value).toContain('Output');
    expect(tokenField!.value).toContain('Cache Read');
  });
});
