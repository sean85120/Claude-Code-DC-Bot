import type { TranscriptEntry } from '../types.js';

/**
 * Format transcript as Markdown text
 * @param entries - Transcript entry array
 * @returns Formatted Markdown string
 */
export function formatTranscript(entries: TranscriptEntry[]): string {
  if (entries.length === 0) return '(No records)';

  return entries
    .map((entry) => {
      const time = entry.timestamp.toISOString().slice(11, 19);
      switch (entry.type) {
        case 'user':
          return `**[${time}] User:**\n${entry.content}`;
        case 'assistant':
          return `**[${time}] Claude:**\n${entry.content}`;
        case 'tool_use':
          return `**[${time}] Tool (${entry.toolName}):**\n${entry.content}`;
        case 'result':
          return `**[${time}] Result:**\n${entry.content}`;
        case 'error':
          return `**[${time}] Error:**\n${entry.content}`;
        default:
          return `**[${time}]** ${entry.content}`;
      }
    })
    .join('\n\n');
}
