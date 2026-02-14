import { describe, it, expect } from 'vitest';
import {
  truncate,
  getFileName,
  getRelativePath,
  formatNumber,
  chunkMessage,
  formatCodeBlock,
  formatDuration,
  formatCost,
} from './formatters.js';

describe('truncate', () => {
  it('does not truncate when shorter than limit', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates and adds ellipsis when exceeding limit', () => {
    expect(truncate('hello world', 5)).toBe('hello…');
  });

  it('returns empty string for empty string', () => {
    expect(truncate('', 10)).toBe('');
  });

  it('does not truncate when exactly at limit', () => {
    expect(truncate('12345', 5)).toBe('12345');
  });
});

describe('getFileName', () => {
  it('returns the file name', () => {
    expect(getFileName('/Users/test/file.ts')).toBe('file.ts');
  });

  it('returns unknown for empty string', () => {
    expect(getFileName('')).toBe('Unknown');
  });
});

describe('getRelativePath', () => {
  it('returns relative path when within cwd', () => {
    expect(getRelativePath('/home/user/project/src/file.ts', '/home/user/project')).toBe('src/file.ts');
  });

  it('returns full path when not within cwd', () => {
    expect(getRelativePath('/other/file.ts', '/home/user/project')).toBe('/other/file.ts');
  });

  it('returns unknown for empty string', () => {
    expect(getRelativePath('', '/home')).toBe('Unknown');
  });
});

describe('formatNumber', () => {
  it('formats with thousands separator', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('does not add separator for small numbers', () => {
    expect(formatNumber(42)).toBe('42');
  });
});

describe('chunkMessage', () => {
  it('does not split short messages', () => {
    expect(chunkMessage('hello', 100)).toEqual(['hello']);
  });

  it('splits long messages by line', () => {
    const text = 'line1\nline2\nline3';
    const chunks = chunkMessage(text, 11);
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should not exceed maxLen
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(11);
    }
  });

  it('truncates single overly long lines', () => {
    const text = 'a'.repeat(20);
    const chunks = chunkMessage(text, 10);
    expect(chunks.length).toBe(1);
    expect(chunks[0].length).toBe(10);
  });
});

describe('formatCodeBlock', () => {
  it('wraps as code block', () => {
    const result = formatCodeBlock('const x = 1;', 'ts');
    expect(result).toBe('```ts\nconst x = 1;\n```');
  });

  it('uses empty string when no language is specified', () => {
    const result = formatCodeBlock('hello');
    expect(result).toMatch(/^```\nhello\n```$/);
  });
});

describe('formatDuration', () => {
  it('milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms');
  });

  it('seconds', () => {
    expect(formatDuration(5000)).toBe('5s');
  });

  it('minutes + seconds', () => {
    expect(formatDuration(90_000)).toBe('1m 30s');
  });

  it('exact minutes', () => {
    expect(formatDuration(120_000)).toBe('2m 0s');
  });
});

describe('chunkMessage edge cases', () => {
  it('returns array containing empty string for empty string', () => {
    const chunks = chunkMessage('', 100);
    expect(chunks).toEqual(['']);
  });

  it('does not split when exactly at limit', () => {
    const text = 'a'.repeat(100);
    expect(chunkMessage(text, 100)).toEqual([text]);
  });

  it('handles multiple short lines', () => {
    const text = 'a\nb\nc\nd\ne';
    const chunks = chunkMessage(text, 3);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(3);
    }
  });

  it('handles string with only newlines', () => {
    const chunks = chunkMessage('\n\n\n', 100);
    expect(chunks).toEqual(['\n\n\n']);
  });
});

describe('truncate edge cases', () => {
  it('truncates to empty + ellipsis when maxLen = 0', () => {
    expect(truncate('hello', 0)).toBe('…');
  });

  it('keeps one character + ellipsis when maxLen = 1', () => {
    expect(truncate('hello', 1)).toBe('h…');
  });
});

describe('formatDuration edge cases', () => {
  it('0ms', () => {
    expect(formatDuration(0)).toBe('0ms');
  });

  it('shows as seconds at exactly 1000ms', () => {
    expect(formatDuration(1000)).toBe('1s');
  });

  it('shows as minutes at exactly 60000ms', () => {
    expect(formatDuration(60_000)).toBe('1m 0s');
  });
});

describe('formatCost', () => {
  it('formats USD amount', () => {
    expect(formatCost(0.1234)).toBe('$0.1234');
  });

  it('pads to four decimal places', () => {
    expect(formatCost(1)).toBe('$1.0000');
  });
});
