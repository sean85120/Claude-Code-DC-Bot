import { describe, it, expect } from 'vitest';
import { extractAssistantText, extractToolUse, extractResult } from './message-parser.js';

// Simulated SDK message types (to avoid depending on SDK internal structure)

describe('extractAssistantText', () => {
  it('extracts text blocks', () => {
    const message = {
      type: 'assistant' as const,
      message: {
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: 'World' },
        ],
      },
    };
    expect(extractAssistantText(message as any)).toBe('Hello\nWorld');
  });

  it('ignores non-text blocks', () => {
    const message = {
      type: 'assistant' as const,
      message: {
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'tool_use', name: 'Read', input: {}, id: 'id1' },
        ],
      },
    };
    expect(extractAssistantText(message as any)).toBe('Hello');
  });

  it('returns empty string when content is undefined', () => {
    const message = { type: 'assistant' as const, message: {} };
    expect(extractAssistantText(message as any)).toBe('');
  });

  it('returns empty string when message is undefined', () => {
    const message = { type: 'assistant' as const };
    expect(extractAssistantText(message as any)).toBe('');
  });

  it('returns empty string when content is not an array', () => {
    const message = { type: 'assistant' as const, message: { content: 'string' } };
    expect(extractAssistantText(message as any)).toBe('');
  });

  it('returns empty string for empty content array', () => {
    const message = { type: 'assistant' as const, message: { content: [] } };
    expect(extractAssistantText(message as any)).toBe('');
  });
});

describe('extractToolUse', () => {
  it('extracts tool calls', () => {
    const message = {
      type: 'assistant' as const,
      message: {
        content: [
          { type: 'tool_use', name: 'Read', input: { file_path: '/test.ts' }, id: 'tool-1' },
          { type: 'tool_use', name: 'Bash', input: { command: 'ls' }, id: 'tool-2' },
        ],
      },
    };
    const tools = extractToolUse(message as any);
    expect(tools).toHaveLength(2);
    expect(tools[0].toolName).toBe('Read');
    expect(tools[0].toolInput).toEqual({ file_path: '/test.ts' });
    expect(tools[0].toolUseId).toBe('tool-1');
    expect(tools[1].toolName).toBe('Bash');
  });

  it('returns empty array when there are no tool calls', () => {
    const message = {
      type: 'assistant' as const,
      message: { content: [{ type: 'text', text: 'just text' }] },
    };
    expect(extractToolUse(message as any)).toEqual([]);
  });

  it('returns empty array when content is undefined', () => {
    const message = { type: 'assistant' as const, message: {} };
    expect(extractToolUse(message as any)).toEqual([]);
  });
});

describe('extractResult', () => {
  it('extracts successful result', () => {
    const message = {
      type: 'result' as const,
      subtype: 'success',
      result: 'Task completed',
      duration_ms: 5000,
      total_cost_usd: 0.05,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 10,
      },
    };
    const result = extractResult(message as any);
    expect(result.success).toBe(true);
    expect(result.text).toBe('Task completed');
    expect(result.durationMs).toBe(5000);
    expect(result.costUsd).toBe(0.05);
    expect(result.usage.input_tokens).toBe(100);
  });

  it('extracts failure result', () => {
    const message = {
      type: 'result' as const,
      subtype: 'error',
      errors: ['error1', 'error2'],
      duration_ms: 1000,
      total_cost_usd: 0.01,
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    const result = extractResult(message as any);
    expect(result.success).toBe(false);
    expect(result.text).toBe('error1\nerror2');
  });

  it('uses default message when failure has no errors', () => {
    const message = {
      type: 'result' as const,
      subtype: 'error',
      duration_ms: 0,
      total_cost_usd: 0,
      usage: {},
    };
    const result = extractResult(message as any);
    expect(result.success).toBe(false);
    expect(result.text).toContain('error');
  });

  it('returns empty string when success has no result', () => {
    const message = {
      type: 'result' as const,
      subtype: 'success',
      duration_ms: 0,
      total_cost_usd: 0,
      usage: {},
    };
    const result = extractResult(message as any);
    expect(result.success).toBe(true);
    expect(result.text).toBe('');
  });

  it('defaults usage fields to 0 when missing', () => {
    const message = {
      type: 'result' as const,
      subtype: 'success',
      result: 'ok',
      duration_ms: 0,
      total_cost_usd: 0,
      usage: {},
    };
    const result = extractResult(message as any);
    expect(result.usage.input_tokens).toBe(0);
    expect(result.usage.output_tokens).toBe(0);
    expect(result.usage.cache_read_input_tokens).toBe(0);
    expect(result.usage.cache_creation_input_tokens).toBe(0);
  });
});
