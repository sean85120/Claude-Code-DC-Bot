import type { RichMessage, ActionButton } from '../types.js';

/**
 * Convert a RichMessage into WhatsApp-formatted plain text
 * Uses WhatsApp's basic formatting: *bold*, _italic_, ~strikethrough~, ```monospace```
 */
export function richMessageToText(message: RichMessage): string {
  const parts: string[] = [];

  if (message.author) {
    parts.push(`*${message.author}*`);
  }

  if (message.title) {
    parts.push(`*${message.title}*`);
  }

  if (message.description) {
    parts.push(message.description);
  }

  if (message.fields && message.fields.length > 0) {
    const fieldLines = message.fields.map((f) => `*${f.name}:* ${f.value}`);
    parts.push(fieldLines.join('\n'));
  }

  if (message.footer) {
    parts.push(`_${message.footer}_`);
  }

  return parts.join('\n\n') || 'Message';
}

/**
 * Format action buttons as a numbered list for WhatsApp
 * Users reply with the number to select an option
 */
export function actionButtonsToNumberedList(buttons: ActionButton[]): string {
  const lines = buttons.map((btn, i) => `*${i + 1}.* ${btn.label}`);
  lines.push('');
  lines.push('_Reply with a number to select._');
  return lines.join('\n');
}

/**
 * Parse a user reply as a numbered selection from buttons
 * Returns the 0-based index, or -1 if not a valid selection
 */
export function parseNumberedReply(text: string, buttonCount: number): number {
  const trimmed = text.trim();

  // Try parsing as a number
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && num >= 1 && num <= buttonCount) {
    return num - 1;
  }

  // Try matching common approval/denial words.
  // Convention: buttons are ordered [Approve, Always Allow, Deny] — index 0 is approve,
  // last index is deny. This matches the button order in permission-handler.ts.
  const lower = trimmed.toLowerCase();
  if (lower === 'approve' || lower === 'yes' || lower === 'y') return 0;
  if (lower === 'deny' || lower === 'no' || lower === 'n') {
    return buttonCount - 1;
  }

  return -1;
}

/**
 * Parse text as a command (e.g., "/prompt hello world")
 * Returns { command, args } or null if not a command
 */
export function parseTextCommand(text: string): { command: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;

  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx < 0) {
    return { command: trimmed.slice(1).toLowerCase(), args: '' };
  }

  return {
    command: trimmed.slice(1, spaceIdx).toLowerCase(),
    args: trimmed.slice(spaceIdx + 1).trim(),
  };
}
