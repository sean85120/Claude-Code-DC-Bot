import { truncate, getRelativePath, formatNumber } from './formatters.js';
import { generateUnifiedDiff, truncateDiff, diffSummary } from './diff-utils.js';
import type { ToolDisplayInfo } from '../types.js';

/**
 * Convert tool name and input into a display-ready structure
 * @param toolName - Tool name
 * @param toolInput - Tool input parameters
 * @param cwd - Working directory
 * @returns Formatted tool display information
 */
export function formatToolInput(
  toolName: string,
  toolInput: Record<string, unknown>,
  cwd: string,
): ToolDisplayInfo {
  switch (toolName) {
    case 'Read':
      return formatRead(toolInput, cwd);
    case 'Write':
      return formatWrite(toolInput, cwd);
    case 'Edit':
      return formatEdit(toolInput, cwd);
    case 'Bash':
      return formatBash(toolInput);
    case 'Glob':
      return formatGlob(toolInput, cwd);
    case 'Grep':
      return formatGrep(toolInput, cwd);
    case 'WebFetch':
      return formatWebFetch(toolInput);
    case 'WebSearch':
      return formatWebSearch(toolInput);
    case 'Task':
      return formatTask(toolInput);
    case 'AskUser':
    case 'AskUserQuestion':
      return formatAskUserQuestion(toolInput);
    default:
      return formatDefault(toolName, toolInput);
  }
}

function formatRead(input: Record<string, unknown>, cwd: string): ToolDisplayInfo {
  const relativePath = getRelativePath(input.file_path as string, cwd);
  const result: ToolDisplayInfo = {
    title: 'Read File',
    description: `\`\`\`\n${relativePath}\n\`\`\``,
  };

  if (input.offset || input.limit) {
    result.fields = [
      {
        name: 'Range',
        value: `From line ${input.offset ?? 1}, ${input.limit ?? 'all'} lines`,
        inline: true,
      },
    ];
  }

  return result;
}

function formatWrite(input: Record<string, unknown>, cwd: string): ToolDisplayInfo {
  const relativePath = getRelativePath(input.file_path as string, cwd);
  const content = input.content as string | undefined;
  const result: ToolDisplayInfo = {
    title: 'Write File',
    description: `\`\`\`\n${relativePath}\n\`\`\``,
  };

  if (content) {
    const lines = content.split('\n').length;
    const chars = content.length;
    const preview = truncate(content, 300);
    result.fields = [
      {
        name: 'Content Size',
        value: `${lines} lines / ${formatNumber(chars)} characters`,
        inline: true,
      },
      {
        name: '📄 Preview',
        value: `\`\`\`\n${preview}\n\`\`\``,
        inline: false,
      },
    ];
  }

  return result;
}

function formatEdit(input: Record<string, unknown>, cwd: string): ToolDisplayInfo {
  const relativePath = getRelativePath(input.file_path as string, cwd);
  const oldString = input.old_string as string | undefined;
  const newString = input.new_string as string | undefined;
  const result: ToolDisplayInfo = {
    title: 'Edit File',
    description: `\`\`\`\n${relativePath}\n\`\`\``,
  };

  if (oldString !== undefined && newString !== undefined) {
    const diff = generateUnifiedDiff(oldString, newString, relativePath, 3);
    if (diff) {
      const truncated = truncateDiff(diff, 900);
      // Strip the header lines (--- and +++) since the file path is already in the description
      const headerless = truncated.split('\n').filter((l) => !l.startsWith('--- ') && !l.startsWith('+++ ')).join('\n');

      result.fields = [
        {
          name: '📝 Changes',
          value: `\`\`\`diff\n${headerless}\n\`\`\``,
          inline: false,
        },
        {
          name: '📊 Summary',
          value: diffSummary(oldString, newString),
          inline: true,
        },
      ];
    }
  } else if (newString) {
    // New content only (old_string is empty/undefined)
    result.fields = [
      {
        name: '🟢 New Content',
        value: `\`\`\`\n${truncate(newString, 900)}\n\`\`\``,
        inline: false,
      },
    ];
  }

  return result;
}

function formatBash(input: Record<string, unknown>): ToolDisplayInfo {
  const result: ToolDisplayInfo = {
    title: 'Run Command',
    description: `\`\`\`bash\n${truncate(input.command as string, 500)}\n\`\`\``,
  };

  if (input.description) {
    result.fields = [
      {
        name: 'Description',
        value: truncate(input.description as string, 1024),
        inline: false,
      },
    ];
  }

  return result;
}

function formatGlob(input: Record<string, unknown>, cwd: string): ToolDisplayInfo {
  const result: ToolDisplayInfo = {
    title: 'Search Files',
    description: `Pattern: \`${input.pattern}\``,
  };

  if (input.path) {
    result.fields = [
      {
        name: 'Path',
        value: `\`${getRelativePath(input.path as string, cwd)}\``,
        inline: true,
      },
    ];
  }

  return result;
}

function formatGrep(input: Record<string, unknown>, cwd: string): ToolDisplayInfo {
  const result: ToolDisplayInfo = {
    title: 'Search Content',
    description: `Pattern: \`${input.pattern}\``,
    fields: [],
  };

  if (input.path) {
    result.fields!.push({
      name: 'Path',
      value: `\`${getRelativePath(input.path as string, cwd)}\``,
      inline: true,
    });
  }

  if (input.glob) {
    result.fields!.push({
      name: 'File Filter',
      value: `\`${input.glob}\``,
      inline: true,
    });
  }

  return result;
}

function formatWebFetch(input: Record<string, unknown>): ToolDisplayInfo {
  const result: ToolDisplayInfo = {
    title: 'Fetch Web Page',
    description: input.url as string,
  };

  if (input.prompt) {
    result.fields = [
      {
        name: 'Prompt',
        value: truncate(input.prompt as string, 200),
        inline: false,
      },
    ];
  }

  return result;
}

function formatWebSearch(input: Record<string, unknown>): ToolDisplayInfo {
  return {
    title: 'Web Search',
    description: `\`${input.query}\``,
  };
}

function formatTask(input: Record<string, unknown>): ToolDisplayInfo {
  return {
    title: 'Launch Subtask',
    description: (input.description as string) || 'Execute subtask',
    fields: [
      {
        name: 'Type',
        value: `\`${(input.subagent_type as string) || 'Unknown'}\``,
        inline: true,
      },
    ],
  };
}

function formatAskUserQuestion(input: Record<string, unknown>): ToolDisplayInfo {
  const questions = input.questions as Array<{
    question?: string;
    header?: string;
    options?: Array<{ label?: string; description?: string }>;
  }> | undefined;

  if (!questions || questions.length === 0) {
    return { title: 'Ask User', description: 'Waiting for user response' };
  }

  const description = questions
    .map((q) => {
      const header = q.header ? `**${q.header}**\n` : '';
      const question = q.question || '';
      const options = q.options
        ?.map((o) => `- ${o.label}${o.description ? `：${o.description}` : ''}`)
        .join('\n') || '';
      return `${header}${question}${options ? `\n${options}` : ''}`;
    })
    .join('\n\n');

  return {
    title: 'Ask User',
    description: truncate(description, 4000),
  };
}

function formatDefault(toolName: string, input: Record<string, unknown>): ToolDisplayInfo {
  const keys = Object.keys(input).slice(0, 3);
  const description =
    keys.length > 0
      ? keys.map((k) => {
          const val = input[k];
          const display = typeof val === 'object' && val !== null
            ? truncate(JSON.stringify(val), 50)
            : truncate(String(val), 50);
          return `**${k}**: \`${display}\``;
        }).join('\n')
      : toolName;

  return {
    title: toolName,
    description,
  };
}
