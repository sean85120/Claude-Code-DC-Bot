import { describe, it, expect } from 'vitest';
import { richMessageToBlocks, actionButtonsToSlackActions, richMessageToFallbackText } from './converter.js';
import type { RichMessage, ActionButton } from '../types.js';

describe('richMessageToBlocks', () => {
  it('converts a full RichMessage to Slack blocks', () => {
    const message: RichMessage = {
      title: 'Test Title',
      description: 'Test Description',
      author: 'Bot Author',
      footer: 'Footer text',
      fields: [
        { name: 'Field 1', value: 'Value 1', inline: true },
        { name: 'Field 2', value: 'Value 2', inline: false },
      ],
    };

    const blocks = richMessageToBlocks(message);

    // Should have: context (author), header (title), section (description), section (fields), context (footer)
    expect(blocks.length).toBeGreaterThanOrEqual(4);

    // Check author context
    const authorBlock = blocks[0];
    expect(authorBlock.type).toBe('context');

    // Check header
    const headerBlock = blocks[1];
    expect(headerBlock.type).toBe('header');

    // Check description
    const descBlock = blocks[2];
    expect(descBlock.type).toBe('section');
  });

  it('handles minimal RichMessage', () => {
    const message: RichMessage = { description: 'Just text' };
    const blocks = richMessageToBlocks(message);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('section');
  });

  it('handles empty RichMessage', () => {
    const blocks = richMessageToBlocks({});
    expect(blocks).toHaveLength(0);
  });

  it('handles timestamp in footer', () => {
    const message: RichMessage = {
      footer: 'Time',
      timestamp: '2024-01-01T00:00:00.000Z',
    };
    const blocks = richMessageToBlocks(message);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('context');
  });

  it('escapes special Slack characters', () => {
    const message: RichMessage = {
      description: 'Use <tag> & "quotes"',
    };
    const blocks = richMessageToBlocks(message);
    const section = blocks[0] as { text: { text: string } };
    expect(section.text.text).toContain('&lt;tag&gt;');
    expect(section.text.text).toContain('&amp;');
  });

  it('handles many fields by chunking', () => {
    const message: RichMessage = {
      fields: Array.from({ length: 15 }, (_, i) => ({
        name: `Field ${i}`,
        value: `Value ${i}`,
        inline: true,
      })),
    };
    const blocks = richMessageToBlocks(message);

    // 15 fields → 2 section blocks (10 + 5)
    expect(blocks).toHaveLength(2);
  });
});

describe('actionButtonsToSlackActions', () => {
  it('converts buttons to Slack actions block', () => {
    const buttons: ActionButton[] = [
      { id: 'approve:t1', label: 'Approve', style: 'success' },
      { id: 'deny:t1', label: 'Deny', style: 'danger' },
    ];

    const actions = actionButtonsToSlackActions(buttons);

    expect(actions.type).toBe('actions');
    expect(actions.elements).toHaveLength(2);
    expect(actions.elements[0].action_id).toBe('approve:t1');
    expect(actions.elements[0].style).toBe('primary'); // success maps to primary
    expect(actions.elements[1].style).toBe('danger');
  });

  it('maps secondary style to no style', () => {
    const buttons: ActionButton[] = [
      { id: 'btn1', label: 'Other', style: 'secondary' },
    ];

    const actions = actionButtonsToSlackActions(buttons);
    expect(actions.elements[0].style).toBeUndefined();
  });
});

describe('richMessageToFallbackText', () => {
  it('creates fallback text from RichMessage', () => {
    const message: RichMessage = {
      author: 'Bot',
      title: 'Title',
      description: 'Description',
      fields: [{ name: 'Key', value: 'Value', inline: true }],
      footer: 'Footer',
    };

    const text = richMessageToFallbackText(message);

    expect(text).toContain('*Bot*');
    expect(text).toContain('*Title*');
    expect(text).toContain('Description');
    expect(text).toContain('*Key:* Value');
    expect(text).toContain('_Footer_');
  });

  it('returns "Message" for empty RichMessage', () => {
    expect(richMessageToFallbackText({})).toBe('Message');
  });
});
