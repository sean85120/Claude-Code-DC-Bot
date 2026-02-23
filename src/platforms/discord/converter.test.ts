import { describe, it, expect } from 'vitest';
import { richMessageToEmbed, embedToRichMessage, actionButtonsToRows } from './converter.js';
import type { RichMessage, ActionButton } from '../types.js';

describe('richMessageToEmbed', () => {
  it('converts a full RichMessage to APIEmbed', () => {
    const message: RichMessage = {
      title: 'Test Title',
      description: 'Test Description',
      color: 0x00ff00,
      author: 'Bot Author',
      footer: 'Footer text',
      timestamp: '2024-01-01T00:00:00.000Z',
      fields: [
        { name: 'Field 1', value: 'Value 1', inline: true },
        { name: 'Field 2', value: 'Value 2', inline: false },
      ],
    };

    const embed = richMessageToEmbed(message);

    expect(embed.title).toBe('Test Title');
    expect(embed.description).toBe('Test Description');
    expect(embed.color).toBe(0x00ff00);
    expect(embed.author).toEqual({ name: 'Bot Author' });
    expect(embed.footer).toEqual({ text: 'Footer text' });
    expect(embed.timestamp).toBe('2024-01-01T00:00:00.000Z');
    expect(embed.fields).toHaveLength(2);
    expect(embed.fields?.[0]).toEqual({ name: 'Field 1', value: 'Value 1', inline: true });
  });

  it('handles minimal RichMessage', () => {
    const message: RichMessage = { description: 'Just a description' };
    const embed = richMessageToEmbed(message);

    expect(embed.description).toBe('Just a description');
    expect(embed.author).toBeUndefined();
    expect(embed.footer).toBeUndefined();
    expect(embed.fields).toBeUndefined();
  });

  it('handles empty RichMessage', () => {
    const embed = richMessageToEmbed({});
    expect(embed).toBeDefined();
  });
});

describe('embedToRichMessage', () => {
  it('converts an APIEmbed to RichMessage', () => {
    const embed = {
      title: 'Title',
      description: 'Desc',
      color: 0xff0000,
      author: { name: 'Author' },
      footer: { text: 'Footer' },
      timestamp: '2024-01-01T00:00:00.000Z',
      fields: [{ name: 'F1', value: 'V1', inline: true }],
    };

    const message = embedToRichMessage(embed);

    expect(message.title).toBe('Title');
    expect(message.description).toBe('Desc');
    expect(message.color).toBe(0xff0000);
    expect(message.author).toBe('Author');
    expect(message.footer).toBe('Footer');
    expect(message.fields?.[0]).toEqual({ name: 'F1', value: 'V1', inline: true });
  });

  it('roundtrips correctly', () => {
    const original: RichMessage = {
      title: 'Roundtrip',
      description: 'Test',
      color: 0x0000ff,
      author: 'Author',
      footer: 'Footer',
      fields: [{ name: 'Key', value: 'Val', inline: false }],
    };

    const result = embedToRichMessage(richMessageToEmbed(original));

    expect(result.title).toBe(original.title);
    expect(result.description).toBe(original.description);
    expect(result.author).toBe(original.author);
    expect(result.footer).toBe(original.footer);
  });
});

describe('actionButtonsToRows', () => {
  it('converts buttons to Discord ActionRows', () => {
    const buttons: ActionButton[] = [
      { id: 'btn1', label: 'Approve', style: 'success', emoji: '✅' },
      { id: 'btn2', label: 'Deny', style: 'danger', emoji: '❌' },
    ];

    const rows = actionButtonsToRows(buttons);

    expect(rows).toHaveLength(1);
    expect(rows[0].components).toHaveLength(2);
  });

  it('splits into multiple rows for >5 buttons', () => {
    const buttons: ActionButton[] = Array.from({ length: 7 }, (_, i) => ({
      id: `btn${i}`,
      label: `Button ${i}`,
      style: 'primary' as const,
    }));

    const rows = actionButtonsToRows(buttons);

    expect(rows).toHaveLength(2);
    expect(rows[0].components).toHaveLength(5);
    expect(rows[1].components).toHaveLength(2);
  });

  it('handles empty buttons', () => {
    const rows = actionButtonsToRows([]);
    expect(rows).toHaveLength(0);
  });
});
