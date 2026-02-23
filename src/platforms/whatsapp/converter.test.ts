import { describe, it, expect } from 'vitest';
import {
  richMessageToText,
  actionButtonsToNumberedList,
  parseNumberedReply,
  parseTextCommand,
} from './converter.js';
import type { RichMessage, ActionButton } from '../types.js';

describe('richMessageToText', () => {
  it('converts a full RichMessage to WhatsApp text', () => {
    const message: RichMessage = {
      author: 'Bot',
      title: 'Title',
      description: 'Description here',
      fields: [
        { name: 'Key1', value: 'Value1', inline: true },
        { name: 'Key2', value: 'Value2', inline: false },
      ],
      footer: 'Footer text',
    };

    const text = richMessageToText(message);

    expect(text).toContain('*Bot*');
    expect(text).toContain('*Title*');
    expect(text).toContain('Description here');
    expect(text).toContain('*Key1:* Value1');
    expect(text).toContain('*Key2:* Value2');
    expect(text).toContain('_Footer text_');
  });

  it('handles minimal RichMessage', () => {
    const text = richMessageToText({ description: 'Just text' });
    expect(text).toBe('Just text');
  });

  it('returns "Message" for empty RichMessage', () => {
    expect(richMessageToText({})).toBe('Message');
  });
});

describe('actionButtonsToNumberedList', () => {
  it('formats buttons as a numbered list', () => {
    const buttons: ActionButton[] = [
      { id: 'approve:t1', label: 'Approve', style: 'success' },
      { id: 'deny:t1', label: 'Deny', style: 'danger' },
      { id: 'always:t1', label: 'Always Allow', style: 'primary' },
    ];

    const text = actionButtonsToNumberedList(buttons);

    expect(text).toContain('*1.* Approve');
    expect(text).toContain('*2.* Deny');
    expect(text).toContain('*3.* Always Allow');
    expect(text).toContain('Reply with a number');
  });
});

describe('parseNumberedReply', () => {
  it('parses valid number within range', () => {
    expect(parseNumberedReply('1', 3)).toBe(0);
    expect(parseNumberedReply('2', 3)).toBe(1);
    expect(parseNumberedReply('3', 3)).toBe(2);
  });

  it('returns -1 for out of range', () => {
    expect(parseNumberedReply('0', 3)).toBe(-1);
    expect(parseNumberedReply('4', 3)).toBe(-1);
    expect(parseNumberedReply('99', 3)).toBe(-1);
  });

  it('returns -1 for non-numeric text', () => {
    expect(parseNumberedReply('hello', 3)).toBe(-1);
    expect(parseNumberedReply('', 3)).toBe(-1);
  });

  it('handles whitespace', () => {
    expect(parseNumberedReply('  2  ', 3)).toBe(1);
  });

  it('maps approval words to first button', () => {
    expect(parseNumberedReply('approve', 3)).toBe(0);
    expect(parseNumberedReply('yes', 3)).toBe(0);
    expect(parseNumberedReply('y', 3)).toBe(0);
    expect(parseNumberedReply('YES', 3)).toBe(0);
  });

  it('maps denial words to last button', () => {
    expect(parseNumberedReply('deny', 3)).toBe(2);
    expect(parseNumberedReply('no', 3)).toBe(2);
    expect(parseNumberedReply('n', 3)).toBe(2);
    expect(parseNumberedReply('NO', 3)).toBe(2);
  });
});

describe('parseTextCommand', () => {
  it('parses a command with args', () => {
    const result = parseTextCommand('/prompt fix the bug');
    expect(result).toEqual({ command: 'prompt', args: 'fix the bug' });
  });

  it('parses a command without args', () => {
    const result = parseTextCommand('/stop');
    expect(result).toEqual({ command: 'stop', args: '' });
  });

  it('lowercases command name', () => {
    const result = parseTextCommand('/STATUS');
    expect(result).toEqual({ command: 'status', args: '' });
  });

  it('returns null for non-command text', () => {
    expect(parseTextCommand('hello')).toBeNull();
    expect(parseTextCommand('')).toBeNull();
    expect(parseTextCommand('  no slash  ')).toBeNull();
  });

  it('handles whitespace', () => {
    const result = parseTextCommand('  /prompt   some text  ');
    expect(result).toEqual({ command: 'prompt', args: 'some text' });
  });
});
