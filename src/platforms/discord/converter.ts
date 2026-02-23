import {
  type APIEmbed,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} from 'discord.js';
import type { RichMessage, ActionButton } from '../types.js';

/**
 * Convert a platform-agnostic RichMessage to a Discord APIEmbed
 */
export function richMessageToEmbed(message: RichMessage): APIEmbed {
  return {
    color: message.color,
    author: message.author ? { name: message.author } : undefined,
    title: message.title,
    description: message.description,
    fields: message.fields,
    footer: message.footer ? { text: message.footer } : undefined,
    timestamp: message.timestamp,
  };
}

/**
 * Convert a Discord APIEmbed to a platform-agnostic RichMessage
 */
export function embedToRichMessage(embed: APIEmbed): RichMessage {
  return {
    color: embed.color,
    author: embed.author?.name,
    title: embed.title,
    description: embed.description,
    fields: embed.fields?.map((f) => ({
      name: f.name,
      value: f.value,
      inline: f.inline ?? false,
    })),
    footer: embed.footer?.text,
    timestamp: embed.timestamp,
  };
}

/** Map platform button style to Discord ButtonStyle */
function mapButtonStyle(style: ActionButton['style']): ButtonStyle {
  switch (style) {
    case 'primary':
      return ButtonStyle.Primary;
    case 'success':
      return ButtonStyle.Success;
    case 'danger':
      return ButtonStyle.Danger;
    case 'secondary':
      return ButtonStyle.Secondary;
    default:
      return ButtonStyle.Primary;
  }
}

/**
 * Convert platform-agnostic ActionButtons to a Discord ActionRow
 */
export function actionButtonsToRows(buttons: ActionButton[]): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let currentRow = new ActionRowBuilder<ButtonBuilder>();

  for (const button of buttons) {
    if (currentRow.components.length >= 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder<ButtonBuilder>();
    }

    const btn = new ButtonBuilder()
      .setCustomId(button.id)
      .setLabel(button.label)
      .setStyle(mapButtonStyle(button.style));

    if (button.emoji) {
      btn.setEmoji(button.emoji);
    }

    currentRow.addComponents(btn);
  }

  if (currentRow.components.length > 0) {
    rows.push(currentRow);
  }

  return rows.slice(0, 5);
}
