import { describe, it, expect } from 'vitest';
import {
  buildToolUseEmbed,
  buildPermissionRequestEmbed,
  buildProgressEmbed,
  buildStreamingTextEmbed,
  buildResultEmbed,
  buildErrorEmbed,
  buildStatusEmbed,
  buildSessionStartEmbed,
  buildStopConfirmEmbed,
  buildStopPreviewEmbed,
  buildNotificationEmbed,
  buildFollowUpEmbed,
  buildWaitingInputEmbed,
  buildMultiStatusEmbed,
  buildGlobalStatusEmbed,
  buildRetryEmbed,
  buildAskUserQuestionEmbed,
  buildAskQuestionStepEmbed,
  buildAskCompletedEmbed,
  buildOrphanCleanupEmbed,
  buildIdleCleanupEmbed,
} from './embeds.js';
import { COLORS } from '../types.js';
import type { UserUsageRecord } from '../effects/usage-store.js';
import type { SessionState, TokenUsage, AskState } from '../types.js';
import type { GlobalUsageStats } from '../effects/usage-store.js';

function makeSession(overrides?: Partial<SessionState>): SessionState {
  return {
    sessionId: null,
    status: 'running',
    threadId: 't1',
    userId: 'u1',
    startedAt: new Date(),
    lastActivityAt: new Date(),
    promptText: 'test prompt',
    cwd: '/test',
    model: 'claude-sonnet-4-5-20250929',
    toolCount: 0,
    tools: {},
    pendingApproval: null,
    abortController: new AbortController(),
    transcript: [],
    ...overrides,
  };
}

describe('buildToolUseEmbed', () => {
  it('includes tool name and emoji', () => {
    const embed = buildToolUseEmbed('Read', { file_path: '/test/file.ts' }, '/test');
    expect(embed.author?.name).toContain('Read');
    expect(embed.author?.name).toContain('📖');
  });

  it('uses default emoji for unknown tools', () => {
    const embed = buildToolUseEmbed('CustomTool', { key: 'val' }, '/test');
    expect(embed.author?.name).toContain('🔧');
  });

  it('shows footer when meta is provided', () => {
    const embed = buildToolUseEmbed('Bash', { command: 'ls' }, '/test', {
      model: 'opus',
      permissionMode: 'default',
      sessionId: 'abcdefgh12345678',
    });
    expect(embed.footer?.text).toContain('opus');
    expect(embed.footer?.text).toContain('abcdefgh');
  });

  it('has no footer when meta is absent', () => {
    const embed = buildToolUseEmbed('Bash', { command: 'ls' }, '/test');
    expect(embed.footer).toBeUndefined();
  });
});

describe('buildPermissionRequestEmbed', () => {
  it('shows approval prompt', () => {
    const embed = buildPermissionRequestEmbed('Bash', { command: 'rm -rf /' }, '/test');
    expect(embed.author?.name).toContain('Approval');
    expect(embed.color).toBe(COLORS.Permission);
    expect(embed.fields?.some((f) => f.value.includes('approve'))).toBe(true);
  });
});

describe('buildProgressEmbed', () => {
  it('shows progress text and tool count', () => {
    const embed = buildProgressEmbed('Processing...', 5);
    expect(embed.description).toBe('Processing...');
    expect(embed.footer?.text).toContain('5');
  });

  it('truncates overly long text', () => {
    const longText = 'x'.repeat(5000);
    const embed = buildProgressEmbed(longText, 0);
    expect(embed.description!.length).toBeLessThanOrEqual(4001); // 4000 + ellipsis
  });
});

describe('buildStreamingTextEmbed', () => {
  it('shows responding status', () => {
    const embed = buildStreamingTextEmbed('hello', 3);
    expect(embed.author?.name).toContain('Responding');
    expect(embed.description).toBe('hello');
  });
});

describe('buildResultEmbed', () => {
  it('shows result and tool statistics', () => {
    const embed = buildResultEmbed('Completed', { toolCount: 3, tools: { Read: 2, Write: 1 } });
    expect(embed.title).toContain('completed');
    expect(embed.fields?.some((f) => f.value.includes('Read'))).toBe(true);
  });

  it('shows "None" when tools is empty', () => {
    const embed = buildResultEmbed('ok', { toolCount: 0, tools: {} });
    expect(embed.fields?.some((f) => f.value === 'None')).toBe(true);
  });

  it('shows token consumption when usage is provided', () => {
    const usage: TokenUsage = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150, costUsd: 0 };
    const embed = buildResultEmbed('ok', { toolCount: 0, tools: {} }, usage);
    expect(embed.fields?.some((f) => f.name.includes('Token'))).toBe(true);
  });

  it('shows cache field when cache is present', () => {
    const usage: TokenUsage = { input: 100, output: 50, cacheRead: 200, cacheWrite: 10, total: 150, costUsd: 0 };
    const embed = buildResultEmbed('ok', { toolCount: 0, tools: {} }, usage);
    expect(embed.fields?.some((f) => f.name.includes('Cache'))).toBe(true);
  });

  it('does not show cache when there is none', () => {
    const usage: TokenUsage = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150, costUsd: 0 };
    const embed = buildResultEmbed('ok', { toolCount: 0, tools: {} }, usage);
    expect(embed.fields?.some((f) => f.name.includes('Cache'))).toBe(false);
  });

  it('shows durationMs and costUsd when provided', () => {
    const embed = buildResultEmbed('ok', { toolCount: 0, tools: {} }, undefined, 5000, 0.05);
    expect(embed.fields?.some((f) => f.name.includes('Duration'))).toBe(true);
    expect(embed.fields?.some((f) => f.name.includes('Cost'))).toBe(true);
  });

  it('sorts tool statistics by count', () => {
    const embed = buildResultEmbed('ok', {
      toolCount: 6,
      tools: { Write: 1, Read: 3, Bash: 2 },
    });
    const toolField = embed.fields?.find((f) => f.name.includes('Tool Stats'));
    const lines = toolField!.value.split('\n');
    // Read(3) should be first
    expect(lines[0]).toContain('Read');
    expect(lines[1]).toContain('Bash');
    expect(lines[2]).toContain('Write');
  });
});

describe('buildErrorEmbed', () => {
  it('shows error message', () => {
    const embed = buildErrorEmbed('something broke');
    expect(embed.color).toBe(COLORS.Error);
    expect(embed.description).toContain('something broke');
  });

  it('shows context when provided', () => {
    const embed = buildErrorEmbed('error', 'while executing Bash');
    expect(embed.fields).toHaveLength(1);
    expect(embed.fields![0].value).toContain('Bash');
  });

  it('has no fields when context is absent', () => {
    const embed = buildErrorEmbed('error');
    expect(embed.fields).toBeUndefined();
  });

  it('truncates overly long errors', () => {
    const longError = 'e'.repeat(5000);
    const embed = buildErrorEmbed(longError);
    expect(embed.description!.length).toBeLessThanOrEqual(4001);
  });
});

describe('buildStatusEmbed', () => {
  it('shows "no active" when session is null', () => {
    const embed = buildStatusEmbed(null);
    expect(embed.title).toContain('No Active');
  });

  it('uses Running color for running session', () => {
    const embed = buildStatusEmbed(makeSession({ status: 'running' }));
    expect(embed.color).toBe(COLORS.Running);
  });

  it('uses Info color for non-running session', () => {
    const embed = buildStatusEmbed(makeSession({ status: 'completed' }));
    expect(embed.color).toBe(COLORS.Info);
  });

  it('shows working directory and model', () => {
    const embed = buildStatusEmbed(makeSession({ cwd: '/my/project', model: 'opus' }));
    expect(embed.fields?.some((f) => f.value.includes('/my/project'))).toBe(true);
    expect(embed.fields?.some((f) => f.value === 'opus')).toBe(true);
  });

  it('shows cumulative tokens when sessionUsage is provided', () => {
    const embed = buildStatusEmbed(makeSession(), {
      usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, total: 1500, costUsd: 0 },
      costUsd: 0.05,
      durationMs: 3000,
    });
    expect(embed.fields?.some((f) => f.name.includes('Total Tokens'))).toBe(true);
    expect(embed.fields?.some((f) => f.name.includes('Cost'))).toBe(true);
  });

  it('does not show tokens when sessionUsage total is 0', () => {
    const embed = buildStatusEmbed(makeSession(), {
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, costUsd: 0 },
      costUsd: 0,
      durationMs: 0,
    });
    expect(embed.fields?.some((f) => f.name.includes('Total Tokens'))).toBe(false);
  });
});

describe('buildSessionStartEmbed', () => {
  it('shows prompt and settings', () => {
    const embed = buildSessionStartEmbed('Do something', '/cwd', 'model');
    expect(embed.title).toContain('Do something');
    expect(embed.fields?.some((f) => f.value.includes('/cwd'))).toBe(true);
  });

  it('truncates overly long prompt', () => {
    const embed = buildSessionStartEmbed('a'.repeat(200), '/cwd', 'model');
    expect(embed.title!.length).toBeLessThanOrEqual(101);
  });
});

describe('buildStopPreviewEmbed', () => {
  it('shows abort confirmation', () => {
    const embed = buildStopPreviewEmbed(makeSession({ toolCount: 5, tools: { Read: 3, Write: 2 } }), 10_000);
    expect(embed.title).toContain('stop');
    expect(embed.fields?.some((f) => f.value.includes('Read'))).toBe(true);
  });

  it('shows "none yet" when there are no tools', () => {
    const embed = buildStopPreviewEmbed(makeSession(), 1000);
    expect(embed.fields?.some((f) => f.value === 'None')).toBe(true);
  });
});

describe('buildStopConfirmEmbed', () => {
  it('shows abort result', () => {
    const embed = buildStopConfirmEmbed({ toolCount: 2, tools: { Bash: 2 } }, 5000);
    expect(embed.author?.name).toContain('Stopped');
    expect(embed.fields?.some((f) => f.value.includes('5s'))).toBe(true);
  });
});

describe('buildMultiStatusEmbed', () => {
  it('shows multi-session summary', () => {
    const sessions = new Map([
      ['t1', makeSession({ promptText: 'Task one', toolCount: 3 })],
      ['t2', makeSession({ promptText: 'Task two', toolCount: 1 })],
    ]);
    const embed = buildMultiStatusEmbed(sessions);
    expect(embed.author?.name).toContain('2');
    expect(embed.description).toContain('Task one');
    expect(embed.description).toContain('Task two');
  });

  it('description is empty when Map is empty', () => {
    const embed = buildMultiStatusEmbed(new Map());
    expect(embed.author?.name).toContain('0');
  });
});

describe('buildGlobalStatusEmbed', () => {
  function makeGlobalStats(overrides?: Partial<GlobalUsageStats>): GlobalUsageStats {
    return {
      bootedAt: new Date(),
      totalSessions: 0,
      completedQueries: 0,
      totalUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, costUsd: 0 },
      totalCostUsd: 0,
      totalDurationMs: 0,
      ...overrides,
    };
  }

  it('shows uptime and session count', () => {
    const embed = buildGlobalStatusEmbed(makeGlobalStats({ totalSessions: 3 }), new Map());
    expect(embed.fields?.some((f) => f.name.includes('Uptime'))).toBe(true);
    expect(embed.fields?.some((f) => f.value === '3')).toBe(true);
  });

  it('shows cumulative tokens when token usage exists', () => {
    const embed = buildGlobalStatusEmbed(
      makeGlobalStats({
        totalUsage: { input: 5000, output: 2000, cacheRead: 0, cacheWrite: 0, total: 7000, costUsd: 0 },
        totalCostUsd: 0.5,
      }),
      new Map(),
    );
    expect(embed.fields?.some((f) => f.name.includes('Total Tokens'))).toBe(true);
    expect(embed.fields?.some((f) => f.name.includes('Total Cost'))).toBe(true);
  });

  it('does not show token field when there is no token usage', () => {
    const embed = buildGlobalStatusEmbed(makeGlobalStats(), new Map());
    expect(embed.fields?.some((f) => f.name.includes('Total Tokens'))).toBe(false);
  });

  it('shows session list when there are active sessions', () => {
    const sessions = new Map([
      ['t1', makeSession({ promptText: 'Task one' })],
    ]);
    const embed = buildGlobalStatusEmbed(makeGlobalStats(), sessions);
    // In addition to the count field, there should be a detailed list field
    expect(embed.fields?.some((f) => f.name.startsWith('Active Sessions ('))).toBe(true);
  });

  it('does not show session list when there are no active sessions', () => {
    const embed = buildGlobalStatusEmbed(makeGlobalStats(), new Map());
    // There should be no detailed list field (but the count field is still present)
    expect(embed.fields?.some((f) => f.name.startsWith('Active Sessions ('))).toBe(false);
  });
});

describe('buildNotificationEmbed', () => {
  it('shows notification message', () => {
    const embed = buildNotificationEmbed('hello');
    expect(embed.description).toBe('hello');
    expect(embed.color).toBe(COLORS.Notification);
  });
});

describe('buildFollowUpEmbed', () => {
  it('shows follow-up text', () => {
    const embed = buildFollowUpEmbed('follow-up content');
    expect(embed.description).toContain('follow-up content');
  });
});

describe('buildWaitingInputEmbed', () => {
  it('shows waiting for input', () => {
    const embed = buildWaitingInputEmbed();
    expect(embed.title).toContain('waiting');
  });
});

describe('buildRetryEmbed', () => {
  it('shows retry information', () => {
    const embed = buildRetryEmbed('Do it again');
    expect(embed.description).toContain('Do it again');
    expect(embed.author?.name).toContain('Retry');
  });
});

describe('buildAskUserQuestionEmbed', () => {
  it('shows question and options', () => {
    const embed = buildAskUserQuestionEmbed({
      questions: [{
        header: 'Choose',
        question: 'Which one do you want?',
        options: [{ label: 'A', description: 'Description A' }, { label: 'B' }],
      }],
    }, '/cwd');
    expect(embed.title).toContain('Select');
    expect(embed.description).toContain('Which one do you want?');
    expect(embed.description).toContain('A');
    expect(embed.description).toContain('Description A');
  });

  it('shows waiting when questions is empty', () => {
    const embed = buildAskUserQuestionEmbed({ questions: [] }, '/cwd');
    expect(embed.title).toContain('Waiting');
  });

  it('shows waiting when questions field is missing', () => {
    const embed = buildAskUserQuestionEmbed({}, '/cwd');
    expect(embed.title).toContain('Waiting');
  });
});

// --- AskState Factory ---

function makeAskState(overrides?: Partial<AskState>): AskState {
  return {
    totalQuestions: 2,
    currentQuestionIndex: 0,
    collectedAnswers: {},
    selectedOptions: new Set(),
    isMultiSelect: false,
    questions: [
      { question: 'Question one?', header: 'Q1', options: [{ label: 'A', description: 'Description A' }, { label: 'B', description: 'Description B' }], multiSelect: false },
      { question: 'Question two?', header: 'Q2', options: [{ label: 'X', description: 'Description X' }], multiSelect: true },
    ],
    ...overrides,
  };
}

// --- buildAskQuestionStepEmbed ---

describe('buildAskQuestionStepEmbed', () => {
  it('does not show progress for single question', () => {
    const state = makeAskState({ totalQuestions: 1, questions: [
      { question: 'Only question?', header: 'Q1', options: [{ label: 'A', description: '' }], multiSelect: false },
    ] });
    const embed = buildAskQuestionStepEmbed(state);
    expect(embed.author?.name).not.toContain('/');
  });

  it('shows progress for multiple questions', () => {
    const state = makeAskState({ totalQuestions: 3, currentQuestionIndex: 1, questions: [
      { question: 'Question one?', header: 'Q1', options: [{ label: 'A', description: '' }], multiSelect: false },
      { question: 'Question two?', header: 'Q2', options: [{ label: 'B', description: '' }], multiSelect: false },
      { question: 'Question three?', header: 'Q3', options: [{ label: 'C', description: '' }], multiSelect: false },
    ] });
    const embed = buildAskQuestionStepEmbed(state);
    expect(embed.author?.name).toContain('2/3');
  });

  it('shows summary of answered questions', () => {
    const state = makeAskState({ currentQuestionIndex: 1, collectedAnswers: { '0': 'Chose A' } });
    const embed = buildAskQuestionStepEmbed(state);
    expect(embed.description).toContain('Chose A');
  });

  it('footer prompts to confirm selection when multiSelect', () => {
    const state = makeAskState({
      isMultiSelect: true,
      questions: [
        { question: 'Multi-select?', header: 'Q1', options: [{ label: 'A', description: '' }], multiSelect: true },
        { question: 'Question two?', header: 'Q2', options: [{ label: 'X', description: '' }], multiSelect: false },
      ],
    });
    const embed = buildAskQuestionStepEmbed(state);
    expect(embed.footer?.text).toContain('Submit');
  });

  it('footer prompts to click button when not multiSelect', () => {
    const state = makeAskState();
    const embed = buildAskQuestionStepEmbed(state);
    expect(embed.footer?.text).toContain('Click');
  });

  it('uses header as title', () => {
    const state = makeAskState();
    const embed = buildAskQuestionStepEmbed(state);
    expect(embed.title).toBe('Q1');
  });
});

// --- buildAskCompletedEmbed ---

describe('buildAskCompletedEmbed', () => {
  it('shows summary of all answered questions', () => {
    const state = makeAskState({ collectedAnswers: { '0': 'A', '1': 'B' } });
    const embed = buildAskCompletedEmbed(state);
    expect(embed.description).toContain('A');
    expect(embed.description).toContain('B');
  });

  it('uses WaitingInput color', () => {
    const state = makeAskState({ collectedAnswers: { '0': 'A' } });
    const embed = buildAskCompletedEmbed(state);
    expect(embed.color).toBe(COLORS.WaitingInput);
  });

  it('uses question number when header is absent', () => {
    const state = makeAskState({
      collectedAnswers: { '0': 'A' },
      questions: [
        { question: 'Some question?', header: '', options: [{ label: 'A', description: '' }], multiSelect: false },
        { question: 'Question two?', header: 'Q2', options: [{ label: 'X', description: '' }], multiSelect: false },
      ],
    });
    const embed = buildAskCompletedEmbed(state);
    expect(embed.description).toContain('Question 1');
  });
});

// --- buildOrphanCleanupEmbed ---

describe('buildOrphanCleanupEmbed', () => {
  it('uses Notification color', () => {
    const embed = buildOrphanCleanupEmbed();
    expect(embed.color).toBe(COLORS.Notification);
  });

  it('description includes reuse prompt', () => {
    const embed = buildOrphanCleanupEmbed();
    expect(embed.description).toContain('/prompt');
  });
});

// --- buildResultEmbed - edge cases ---

describe('buildResultEmbed - edge cases', () => {
  it('description is undefined when resultText is empty', () => {
    const embed = buildResultEmbed('', { toolCount: 0, tools: {} });
    expect(embed.description).toBeUndefined();
  });

  it('cache shows only read when only cacheRead is present', () => {
    const usage: TokenUsage = { input: 100, output: 50, cacheRead: 200, cacheWrite: 0, total: 150, costUsd: 0 };
    const embed = buildResultEmbed('ok', { toolCount: 0, tools: {} }, usage);
    const cacheField = embed.fields?.find((f) => f.name.includes('Cache'));
    expect(cacheField?.value).toContain('Read');
    expect(cacheField?.value).not.toContain('Write');
  });

  it('cache shows only write when only cacheWrite is present', () => {
    const usage: TokenUsage = { input: 100, output: 50, cacheRead: 0, cacheWrite: 50, total: 150, costUsd: 0 };
    const embed = buildResultEmbed('ok', { toolCount: 0, tools: {} }, usage);
    const cacheField = embed.fields?.find((f) => f.name.includes('Cache'));
    expect(cacheField?.value).toContain('Write');
    expect(cacheField?.value).not.toContain('Read');
  });
});

// --- buildFollowUpEmbed - edge cases ---

describe('buildFollowUpEmbed - edge cases', () => {
  it('shows file names when files are provided', () => {
    const embed = buildFollowUpEmbed('follow-up', 2, ['a.ts', 'b.py']);
    expect(embed.description).toContain('a.ts');
    expect(embed.description).toContain('b.py');
  });

  it('shows count when fileCount is provided but filenames is empty', () => {
    const embed = buildFollowUpEmbed('follow-up', 3, []);
    expect(embed.description).toContain('3 files');
  });
});

// --- buildFooterText via buildToolUseEmbed ---

describe('buildFooterText via buildToolUseEmbed', () => {
  it('displays correctly when only model is provided', () => {
    const embed = buildToolUseEmbed('Bash', { command: 'ls' }, '/test', { model: 'opus' });
    expect(embed.footer?.text).toContain('opus');
    // Should not have extra separators
    expect(embed.footer?.text).not.toMatch(/• $/);
    expect(embed.footer?.text).not.toMatch(/^• /);
  });

  it('shows English text for plan permission mode', () => {
    const embed = buildToolUseEmbed('Bash', { command: 'ls' }, '/test', { permissionMode: 'plan' });
    expect(embed.footer?.text).toContain('Plan Mode');
  });
});

// --- buildIdleCleanupEmbed ---

describe('buildIdleCleanupEmbed', () => {
  it('uses Info color', () => {
    const embed = buildIdleCleanupEmbed(1800000);
    expect(embed.color).toBe(COLORS.Info);
  });

  it('shows duration of inactivity', () => {
    const embed = buildIdleCleanupEmbed(1800000); // 30 min
    expect(embed.description).toContain('30m');
  });

  it('description includes prompt to start new session', () => {
    const embed = buildIdleCleanupEmbed(60000);
    expect(embed.description).toContain('/prompt');
  });

  it('shows session timeout author', () => {
    const embed = buildIdleCleanupEmbed(60000);
    expect(embed.author?.name).toContain('Session Timeout');
  });
});

// --- buildGlobalStatusEmbed with per-user usage ---

describe('buildGlobalStatusEmbed - per-user usage', () => {
  function makeGlobalStats(overrides?: Partial<GlobalUsageStats>): GlobalUsageStats {
    return {
      bootedAt: new Date(),
      totalSessions: 0,
      completedQueries: 0,
      totalUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, costUsd: 0 },
      totalCostUsd: 0,
      totalDurationMs: 0,
      ...overrides,
    };
  }

  it('shows per-user breakdown when user usage is provided', () => {
    const userUsage = new Map<string, UserUsageRecord>([
      ['user-1', { usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, total: 1500, costUsd: 0 }, costUsd: 0.05, durationMs: 5000, totalQueries: 3 }],
    ]);
    const embed = buildGlobalStatusEmbed(makeGlobalStats(), new Map(), userUsage);
    expect(embed.fields?.some((f) => f.name.includes('Per-User Usage'))).toBe(true);
    expect(embed.fields?.some((f) => f.value.includes('user-1'))).toBe(true);
  });

  it('does not show per-user section when user usage is empty', () => {
    const embed = buildGlobalStatusEmbed(makeGlobalStats(), new Map(), new Map());
    expect(embed.fields?.some((f) => f.name.includes('Per-User Usage'))).toBe(false);
  });

  it('does not show per-user section when user usage is undefined', () => {
    const embed = buildGlobalStatusEmbed(makeGlobalStats(), new Map());
    expect(embed.fields?.some((f) => f.name.includes('Per-User Usage'))).toBe(false);
  });
});
