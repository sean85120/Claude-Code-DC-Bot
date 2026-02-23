import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { StateStore } from '../effects/state-store.js';
import { UsageStore } from '../effects/usage-store.js';
import type { BotConfig } from '../types.js';
import { handleSDKMessage } from './stream-handler.js';
import type { StreamHandlerDeps } from './stream-handler.js';
import type { PlatformAdapter, PlatformMessage } from '../platforms/types.js';

function makeMockAdapter() {
  return {
    platform: 'discord' as const,
    messageLimit: 2000,
    sendRichMessage: vi.fn().mockResolvedValue({ id: 'msg1', threadId: 't1', platform: 'discord' }),
    sendText: vi.fn().mockResolvedValue([{ id: 'msg1', threadId: 't1', platform: 'discord' }]),
    sendPlainText: vi.fn().mockResolvedValue({ id: 'stream1', threadId: 't1', platform: 'discord' }),
    editText: vi.fn().mockResolvedValue(undefined),
    editRichMessage: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    mentionUser: vi.fn((id: string) => `<@${id}>`),
  } as unknown as PlatformAdapter;
}

function makeSession(threadId: string, store: StateStore) {
  store.setSession(threadId, {
    sessionId: null,
    status: 'running',
    threadId,
    userId: 'u1',
    startedAt: new Date(),
    lastActivityAt: new Date(),
    promptText: 'test',
    cwd: '/test',
    model: 'model',
    toolCount: 0,
    tools: {},
    pendingApproval: null,
    abortController: new AbortController(),
    transcript: [],
  });
}

function makeConfig(overrides?: Partial<BotConfig>): BotConfig {
  return {
    hideReadResults: false,
    hideSearchResults: false,
    hideAllToolEmbeds: false,
    compactToolEmbeds: false,
    ...overrides,
  } as BotConfig;
}

function makeDeps(store: StateStore, usageStore: UsageStore, configOverrides?: Partial<BotConfig>): StreamHandlerDeps {
  return {
    store,
    threadId: 't1',
    adapter: makeMockAdapter(),
    cwd: '/test',
    streamUpdateIntervalMs: 2000,
    usageStore,
    config: makeConfig(configOverrides),
  };
}

function makeStreamState() {
  return {
    currentText: '',
    currentMessage: null as PlatformMessage | null,
    lastUpdateTime: 0,
    updateTimer: null as ReturnType<typeof setTimeout> | null,
  };
}

describe('handleSDKMessage', () => {
  let store: StateStore;
  let usageStore: UsageStore;

  beforeEach(() => {
    store = new StateStore();
    usageStore = new UsageStore();
    makeSession('t1', store);
    vi.clearAllMocks();
  });

  describe('system init', () => {
    it('updates sessionId and records session start', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();

      await handleSDKMessage(
        { type: 'system', subtype: 'init', session_id: 'sess-abc' } as unknown as SDKMessage,
        deps,
        state,
      );

      const session = store.getSession('t1');
      expect(session?.sessionId).toBe('sess-abc');
      expect(usageStore.getGlobalStats().totalSessions).toBe(1);
    });

    it('does not update for non-init subtype', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();

      await handleSDKMessage(
        { type: 'system', subtype: 'other' } as unknown as SDKMessage,
        deps,
        state,
      );

      const session = store.getSession('t1');
      expect(session?.sessionId).toBeNull();
      expect(usageStore.getGlobalStats().totalSessions).toBe(0);
    });
  });

  describe('assistant text', () => {
    it('sends plain text when text exists', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();
      const adapter = deps.adapter as unknown as ReturnType<typeof makeMockAdapter>;

      await handleSDKMessage(
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Hello world' }] },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(adapter.sendText).toHaveBeenCalledTimes(1);
      expect(adapter.sendText.mock.calls[0][1]).toBe('Hello world');
    });

    it('does not send when no text', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();
      const adapter = deps.adapter as unknown as ReturnType<typeof makeMockAdapter>;

      await handleSDKMessage(
        {
          type: 'assistant',
          message: { content: [] },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(adapter.sendRichMessage).not.toHaveBeenCalled();
    });

    it('sends long text as plain text (auto-chunked)', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();
      const adapter = deps.adapter as unknown as ReturnType<typeof makeMockAdapter>;
      const longText = 'x'.repeat(5000);

      await handleSDKMessage(
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: longText }] },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(adapter.sendText).toHaveBeenCalledTimes(1);
      expect(adapter.sendText.mock.calls[0][1]).toBe(longText);
    });

    it('edits existing streaming message to final text', async () => {
      const deps = makeDeps(store, usageStore);
      const adapter = deps.adapter as unknown as ReturnType<typeof makeMockAdapter>;
      const existingMsg: PlatformMessage = { id: 'existing', threadId: 't1', platform: 'discord' as const };
      const state = makeStreamState();
      state.currentMessage = existingMsg;

      await handleSDKMessage(
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Updated' }] },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(adapter.editText).toHaveBeenCalledWith(existingMsg, 'Updated');
      expect(adapter.deleteMessage).not.toHaveBeenCalled();
      expect(adapter.sendText).not.toHaveBeenCalled();
    });

    it('deletes streaming message and sends chunked text for long content', async () => {
      const deps = makeDeps(store, usageStore);
      const adapter = deps.adapter as unknown as ReturnType<typeof makeMockAdapter>;
      const existingMsg: PlatformMessage = { id: 'existing', threadId: 't1', platform: 'discord' as const };
      const state = makeStreamState();
      state.currentMessage = existingMsg;
      const longText = 'x'.repeat(5000);

      await handleSDKMessage(
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: longText }] },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(adapter.deleteMessage).toHaveBeenCalledTimes(1);
      expect(adapter.sendText).toHaveBeenCalledTimes(1);
      expect(adapter.sendText.mock.calls[0][1]).toBe(longText);
    });

    it('resets stream state (after editing)', async () => {
      const deps = makeDeps(store, usageStore);
      const adapter = deps.adapter as unknown as ReturnType<typeof makeMockAdapter>;
      const state = makeStreamState();
      state.currentText = 'accumulated';
      state.currentMessage = { id: 'msg', threadId: 't1', platform: 'discord' as const };

      await handleSDKMessage(
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Final' }] },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(adapter.editText).toHaveBeenCalled();
      expect(state.currentText).toBe('');
      expect(state.currentMessage).toBeNull();
    });

    it('records transcript', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();

      await handleSDKMessage(
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Logged' }] },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      const session = store.getSession('t1');
      expect(session?.transcript).toHaveLength(1);
      expect(session?.transcript[0].type).toBe('assistant');
      expect(session?.transcript[0].content).toBe('Logged');
    });
  });

  describe('assistant tool calls', () => {
    it('extracts and records tool calls', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();
      const adapter = deps.adapter as unknown as ReturnType<typeof makeMockAdapter>;

      await handleSDKMessage(
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Read', input: { file_path: '/a.ts' }, id: 'tu1' },
            ],
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      const session = store.getSession('t1');
      expect(session?.toolCount).toBe(1);
      expect(session?.tools['Read']).toBe(1);
      // Tool embed sent
      expect(adapter.sendRichMessage).toHaveBeenCalledTimes(1);
    });

    it('handles text + tool calls simultaneously', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();
      const adapter = deps.adapter as unknown as ReturnType<typeof makeMockAdapter>;

      await handleSDKMessage(
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Thinking...' },
              { type: 'tool_use', name: 'Bash', input: { command: 'ls' }, id: 'tu2' },
            ],
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      // Plain text 1 time + tool embed 1 time
      expect(adapter.sendText).toHaveBeenCalledTimes(1);
      expect(adapter.sendRichMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('hideReadResults', () => {
    it('skips Read tool embed when hideReadResults is true', async () => {
      const deps = makeDeps(store, usageStore, { hideReadResults: true });
      const state = makeStreamState();
      const adapter = deps.adapter as unknown as ReturnType<typeof makeMockAdapter>;

      await handleSDKMessage(
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Read', input: { file_path: '/a.ts' }, id: 'tu1' },
            ],
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      // Tool use is still recorded
      const session = store.getSession('t1');
      expect(session?.toolCount).toBe(1);
      expect(session?.tools['Read']).toBe(1);
      // But embed is NOT sent
      expect(adapter.sendRichMessage).not.toHaveBeenCalled();
    });

    it('sends Read tool embed when hideReadResults is false', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();
      const adapter = deps.adapter as unknown as ReturnType<typeof makeMockAdapter>;

      await handleSDKMessage(
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Read', input: { file_path: '/a.ts' }, id: 'tu1' },
            ],
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(adapter.sendRichMessage).toHaveBeenCalledTimes(1);
    });

    it('still sends non-Read tool embeds when hideReadResults is true', async () => {
      const deps = makeDeps(store, usageStore, { hideReadResults: true });
      const state = makeStreamState();
      const adapter = deps.adapter as unknown as ReturnType<typeof makeMockAdapter>;

      await handleSDKMessage(
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Bash', input: { command: 'ls' }, id: 'tu1' },
            ],
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(adapter.sendRichMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('hideSearchResults', () => {
    it('skips Glob embed when hideSearchResults is true', async () => {
      const deps = makeDeps(store, usageStore, { hideSearchResults: true });
      const state = makeStreamState();
      const adapter = deps.adapter as unknown as ReturnType<typeof makeMockAdapter>;

      await handleSDKMessage(
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Glob', input: { pattern: '**/*.ts' }, id: 'tu1' },
            ],
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      const session = store.getSession('t1');
      expect(session?.toolCount).toBe(1);
      expect(adapter.sendRichMessage).not.toHaveBeenCalled();
    });

    it('skips Grep embed when hideSearchResults is true', async () => {
      const deps = makeDeps(store, usageStore, { hideSearchResults: true });
      const state = makeStreamState();
      const adapter = deps.adapter as unknown as ReturnType<typeof makeMockAdapter>;

      await handleSDKMessage(
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Grep', input: { pattern: 'TODO' }, id: 'tu1' },
            ],
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(adapter.sendRichMessage).not.toHaveBeenCalled();
    });

    it('still sends non-search embeds when hideSearchResults is true', async () => {
      const deps = makeDeps(store, usageStore, { hideSearchResults: true });
      const state = makeStreamState();
      const adapter = deps.adapter as unknown as ReturnType<typeof makeMockAdapter>;

      await handleSDKMessage(
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Write', input: { file_path: '/a.ts', content: 'x' }, id: 'tu1' },
            ],
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(adapter.sendRichMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('hideAllToolEmbeds', () => {
    it('skips all tool embeds when hideAllToolEmbeds is true', async () => {
      const deps = makeDeps(store, usageStore, { hideAllToolEmbeds: true });
      const state = makeStreamState();
      const adapter = deps.adapter as unknown as ReturnType<typeof makeMockAdapter>;

      await handleSDKMessage(
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Read', input: { file_path: '/a.ts' }, id: 'tu1' },
              { type: 'tool_use', name: 'Bash', input: { command: 'ls' }, id: 'tu2' },
              { type: 'tool_use', name: 'Write', input: { file_path: '/b.ts', content: 'x' }, id: 'tu3' },
            ],
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      const session = store.getSession('t1');
      expect(session?.toolCount).toBe(3);
      expect(adapter.sendRichMessage).not.toHaveBeenCalled();
    });

    it('still records transcript when hideAllToolEmbeds is true', async () => {
      const deps = makeDeps(store, usageStore, { hideAllToolEmbeds: true });
      const state = makeStreamState();

      await handleSDKMessage(
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Bash', input: { command: 'echo hi' }, id: 'tu1' },
            ],
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      const session = store.getSession('t1');
      expect(session?.transcript).toHaveLength(1);
      expect(session?.transcript[0].toolName).toBe('Bash');
    });
  });

  describe('compactToolEmbeds', () => {
    it('sends compact embed when compactToolEmbeds is true', async () => {
      const deps = makeDeps(store, usageStore, { compactToolEmbeds: true });
      const state = makeStreamState();
      const adapter = deps.adapter as unknown as ReturnType<typeof makeMockAdapter>;

      await handleSDKMessage(
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Bash', input: { command: 'ls' }, id: 'tu1' },
            ],
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(adapter.sendRichMessage).toHaveBeenCalledTimes(1);
      const embed = adapter.sendRichMessage.mock.calls[0][1] as Record<string, unknown>;
      // Compact embeds have description with emoji+name but no author/title/fields
      expect(embed.description).toContain('Bash');
      expect(embed.author).toBeUndefined();
      expect(embed.title).toBeUndefined();
      expect(embed.fields).toBeUndefined();
    });

    it('hideAllToolEmbeds takes precedence over compactToolEmbeds', async () => {
      const deps = makeDeps(store, usageStore, { hideAllToolEmbeds: true, compactToolEmbeds: true });
      const state = makeStreamState();
      const adapter = deps.adapter as unknown as ReturnType<typeof makeMockAdapter>;

      await handleSDKMessage(
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Bash', input: { command: 'ls' }, id: 'tu1' },
            ],
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(adapter.sendRichMessage).not.toHaveBeenCalled();
    });
  });

  describe('stream_event', () => {
    it('text_delta accumulates text', async () => {
      const deps = makeDeps(store, usageStore);
      // Set lastUpdateTime far enough to trigger immediate update
      const state = makeStreamState();
      state.lastUpdateTime = 0;

      await handleSDKMessage(
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Hello' },
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(state.currentText).toBe('Hello');
    });

    it('multiple text_deltas continue to accumulate', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();

      await handleSDKMessage(
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Hello' },
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      await handleSDKMessage(
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: ' World' },
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(state.currentText).toBe('Hello World');
    });

    it('non-text_delta does not accumulate', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();

      await handleSDKMessage(
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'input_json_delta', partial_json: '{}' },
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(state.currentText).toBe('');
    });
  });

  describe('result', () => {
    it('sends stats embed on success (without response text)', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();
      const adapter = deps.adapter as unknown as ReturnType<typeof makeMockAdapter>;

      await handleSDKMessage(
        {
          type: 'result',
          subtype: 'success',
          result: 'Done!',
          duration_ms: 5000,
          total_cost_usd: 0.05,
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(adapter.sendRichMessage).toHaveBeenCalledTimes(1);
      const embed = adapter.sendRichMessage.mock.calls[0][1] as Record<string, unknown>;
      // Response text is not included in description (already sent during assistant phase)
      expect(embed.description).toBeUndefined();
    });

    it('sends error embed on failure', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();
      const adapter = deps.adapter as unknown as ReturnType<typeof makeMockAdapter>;

      await handleSDKMessage(
        {
          type: 'result',
          subtype: 'error',
          errors: ['Something broke'],
          duration_ms: 1000,
          total_cost_usd: 0.01,
          usage: {
            input_tokens: 10,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(adapter.sendRichMessage).toHaveBeenCalledTimes(1);
      const embed = adapter.sendRichMessage.mock.calls[0][1] as Record<string, unknown>;
      expect(embed.description).toContain('Something broke');
    });

    it('records global usage', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();

      await handleSDKMessage(
        {
          type: 'result',
          subtype: 'success',
          result: '',
          duration_ms: 3000,
          total_cost_usd: 0.10,
          usage: {
            input_tokens: 200,
            output_tokens: 100,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      const stats = usageStore.getGlobalStats();
      expect(stats.completedQueries).toBe(1);
      expect(stats.totalCostUsd).toBeCloseTo(0.10);
    });

    it('records transcript', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();

      await handleSDKMessage(
        {
          type: 'result',
          subtype: 'success',
          result: 'Transcript test',
          duration_ms: 1000,
          total_cost_usd: 0,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      const session = store.getSession('t1');
      expect(session?.transcript).toHaveLength(1);
      expect(session?.transcript[0].type).toBe('result');
    });
  });

  describe('tool_progress and unknown', () => {
    it('tool_progress does nothing', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();
      const adapter = deps.adapter as unknown as ReturnType<typeof makeMockAdapter>;

      await handleSDKMessage(
        { type: 'tool_progress' } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(adapter.sendRichMessage).not.toHaveBeenCalled();
    });

    it('unknown type does nothing', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();
      const adapter = deps.adapter as unknown as ReturnType<typeof makeMockAdapter>;

      await handleSDKMessage(
        { type: 'unknown_type' } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(adapter.sendRichMessage).not.toHaveBeenCalled();
    });
  });

  describe('assistant throttle timer cleanup', () => {
    it('clears scheduled throttle update', async () => {
      const deps = makeDeps(store, usageStore);
      const state = makeStreamState();
      const timer = setTimeout(() => {}, 10000);
      state.updateTimer = timer;

      await handleSDKMessage(
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'done' }] },
        } as unknown as SDKMessage,
        deps,
        state,
      );

      expect(state.updateTimer).toBeNull();
    });
  });
});
