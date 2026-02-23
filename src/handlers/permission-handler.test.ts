import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StateStore } from '../effects/state-store.js';
import { createCanUseTool } from './permission-handler.js';
import type { PlatformAdapter } from '../platforms/types.js';

vi.mock('../modules/embeds.js', () => ({
  buildPermissionRequestEmbed: vi.fn().mockReturnValue({ title: 'permission' }),
  buildAskQuestionStepEmbed: vi.fn().mockReturnValue({ title: 'ask-step' }),
}));

function makeMockAdapter() {
  return {
    platform: 'discord' as const,
    messageLimit: 2000,
    sendRichMessageWithButtons: vi.fn().mockResolvedValue({ id: 'msg1', threadId: 't1', platform: 'discord' }),
    sendRichMessage: vi.fn().mockResolvedValue({ id: 'msg1', threadId: 't1', platform: 'discord' }),
    sendText: vi.fn().mockResolvedValue([]),
    mentionUser: (id: string) => `<@${id}>`,
  } as unknown as PlatformAdapter;
}

function makeStore(threadId: string, userId = 'u1'): StateStore {
  const store = new StateStore();
  store.setSession(threadId, {
    sessionId: null,
    platform: 'discord',
    status: 'running',
    threadId,
    userId,
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
    allowedTools: new Set(),
  });
  return store;
}

/** Wait for pending approval to be set in the store */
async function waitForPending(store: StateStore, threadId: string, maxWait = 500): Promise<void> {
  const start = Date.now();
  while (!store.getPendingApproval(threadId)) {
    if (Date.now() - start > maxWait) throw new Error('pending approval setup timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('createCanUseTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Always-allow auto-approve', () => {
    it('auto-approves when tool is in allowedTools', async () => {
      const store = makeStore('t1');
      store.addAllowedTool('t1', 'Bash');
      const adapter = makeMockAdapter();
      const canUseTool = createCanUseTool({ store, threadId: 't1', adapter, cwd: '/test', approvalTimeoutMs: 0 });

      const signal = new AbortController().signal;
      const result = await canUseTool('Bash', { command: 'ls' }, { signal });

      expect(result.behavior).toBe('allow');
      expect(result.updatedInput).toEqual({ command: 'ls' });
      // Should NOT send any messages
      expect(adapter.sendRichMessageWithButtons).not.toHaveBeenCalled();
      expect(adapter.sendText).not.toHaveBeenCalled();
    });

    it('does not auto-approve tools not in allowedTools', async () => {
      const store = makeStore('t1');
      store.addAllowedTool('t1', 'Bash');
      const adapter = makeMockAdapter();
      const canUseTool = createCanUseTool({ store, threadId: 't1', adapter, cwd: '/test', approvalTimeoutMs: 0 });

      const signal = new AbortController().signal;
      const promise = canUseTool('Write', { file_path: '/a.ts' }, { signal });

      await waitForPending(store, 't1');
      expect(adapter.sendRichMessageWithButtons).toHaveBeenCalledTimes(1);

      store.resolvePendingApproval('t1', { behavior: 'allow' });
      await promise;
    });
  });

  describe('General tool permission requests', () => {
    it('sends permission request Embed + buttons and returns result', async () => {
      const store = makeStore('t1');
      const adapter = makeMockAdapter();
      const canUseTool = createCanUseTool({ store, threadId: 't1', adapter, cwd: '/test', approvalTimeoutMs: 0 });

      const signal = new AbortController().signal;
      // Don't await, because the Promise will pause waiting for user response
      const promise = canUseTool('Bash', { command: 'ls' }, { signal });

      await waitForPending(store, 't1');

      expect(adapter.sendRichMessageWithButtons).toHaveBeenCalledTimes(1);

      const pending = store.getPendingApproval('t1');
      expect(pending!.toolName).toBe('Bash');

      store.resolvePendingApproval('t1', { behavior: 'allow', updatedInput: { command: 'ls' } });

      const result = await promise;
      expect(result.behavior).toBe('allow');
    });

    it('returns deny when user denies', async () => {
      const store = makeStore('t1');
      const adapter = makeMockAdapter();
      const canUseTool = createCanUseTool({ store, threadId: 't1', adapter, cwd: '/test', approvalTimeoutMs: 0 });

      const signal = new AbortController().signal;
      const promise = canUseTool('Write', { file_path: '/a.ts' }, { signal });

      await waitForPending(store, 't1');
      store.resolvePendingApproval('t1', { behavior: 'deny', message: 'no' });

      const result = await promise;
      expect(result.behavior).toBe('deny');
      expect(result.message).toBe('no');
    });

    it('@mention notifies the user', async () => {
      const store = makeStore('t1', 'user-123');
      const adapter = makeMockAdapter();
      const canUseTool = createCanUseTool({ store, threadId: 't1', adapter, cwd: '/test', approvalTimeoutMs: 0 });

      const signal = new AbortController().signal;
      const promise = canUseTool('Bash', {}, { signal });

      await waitForPending(store, 't1');

      expect(adapter.sendText).toHaveBeenCalledWith(
        't1',
        '<@user-123> A tool requires your approval.',
      );

      store.resolvePendingApproval('t1', { behavior: 'allow' });
      await promise;
    });

    it('auto-denies when AbortSignal is triggered', async () => {
      const store = makeStore('t1');
      const adapter = makeMockAdapter();
      const canUseTool = createCanUseTool({ store, threadId: 't1', adapter, cwd: '/test', approvalTimeoutMs: 0 });

      const abortController = new AbortController();
      const promise = canUseTool('Bash', {}, { signal: abortController.signal });

      await waitForPending(store, 't1');
      abortController.abort();

      const result = await promise;
      expect(result.behavior).toBe('deny');
      expect(result.message).toBe('Task has been stopped');
    });

    it('auto-denies after approval timeout', async () => {
      const store = makeStore('t1');
      const adapter = makeMockAdapter();
      const canUseTool = createCanUseTool({ store, threadId: 't1', adapter, cwd: '/test', approvalTimeoutMs: 10000 });

      const signal = new AbortController().signal;
      const promise = canUseTool('Bash', { command: 'rm -rf /' }, { signal });

      await waitForPending(store, 't1');

      // Advance past the timeout
      vi.advanceTimersByTime(10001);

      const result = await promise;
      expect(result.behavior).toBe('deny');
      expect(result.message).toContain('timed out');

      // Should notify in thread
      expect(adapter.sendText).toHaveBeenCalledWith(
        't1',
        expect.stringContaining('timed out'),
      );
    });

    it('clears timeout when user responds before timeout', async () => {
      const store = makeStore('t1');
      const adapter = makeMockAdapter();
      const canUseTool = createCanUseTool({ store, threadId: 't1', adapter, cwd: '/test', approvalTimeoutMs: 60000 });

      const signal = new AbortController().signal;
      const promise = canUseTool('Bash', { command: 'ls' }, { signal });

      await waitForPending(store, 't1');

      // Approve before timeout
      store.resolvePendingApproval('t1', { behavior: 'allow' });
      const result = await promise;
      expect(result.behavior).toBe('allow');

      // Advance past the timeout — should not cause issues since timeout was cleared
      vi.advanceTimersByTime(61000);
    });
  });

  describe('AskUserQuestion special handling', () => {
    it('displays question buttons instead of approval buttons', async () => {
      const store = makeStore('t1');
      const adapter = makeMockAdapter();
      const canUseTool = createCanUseTool({ store, threadId: 't1', adapter, cwd: '/test', approvalTimeoutMs: 0 });

      const signal = new AbortController().signal;
      const input = {
        questions: [
          {
            question: 'Which one do you want?',
            header: 'Q1',
            options: [{ label: 'A', description: 'a' }],
            multiSelect: false,
          },
        ],
      };

      const promise = canUseTool('AskUserQuestion', input, { signal });

      await waitForPending(store, 't1');

      expect(adapter.sendRichMessageWithButtons).toHaveBeenCalledTimes(1);

      const pending = store.getPendingApproval('t1');
      expect(pending?.askState).toBeDefined();
      expect(pending?.askState?.totalQuestions).toBe(1);

      store.resolvePendingApproval('t1', { behavior: 'allow', updatedInput: input });
      await promise;
    });

    it('AskUser alias also triggers special handling', async () => {
      const store = makeStore('t1');
      const adapter = makeMockAdapter();
      const canUseTool = createCanUseTool({ store, threadId: 't1', adapter, cwd: '/test', approvalTimeoutMs: 0 });

      const signal = new AbortController().signal;
      const input = {
        questions: [
          {
            question: 'Q?',
            options: [{ label: 'A' }],
          },
        ],
      };

      const promise = canUseTool('AskUser', input, { signal });

      await waitForPending(store, 't1');
      expect(adapter.sendRichMessageWithButtons).toHaveBeenCalledTimes(1);

      store.resolvePendingApproval('t1', { behavior: 'allow' });
      await promise;
    });

    it('AskUserQuestion falls back to normal permission flow when no options', async () => {
      const store = makeStore('t1');
      const adapter = makeMockAdapter();
      const canUseTool = createCanUseTool({ store, threadId: 't1', adapter, cwd: '/test', approvalTimeoutMs: 0 });

      const signal = new AbortController().signal;
      const input = {
        questions: [{ question: 'Q?' }],
      };

      const promise = canUseTool('AskUserQuestion', input, { signal });

      await waitForPending(store, 't1');
      expect(adapter.sendRichMessageWithButtons).toHaveBeenCalledTimes(1);

      store.resolvePendingApproval('t1', { behavior: 'allow' });
      await promise;
    });

    it('@mention notifies user to answer questions', async () => {
      const store = makeStore('t1', 'user-456');
      const adapter = makeMockAdapter();
      const canUseTool = createCanUseTool({ store, threadId: 't1', adapter, cwd: '/test', approvalTimeoutMs: 0 });

      const signal = new AbortController().signal;
      const input = {
        questions: [{ question: 'Q?', options: [{ label: 'A' }] }],
      };

      const promise = canUseTool('AskUserQuestion', input, { signal });

      await waitForPending(store, 't1');

      expect(adapter.sendText).toHaveBeenCalledWith(
        't1',
        '<@user-456> Claude has questions for you to answer.',
      );

      store.resolvePendingApproval('t1', { behavior: 'allow' });
      await promise;
    });

    it('AskUserQuestion auto-denies on AbortSignal', async () => {
      const store = makeStore('t1');
      const adapter = makeMockAdapter();
      const canUseTool = createCanUseTool({ store, threadId: 't1', adapter, cwd: '/test', approvalTimeoutMs: 0 });

      const abortController = new AbortController();
      const input = {
        questions: [{ question: 'Q?', options: [{ label: 'A' }] }],
      };

      const promise = canUseTool('AskUserQuestion', input, { signal: abortController.signal });

      await waitForPending(store, 't1');
      abortController.abort();

      const result = await promise;
      expect(result.behavior).toBe('deny');
      expect(result.message).toBe('Task has been stopped');
    });

    it('AskUserQuestion auto-denies after approval timeout', async () => {
      const store = makeStore('t1');
      const adapter = makeMockAdapter();
      const canUseTool = createCanUseTool({ store, threadId: 't1', adapter, cwd: '/test', approvalTimeoutMs: 5000 });

      const signal = new AbortController().signal;
      const input = {
        questions: [{ question: 'Q?', options: [{ label: 'A' }] }],
      };

      const promise = canUseTool('AskUserQuestion', input, { signal });

      await waitForPending(store, 't1');

      vi.advanceTimersByTime(5001);

      const result = await promise;
      expect(result.behavior).toBe('deny');
      expect(result.message).toContain('timed out');
    });
  });
});
