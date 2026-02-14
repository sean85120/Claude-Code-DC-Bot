import type { TokenUsage } from '../types.js';
import { formatNumber } from './formatters.js';

/**
 * Calculate token usage
 * @param usage - Raw token usage from SDK
 * @returns Structured token usage
 */
export function calculateTokenUsage(usage: {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}): TokenUsage {
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const total = input + output;

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total,
    costUsd: 0,
  };
}

/**
 * Merge multiple token usage records
 * @param a - First token usage record
 * @param b - Second token usage record
 * @returns Merged token usage
 */
export function mergeTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    total: a.total + b.total,
    costUsd: a.costUsd + b.costUsd,
  };
}

/**
 * Create an empty token usage record
 * @returns Token usage with all fields set to zero
 */
export function emptyTokenUsage(): TokenUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    costUsd: 0,
  };
}

/**
 * Format token usage as a readable string
 * @param usage - Token usage
 * @returns Multi-line readable string
 */
export function formatTokenUsage(usage: TokenUsage): string {
  const lines = [
    `Input: ${formatNumber(usage.input)}`,
    `Output: ${formatNumber(usage.output)}`,
    `Total: ${formatNumber(usage.total)}`,
  ];

  if (usage.cacheRead > 0) {
    lines.push(`Cache Read: ${formatNumber(usage.cacheRead)}`);
  }
  if (usage.cacheWrite > 0) {
    lines.push(`Cache Write: ${formatNumber(usage.cacheWrite)}`);
  }

  return lines.join('\n');
}
