import type { APIEmbed } from 'discord.js';
import type {
  AskState,
  SessionState,
  TokenUsage,
  GitDiffSummary,
  BudgetWarning,
} from '../types.js';
import type { GlobalUsageStats, SessionUsageRecord, UserUsageRecord } from '../effects/usage-store.js';
import {
  COLORS,
  TOOL_EMOJI,
  PERMISSION_MODE_NAMES,
  SESSION_STATUS_NAMES,
} from '../types.js';
import { formatToolInput } from './tool-display.js';
import { formatNumber, formatDuration, formatCost, truncate } from './formatters.js';

// ─── Tool Use Embed ─────────────────────────────────

/**
 * Build a tool use notification embed
 * @param toolName - Tool name
 * @param toolInput - Tool input parameters
 * @param cwd - Working directory
 * @param meta - Optional metadata (model, permission mode, session ID)
 * @returns Tool use notification embed
 */
export function buildToolUseEmbed(
  toolName: string,
  toolInput: Record<string, unknown>,
  cwd: string,
  meta?: { model?: string; permissionMode?: string; sessionId?: string },
): APIEmbed {
  const emoji = TOOL_EMOJI[toolName] || '🔧';
  const display = formatToolInput(toolName, toolInput, cwd);

  return {
    color: COLORS.PreToolUse,
    author: { name: `${emoji} ${toolName}` },
    title: display.title,
    description: display.description,
    fields: display.fields,
    timestamp: new Date().toISOString(),
    footer: meta
      ? {
          text: buildFooterText(meta.model, meta.permissionMode, meta.sessionId),
        }
      : undefined,
  };
}

/**
 * Build a compact (single-line) tool use embed — no fields, minimal description
 */
export function buildCompactToolEmbed(
  toolName: string,
  toolInput: Record<string, unknown>,
  cwd: string,
): APIEmbed {
  const emoji = TOOL_EMOJI[toolName] || '🔧';
  const display = formatToolInput(toolName, toolInput, cwd);

  return {
    color: COLORS.PreToolUse,
    description: `${emoji} **${toolName}** — ${truncate(display.title, 120)}`,
  };
}

// ─── Permission Request Embed ─────────────────────────────────

/**
 * Build a permission request embed (with Approve/Deny buttons)
 * @param toolName - Tool name
 * @param toolInput - Tool input parameters
 * @param cwd - Working directory
 * @returns Permission request embed
 */
export function buildPermissionRequestEmbed(
  toolName: string,
  toolInput: Record<string, unknown>,
  cwd: string,
): APIEmbed {
  const emoji = TOOL_EMOJI[toolName] || '🔧';
  const display = formatToolInput(toolName, toolInput, cwd);

  return {
    color: COLORS.Permission,
    author: { name: '🔐 Approval Required' },
    title: `${emoji} ${toolName} — ${display.title}`,
    description: display.description,
    fields: [
      ...(display.fields || []),
      {
        name: 'Action',
        value: 'Click buttons below to approve or deny',
        inline: false,
      },
    ],
    timestamp: new Date().toISOString(),
  };
}

// ─── Progress Embed ─────────────────────────────────────

/**
 * Build a streaming progress embed
 * @param text - Current progress text
 * @param toolsUsed - Number of tools used
 * @returns Progress embed
 */
export function buildProgressEmbed(
  text: string,
  toolsUsed: number,
): APIEmbed {
  return {
    color: COLORS.Running,
    author: { name: '⏳ Running' },
    description: truncate(text, 4000),
    footer: { text: `🔧 Used ${toolsUsed} tools` },
    timestamp: new Date().toISOString(),
  };
}

// ─── Streaming Text Embed ─────────────────────────────────

/**
 * Build a real-time streaming text embed
 * @param text - Streaming text content
 * @param toolsUsed - Number of tools used
 * @returns Streaming text embed
 */
export function buildStreamingTextEmbed(
  text: string,
  toolsUsed: number,
): APIEmbed {
  return {
    color: COLORS.Running,
    author: { name: '💬 Responding...' },
    description: truncate(text, 4000),
    footer: { text: `🔧 Used ${toolsUsed} tools` },
    timestamp: new Date().toISOString(),
  };
}

// ─── Stop Preview Embed ─────────────────────────────────

/**
 * Build a stop preview embed (shows progress summary before confirmation)
 * @param session - Current session state
 * @param durationMs - Elapsed time in milliseconds
 * @returns Stop preview embed
 */
export function buildStopPreviewEmbed(
  session: SessionState,
  durationMs: number,
): APIEmbed {
  const toolList = Object.entries(session.tools)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${TOOL_EMOJI[name] || '🔧'} ${name}: **${count}**`)
    .join('\n');

  const statusName = SESSION_STATUS_NAMES[session.status];

  return {
    color: COLORS.Notification,
    author: { name: '⚠️ Confirm Stop' },
    title: 'Are you sure you want to stop this task?',
    description: truncate(session.promptText, 200),
    fields: [
      { name: 'Current Status', value: statusName, inline: true },
      { name: 'Duration', value: formatDuration(durationMs), inline: true },
      {
        name: `Tool Stats (${session.toolCount} total)`,
        value: toolList || 'None',
        inline: false,
      },
    ],
    timestamp: new Date().toISOString(),
  };
}

// ─── Result Embed ─────────────────────────────────────

/**
 * Build a task completion result embed
 * @param resultText - Task completion result text
 * @param stats - Tool usage statistics (count and per-tool counts)
 * @param usage - Optional token usage
 * @param durationMs - Optional duration in milliseconds
 * @param costUsd - Optional cost in USD
 * @returns Task completion result embed
 */
export function buildResultEmbed(
  resultText: string,
  stats: { toolCount: number; tools: Record<string, number> },
  usage?: TokenUsage,
  durationMs?: number,
  costUsd?: number,
): APIEmbed {
  const toolList = Object.entries(stats.tools)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => `${TOOL_EMOJI[name] || '🔧'} ${name}: **${count}**`)
    .join('\n');

  const fields: APIEmbed['fields'] = [
    {
      name: `📊 Tool Stats (${stats.toolCount} total)`,
      value: toolList || 'None',
      inline: true,
    },
  ];

  if (usage) {
    fields.push({
      name: '🪙 Token Usage',
      value: [
        `Input: **${formatNumber(usage.input)}**`,
        `Output: **${formatNumber(usage.output)}**`,
        `Total: **${formatNumber(usage.total)}**`,
      ].join('\n'),
      inline: true,
    });

    if (usage.cacheRead > 0 || usage.cacheWrite > 0) {
      fields.push({
        name: '♻️ Cache',
        value: [
          usage.cacheRead > 0 ? `Read: ${formatNumber(usage.cacheRead)}` : null,
          usage.cacheWrite > 0 ? `Write: ${formatNumber(usage.cacheWrite)}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        inline: true,
      });
    }
  }

  if (durationMs !== undefined) {
    fields.push({
      name: '⏱️ Duration',
      value: formatDuration(durationMs),
      inline: true,
    });
  }

  if (costUsd !== undefined) {
    fields.push({
      name: '💰 Cost',
      value: formatCost(costUsd),
      inline: true,
    });
  }

  return {
    color: COLORS.Stop,
    author: { name: '🏁 Task Complete' },
    title: 'Claude Code task completed',
    description: resultText ? truncate(resultText, 4000) : undefined,
    fields,
    timestamp: new Date().toISOString(),
  };
}

// ─── Error Embed ─────────────────────────────────────

/**
 * Build an error embed
 * @param error - Error message
 * @param context - Optional error context description
 * @returns Error embed
 */
export function buildErrorEmbed(error: string, context?: string): APIEmbed {
  return {
    color: COLORS.Error,
    author: { name: '❌ Error' },
    title: 'Execution Error',
    description: truncate(error, 4000),
    fields: context
      ? [{ name: 'Context', value: truncate(context, 1024), inline: false }]
      : undefined,
    timestamp: new Date().toISOString(),
  };
}

// ─── Status Embed ─────────────────────────────────────

/**
 * Build a session status embed
 * @param session - Session state, or null to show no active session
 * @param sessionUsage - Optional session token usage record
 * @returns Session status embed
 */
export function buildStatusEmbed(
  session: SessionState | null,
  sessionUsage?: SessionUsageRecord,
): APIEmbed {
  if (!session) {
    return {
      color: COLORS.Info,
      author: { name: 'ℹ️ Status' },
      title: 'No Active Session',
      description: 'No tasks running. Use `/prompt` to start a new task.',
      timestamp: new Date().toISOString(),
    };
  }

  const elapsed = Date.now() - session.startedAt.getTime();
  const statusName = SESSION_STATUS_NAMES[session.status];

  const toolList = Object.entries(session.tools)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${TOOL_EMOJI[name] || '🔧'} ${name}: **${count}**`)
    .join('\n');

  const fields: APIEmbed['fields'] = [
    { name: 'Working Directory', value: `\`${session.cwd}\``, inline: true },
    { name: 'Model', value: session.model, inline: true },
    { name: 'Duration', value: formatDuration(elapsed), inline: true },
    {
      name: `Tool Stats (${session.toolCount} total)`,
      value: toolList || 'None',
      inline: false,
    },
  ];

  if (sessionUsage && sessionUsage.usage.total > 0) {
    fields.push({
      name: '🪙 Total Tokens',
      value: [
        `Input: **${formatNumber(sessionUsage.usage.input)}**`,
        `Output: **${formatNumber(sessionUsage.usage.output)}**`,
        `Total: **${formatNumber(sessionUsage.usage.total)}**`,
      ].join('\n'),
      inline: true,
    });
    if (sessionUsage.costUsd > 0) {
      fields.push({
        name: '💰 Cost',
        value: formatCost(sessionUsage.costUsd),
        inline: true,
      });
    }
  }

  return {
    color: session.status === 'running' ? COLORS.Running : COLORS.Info,
    author: { name: `📋 Session Status — ${statusName}` },
    title: truncate(session.promptText, 100),
    fields,
    timestamp: new Date().toISOString(),
  };
}

// ─── Session Start Embed ─────────────────────────────

/**
 * Build a session start embed
 * @param promptText - User prompt text
 * @param cwd - Working directory
 * @param model - Model name
 * @returns Session start embed
 */
export function buildSessionStartEmbed(
  promptText: string,
  cwd: string,
  model: string,
): APIEmbed {
  return {
    color: COLORS.SessionStart,
    author: { name: '🚀 Session Started' },
    title: truncate(promptText, 100),
    fields: [
      { name: 'Working Directory', value: `\`${cwd}\``, inline: true },
      { name: 'Model', value: model, inline: true },
    ],
    timestamp: new Date().toISOString(),
  };
}

// ─── Stop Confirm Embed ─────────────────────────────────

/**
 * Build a stop confirmation embed
 * @param stats - Tool usage statistics (count and per-tool counts)
 * @param durationMs - Duration in milliseconds
 * @returns Stop confirmation embed
 */
export function buildStopConfirmEmbed(
  stats: { toolCount: number; tools: Record<string, number> },
  durationMs: number,
): APIEmbed {
  const toolList = Object.entries(stats.tools)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${TOOL_EMOJI[name] || '🔧'} ${name}: **${count}**`)
    .join('\n');

  return {
    color: COLORS.Error,
    author: { name: '🛑 Stopped' },
    title: 'Task manually stopped',
    fields: [
      { name: 'Duration', value: formatDuration(durationMs), inline: true },
      {
        name: `Tool Stats (${stats.toolCount} total)`,
        value: toolList || 'None',
        inline: false,
      },
    ],
    timestamp: new Date().toISOString(),
  };
}

// ─── Notification Embed ─────────────────────────────────

/**
 * Build a notification embed
 * @param message - Notification message content
 * @returns Notification embed
 */
export function buildNotificationEmbed(message: string): APIEmbed {
  return {
    color: COLORS.Notification,
    author: { name: '🔔 Notification' },
    description: message,
    timestamp: new Date().toISOString(),
  };
}

// ─── Follow-up Embed ─────────────────────────────────

/**
 * Build a follow-up confirmation embed
 * @param promptText - Follow-up prompt text
 * @param fileCount - Number of attached files
 * @param filenames - List of attached file names
 * @returns Follow-up confirmation embed
 */
export function buildFollowUpEmbed(promptText: string, fileCount = 0, filenames: string[] = []): APIEmbed {
  let description = truncate(promptText, 3900);

  if (fileCount > 0) {
    const fileList = filenames.length > 0
      ? filenames.map((f) => `\`${f}\``).join(', ')
      : `${fileCount} files`;
    description += `\n\n📎 ${fileList}`;
  }

  return {
    color: COLORS.SessionStart,
    author: { name: '💬 Follow-up' },
    title: 'Processing follow-up...',
    description: truncate(description, 4000),
    timestamp: new Date().toISOString(),
  };
}

// ─── Waiting Input Embed ─────────────────────────────────

/**
 * Build a waiting for input embed
 * @returns Waiting for input embed
 */
export function buildWaitingInputEmbed(): APIEmbed {
  return {
    color: COLORS.WaitingInput,
    author: { name: '⏸️ Waiting for Input' },
    title: 'Task completed, waiting for follow-up',
    description: 'Type a message in this thread to continue. Use `/stop` to end.',
    timestamp: new Date().toISOString(),
  };
}

// ─── Multi-Session Status Summary Embed ─────────────────────

/**
 * Build a multi-session status summary embed
 * @param sessions - Map of all active sessions (keyed by threadId)
 * @returns Multi-session status summary embed
 */
export function buildMultiStatusEmbed(
  sessions: Map<string, SessionState>,
): APIEmbed {
  const entries = Array.from(sessions.entries());
  const description = entries
    .map(([threadId, s]) => {
      const statusName = SESSION_STATUS_NAMES[s.status];
      const elapsed = Date.now() - s.startedAt.getTime();
      return `**<#${threadId}>** — ${statusName}\n${truncate(s.promptText, 60)} • ${formatDuration(elapsed)} • 🔧 ${s.toolCount}`;
    })
    .join('\n\n');

  return {
    color: COLORS.Running,
    author: { name: `📋 Active Sessions (${entries.length})` },
    description: truncate(description, 4000),
    timestamp: new Date().toISOString(),
  };
}

// ─── Global Status Embed ─────────────────────────────────

/**
 * Build a global bot status embed (shown when /status is used outside a thread)
 * @param stats - Global usage statistics
 * @param activeSessions - Map of all active sessions (keyed by threadId)
 * @param userUsage - Optional per-user usage records
 * @returns Global bot status embed
 */
export function buildGlobalStatusEmbed(
  stats: GlobalUsageStats,
  activeSessions: Map<string, SessionState>,
  userUsage?: Map<string, UserUsageRecord>,
): APIEmbed {
  const uptime = Date.now() - stats.bootedAt.getTime();

  const fields: APIEmbed['fields'] = [
    { name: '⏱️ Uptime', value: formatDuration(uptime), inline: true },
    { name: '📊 Total Sessions', value: `${stats.totalSessions}`, inline: true },
    { name: '🔄 Active Sessions', value: `${activeSessions.size}`, inline: true },
  ];

  if (stats.totalUsage.total > 0) {
    fields.push({
      name: '🪙 Total Tokens',
      value: [
        `Input: **${formatNumber(stats.totalUsage.input)}**`,
        `Output: **${formatNumber(stats.totalUsage.output)}**`,
        `Total: **${formatNumber(stats.totalUsage.total)}**`,
      ].join('\n'),
      inline: true,
    });
  }

  if (stats.totalCostUsd > 0) {
    fields.push({
      name: '💰 Total Cost',
      value: formatCost(stats.totalCostUsd),
      inline: true,
    });
  }

  // Per-user usage breakdown
  if (userUsage && userUsage.size > 0) {
    const userSummary = Array.from(userUsage.entries())
      .sort((a, b) => b[1].costUsd - a[1].costUsd)
      .map(([userId, record]) => {
        const parts = [`<@${userId}>`];
        parts.push(`${formatNumber(record.usage.total)} tokens`);
        if (record.costUsd > 0) parts.push(formatCost(record.costUsd));
        parts.push(`${record.totalQueries} queries`);
        return parts.join(' · ');
      })
      .join('\n');
    fields.push({
      name: `👤 Per-User Usage (${userUsage.size})`,
      value: truncate(userSummary, 1024),
      inline: false,
    });
  }

  if (activeSessions.size > 0) {
    const sessionSummary = Array.from(activeSessions.entries())
      .map(([threadId, s]) => {
        const statusName = SESSION_STATUS_NAMES[s.status];
        return `<#${threadId}> — ${statusName}`;
      })
      .join('\n');
    fields.push({
      name: `Active Sessions (${activeSessions.size})`,
      value: truncate(sessionSummary, 1024),
      inline: false,
    });
  }

  return {
    color: COLORS.Info,
    author: { name: '📋 Bot Status' },
    title: 'Discord Claude Bot',
    fields,
    timestamp: new Date().toISOString(),
  };
}

// ─── Retry Embed ─────────────────────────────────────

/**
 * Build a retry confirmation embed
 * @param promptText - Retry prompt text
 * @returns Retry confirmation embed
 */
export function buildRetryEmbed(promptText: string): APIEmbed {
  return {
    color: COLORS.SessionStart,
    author: { name: '🔄 Retry' },
    title: 'Retrying task',
    description: truncate(promptText, 4000),
    timestamp: new Date().toISOString(),
  };
}

// ─── AskUserQuestion Embed ──────────────────────────

/**
 * Build an AskUserQuestion embed (displays questions and options)
 * @param toolInput - Tool input parameters (containing questions array)
 * @param _cwd - Working directory (reserved parameter, unused)
 * @returns AskUserQuestion embed
 */
export function buildAskUserQuestionEmbed(
  toolInput: Record<string, unknown>,
  _cwd: string,
): APIEmbed {
  const questions = toolInput.questions as Array<{
    question?: string;
    header?: string;
    options?: Array<{ label?: string; description?: string }>;
  }> | undefined;

  if (!questions || questions.length === 0) {
    return {
      color: COLORS.Permission,
      author: { name: '❓ Claude Question' },
      title: 'Waiting for user response',
      timestamp: new Date().toISOString(),
    };
  }

  const description = questions
    .map((q) => {
      const header = q.header ? `**${q.header}**` : '';
      const question = q.question || '';
      const options = q.options
        ?.map((o, j) => `> ${j + 1}. **${o.label}**${o.description ? ` — ${o.description}` : ''}`)
        .join('\n') || '';
      return `${header}${header && question ? '\n' : ''}${question}${options ? `\n${options}` : ''}`;
    })
    .join('\n\n');

  return {
    color: COLORS.Permission,
    author: { name: '❓ Claude Question' },
    title: 'Select an option below',
    description: truncate(description, 4000),
    footer: { text: 'Click a button to select, or click "Other" for a custom answer' },
    timestamp: new Date().toISOString(),
  };
}

// ─── AskUserQuestion Step Embed ─────────────────

/**
 * Build a single question step embed (displayed one at a time, with progress indicator and answered summary)
 * @param askState - Current ask state (containing question list, answered content, progress)
 * @returns Single question step embed
 */
export function buildAskQuestionStepEmbed(askState: AskState): APIEmbed {
  const { currentQuestionIndex, totalQuestions, questions, collectedAnswers } = askState;
  const q = questions[currentQuestionIndex];

  const progressText = totalQuestions > 1
    ? `Question ${currentQuestionIndex + 1}/${totalQuestions}`
    : '';

  const header = q.header ? `**${q.header}**` : '';
  const questionText = q.question || '';
  const optionsList = q.options
    ?.map((o, j) => `> ${j + 1}. **${o.label}**${o.description ? ` — ${o.description}` : ''}`)
    .join('\n') || '';

  const questionBlock = [header, questionText, optionsList].filter(Boolean).join('\n');

  // Answered questions summary
  const answeredEntries = Object.entries(collectedAnswers);
  const answeredSummary = answeredEntries.length > 0
    ? answeredEntries
        .map(([idx, answer]) => {
          const answeredQ = questions[parseInt(idx, 10)];
          return `${answeredQ?.header || `Question ${parseInt(idx, 10) + 1}`}: **${answer}**`;
        })
        .join('\n')
    : '';

  const description = answeredSummary
    ? `${answeredSummary}\n\n---\n\n${questionBlock}`
    : questionBlock;

  const footerText = q.multiSelect
    ? 'Select options then click "Submit" to confirm, or click "Other" for a custom answer'
    : 'Click a button to select, or click "Other" for a custom answer';

  return {
    color: COLORS.Permission,
    author: { name: `❓ Claude Question${progressText ? ` — ${progressText}` : ''}` },
    title: q.header || 'Select an option below',
    description: truncate(description, 4000),
    footer: { text: footerText },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build a summary embed for when all questions have been answered
 * @param askState - Completed ask state (containing all answered content)
 * @returns Answered summary embed
 */
export function buildAskCompletedEmbed(askState: AskState): APIEmbed {
  const summary = Object.entries(askState.collectedAnswers)
    .map(([idx, answer]) => {
      const q = askState.questions[parseInt(idx, 10)];
      return `**${q?.header || `Question ${parseInt(idx, 10) + 1}`}**: ${answer}`;
    })
    .join('\n');

  return {
    color: COLORS.WaitingInput,
    author: { name: '✅ All questions answered' },
    description: summary,
    timestamp: new Date().toISOString(),
  };
}

// ─── Idle Session Cleanup Embed ─────────────────────

/**
 * Build a notification embed for idle session auto-cleanup
 * @param idleMs - Duration of inactivity in milliseconds
 * @returns Idle session cleanup notification embed
 */
export function buildIdleCleanupEmbed(idleMs: number): APIEmbed {
  return {
    color: COLORS.Info,
    author: { name: '🕐 Session Timeout' },
    description: `This session was auto-archived after **${formatDuration(idleMs)}** of inactivity.\nUse \`/prompt\` to start a new session.`,
    timestamp: new Date().toISOString(),
  };
}

// ─── Orphan Thread Cleanup Embed ─────────────────────

/**
 * Notify orphan threads when bot restarts
 * @returns Orphan thread cleanup notification embed
 */
export function buildOrphanCleanupEmbed(): APIEmbed {
  return {
    color: COLORS.Notification,
    author: { name: '⚠️ Bot Restarted' },
    description: 'This session was interrupted. Use `/prompt` to start a new task.',
    timestamp: new Date().toISOString(),
  };
}

// ─── Queue Embeds ───────────────────────────────────

/**
 * Build a queued session notification embed
 * @param position - 1-based queue position
 * @param promptText - The prompt text
 * @param cwd - Working directory
 * @returns Queued notification embed
 */
export function buildQueuedEmbed(position: number, promptText: string, cwd: string): APIEmbed {
  return {
    color: COLORS.Info,
    author: { name: '📋 Queued' },
    title: `Position #${position} in queue`,
    description: truncate(promptText, 3900),
    fields: [
      { name: 'Working Directory', value: `\`${cwd}\``, inline: true },
      { name: 'Status', value: 'Waiting for the current session to complete', inline: false },
    ],
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build a notification embed when a queued session starts executing
 * @param promptText - The prompt text
 * @returns Queue start notification embed
 */
export function buildQueueStartEmbed(promptText: string): APIEmbed {
  return {
    color: COLORS.SessionStart,
    author: { name: '🚀 Queue → Running' },
    title: 'Your queued task is now starting',
    description: truncate(promptText, 3900),
    timestamp: new Date().toISOString(),
  };
}

// ─── Session Recovery Embed ─────────────────────────

/**
 * Build a recovery notification embed for sessions interrupted by bot restart
 * @param promptText - The original prompt text
 * @param cwd - Working directory
 * @param startedAt - ISO 8601 string of when session started
 * @returns Recovery notification embed
 */
export function buildRecoveryEmbed(promptText: string, cwd: string, startedAt: string): APIEmbed {
  const started = new Date(startedAt);
  const elapsed = Date.now() - started.getTime();

  return {
    color: COLORS.Notification,
    author: { name: '🔄 Session Interrupted' },
    title: 'Bot restarted — session was interrupted',
    description: truncate(promptText, 3900),
    fields: [
      { name: 'Working Directory', value: `\`${cwd}\``, inline: true },
      { name: 'Originally Started', value: `<t:${Math.floor(started.getTime() / 1000)}:R>`, inline: true },
      { name: 'Action', value: 'Click the **Retry** button below to re-run this prompt.', inline: false },
    ],
    timestamp: new Date().toISOString(),
  };
}

// ─── Git Summary Embed ──────────────────────────────

/**
 * Build a git diff summary embed
 * @param diff - Git diff summary data
 * @returns Git diff summary embed
 */
export function buildGitSummaryEmbed(diff: GitDiffSummary): APIEmbed {
  const fileList = diff.files
    .slice(0, 15)
    .map((f) => `\`${f.path}\` | +${f.insertions} -${f.deletions}`)
    .join('\n');

  return {
    color: COLORS.Info,
    author: { name: '📊 Git Changes' },
    title: `${diff.filesChanged} file${diff.filesChanged === 1 ? '' : 's'} changed, +${diff.insertions} -${diff.deletions}`,
    description: fileList || 'No details available',
    timestamp: new Date().toISOString(),
  };
}

// ─── Budget Warning Embed ───────────────────────────

/**
 * Build a budget warning embed
 * @param warnings - Array of budget warnings
 * @returns Budget warning embed
 */
export function buildBudgetWarningEmbed(warnings: BudgetWarning[]): APIEmbed {
  const lines = warnings.map((w) => {
    const emoji = w.percentage >= 100 ? '🚫' : '⚠️';
    return `${emoji} **${w.period}** — ${formatCost(w.spent)} / ${formatCost(w.limit)} (${w.percentage.toFixed(0)}%)`;
  });

  return {
    color: warnings.some((w) => w.percentage >= 100) ? COLORS.Error : COLORS.Notification,
    author: { name: '💰 Budget Warning' },
    description: lines.join('\n'),
    timestamp: new Date().toISOString(),
  };
}

// ─── Helpers ───────────────────────────────────────

function buildFooterText(
  model?: string,
  permissionMode?: string,
  sessionId?: string,
): string {
  const parts = [
    model ? `🤖 ${model}` : null,
    permissionMode ? `🔒 ${PERMISSION_MODE_NAMES[permissionMode] || permissionMode}` : null,
    sessionId ? `Session ${sessionId.slice(0, 8)}` : null,
  ];
  return parts.filter(Boolean).join(' • ');
}
