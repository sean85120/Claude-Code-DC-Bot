import type { SDKAssistantMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * Extract text content from an SDK assistant message
 * @param message - SDK assistant message
 * @returns Extracted text content
 */
export function extractAssistantText(message: SDKAssistantMessage): string {
  const content = message.message?.content;
  if (!Array.isArray(content)) return '';

  return content
    .filter((block): block is { type: 'text'; text: string } => {
      return typeof block === 'object' && block !== null && 'type' in block && block.type === 'text';
    })
    .map((block) => block.text)
    .join('\n');
}

/**
 * Extract tool calls from an SDK assistant message
 * @param message - SDK assistant message
 * @returns Array of tool calls (with tool name, input parameters, call ID)
 */
export function extractToolUse(message: SDKAssistantMessage): Array<{
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
}> {
  const content = message.message?.content;
  if (!Array.isArray(content)) return [];

  return content
    .filter(
      (block): block is {
        type: 'tool_use';
        name: string;
        input: Record<string, unknown>;
        id: string;
      } => {
        return typeof block === 'object' && block !== null && 'type' in block && block.type === 'tool_use';
      },
    )
    .map((block) => ({
      toolName: block.name,
      toolInput: block.input,
      toolUseId: block.id,
    }));
}

/**
 * Extract result summary from an SDK result message
 * @param message - SDK result message
 * @returns Result summary (including success status, text, duration, cost, token usage)
 */
export function extractResult(message: SDKResultMessage): {
  success: boolean;
  text: string;
  durationMs: number;
  costUsd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
} {
  const success = message.subtype === 'success';
  const text = success
    ? (message as { result?: string }).result ?? ''
    : ((message as { errors?: string[] }).errors ?? []).join('\n') || 'An error occurred during execution';

  return {
    success,
    text,
    durationMs: message.duration_ms,
    costUsd: message.total_cost_usd,
    usage: {
      input_tokens: message.usage.input_tokens ?? 0,
      output_tokens: message.usage.output_tokens ?? 0,
      cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
    },
  };
}
