import type { KnownBlock, Button, ActionsBlock } from '@slack/types';
import type { RichMessage, ActionButton } from '../types.js';

/**
 * Convert a RichMessage into Slack Block Kit blocks
 */
export function richMessageToBlocks(message: RichMessage): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  // Author line as context block
  if (message.author) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `*${escapeSlack(message.author)}*` }],
    });
  }

  // Title as header
  if (message.title) {
    blocks.push({
      type: 'header',
      text: { type: 'plain_text', text: message.title.slice(0, 150), emoji: true },
    });
  }

  // Description as section
  if (message.description) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: escapeSlack(message.description).slice(0, 3000) },
    });
  }

  // Fields
  if (message.fields && message.fields.length > 0) {
    // Slack section supports max 10 fields
    for (let i = 0; i < message.fields.length; i += 10) {
      const chunk = message.fields.slice(i, i + 10);
      blocks.push({
        type: 'section',
        fields: chunk.map((f) => ({
          type: 'mrkdwn' as const,
          text: `*${escapeSlack(f.name)}*\n${escapeSlack(f.value)}`,
        })),
      });
    }
  }

  // Footer as context
  if (message.footer || message.timestamp) {
    const parts: string[] = [];
    if (message.footer) parts.push(escapeSlack(message.footer));
    if (message.timestamp) {
      const ts = Math.floor(new Date(message.timestamp).getTime() / 1000);
      parts.push(`<!date^${ts}^{date_short_pretty} {time}|${message.timestamp}>`);
    }
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: parts.join(' | ') }],
    });
  }

  return blocks;
}

/**
 * Convert ActionButtons into a Slack actions block
 */
export function actionButtonsToSlackActions(buttons: ActionButton[]): ActionsBlock {
  const elements: Button[] = buttons.map((btn) => {
    const button: Button = {
      type: 'button',
      text: { type: 'plain_text', text: btn.label.slice(0, 75), emoji: true },
      action_id: btn.id,
      style: btn.style === 'success' ? 'primary' : btn.style === 'danger' ? 'danger' : undefined,
    };
    return button;
  });

  return {
    type: 'actions',
    elements,
  };
}

/**
 * Convert a RichMessage into a plain text fallback (for notifications)
 */
export function richMessageToFallbackText(message: RichMessage): string {
  const parts: string[] = [];
  if (message.author) parts.push(`*${message.author}*`);
  if (message.title) parts.push(`*${message.title}*`);
  if (message.description) parts.push(message.description);
  if (message.fields) {
    for (const f of message.fields) {
      parts.push(`*${f.name}:* ${f.value}`);
    }
  }
  if (message.footer) parts.push(`_${message.footer}_`);
  return parts.join('\n') || 'Message';
}

/** Escape special Slack mrkdwn characters in user content */
function escapeSlack(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
