import { describe, it, expect } from 'vitest';
import { formatTranscript } from './transcript-formatter.js';
import type { TranscriptEntry } from '../types.js';

describe('formatTranscript', () => {
  it('returns default text for empty array', () => {
    expect(formatTranscript([])).toBe('(No records)');
  });

  it('formats user message', () => {
    const entries: TranscriptEntry[] = [
      { timestamp: new Date('2025-01-01T12:30:45Z'), type: 'user', content: 'hello' },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('12:30:45');
    expect(result).toContain('User');
    expect(result).toContain('hello');
  });

  it('formats assistant message', () => {
    const entries: TranscriptEntry[] = [
      { timestamp: new Date('2025-01-01T10:00:00Z'), type: 'assistant', content: 'response content' },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('Claude');
    expect(result).toContain('response content');
  });

  it('formats tool use', () => {
    const entries: TranscriptEntry[] = [
      { timestamp: new Date('2025-01-01T10:00:00Z'), type: 'tool_use', content: '{"file":"test.ts"}', toolName: 'Read' },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('Tool');
    expect(result).toContain('Read');
  });

  it('formats result', () => {
    const entries: TranscriptEntry[] = [
      { timestamp: new Date('2025-01-01T10:00:00Z'), type: 'result', content: 'done' },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('Result');
  });

  it('formats error', () => {
    const entries: TranscriptEntry[] = [
      { timestamp: new Date('2025-01-01T10:00:00Z'), type: 'error', content: 'something went wrong' },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('Error');
  });

  it('separates multiple entries with double newlines', () => {
    const entries: TranscriptEntry[] = [
      { timestamp: new Date('2025-01-01T10:00:00Z'), type: 'user', content: 'question' },
      { timestamp: new Date('2025-01-01T10:00:05Z'), type: 'assistant', content: 'answer' },
    ];
    const result = formatTranscript(entries);
    expect(result.split('\n\n').length).toBeGreaterThanOrEqual(2);
  });
});
