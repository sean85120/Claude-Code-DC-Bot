import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ThreadChannel, Message } from 'discord.js';
import { StateStore } from '../effects/state-store.js';
import { createCanUseTool } from './permission-handler.js';

// Mock discord-sender
vi.mock('../effects/discord-sender.js', () => ({
  sendEmbedWithApprovalButtons: vi.fn().mockResolvedValue({ id: 'btn-msg-1' } as unknown as Message),
  sendEmbedWithAskButtons: vi.fn().mockResolvedValue({ id: 'ask-msg-1' } as unknown as Message),
  buildQuestionButtons: vi.fn().mockReturnValue([]),
  sendTextInThread: vi.fn().mockResolvedValue([]),
}));

vi.mock('../modules/embeds.js', () => ({
  buildPermissionRequestEmbed: vi.fn().mockReturnValue({ title: 'permission' }),
  buildAskQuestionStepEmbed: vi.fn().mockReturnValue({ title: 'ask-step' }),
}));

import { sendEmbedWithApprovalButtons, sendEmbedWithAskButtons, sendTextInThread } from '../effects/discord-sender.js';

function makeStore(threadId: string, userId = 'u1'): StateStore {
  const store = new StateStore();
  store.setSession(threadId, {
    sessionId: null,
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
  });
  return store;
}

function makeThread(id = 't1'): ThreadChannel {
  return { id } as unknown as ThreadChannel;
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
  });

  describe('General tool permission requests', () => {
    it('sends permission request Embed + buttons and returns result', async () => {
      const store = makeStore('t1');
      const thread = makeThread('t1');
      const canUseTool = createCanUseTool({ store, threadId: 't1', thread, cwd: '/test' });

      const signal = new AbortController().signal;
      // Don't await, because the Promise will pause waiting for user response
      const promise = canUseTool('Bash', { command: 'ls' }, { signal });

      await waitForPending(store, 't1');

      expect(sendEmbedWithApprovalButtons).toHaveBeenCalledTimes(1);

      const pending = store.getPendingApproval('t1');
      expect(pending!.toolName).toBe('Bash');

      store.resolvePendingApproval('t1', { behavior: 'allow', updatedInput: { command: 'ls' } });

      const result = await promise;
      expect(result.behavior).toBe('allow');
    });

    it('returns deny when user denies', async () => {
      const store = makeStore('t1');
      const thread = makeThread('t1');
      const canUseTool = createCanUseTool({ store, threadId: 't1', thread, cwd: '/test' });

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
      const thread = makeThread('t1');
      const canUseTool = createCanUseTool({ store, threadId: 't1', thread, cwd: '/test' });

      const signal = new AbortController().signal;
      const promise = canUseTool('Bash', {}, { signal });

      await waitForPending(store, 't1');

      expect(sendTextInThread).toHaveBeenCalledWith(
        thread,
        '<@user-123> A tool requires your approval.',
      );

      store.resolvePendingApproval('t1', { behavior: 'allow' });
      await promise;
    });

    it('auto-denies when AbortSignal is triggered', async () => {
      const store = makeStore('t1');
      const thread = makeThread('t1');
      const canUseTool = createCanUseTool({ store, threadId: 't1', thread, cwd: '/test' });

      const abortController = new AbortController();
      const promise = canUseTool('Bash', {}, { signal: abortController.signal });

      await waitForPending(store, 't1');
      abortController.abort();

      const result = await promise;
      expect(result.behavior).toBe('deny');
      expect(result.message).toBe('Task has been stopped');
    });
  });

  describe('AskUserQuestion special handling', () => {
    it('displays question buttons instead of approval buttons', async () => {
      const store = makeStore('t1');
      const thread = makeThread('t1');
      const canUseTool = createCanUseTool({ store, threadId: 't1', thread, cwd: '/test' });

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

      expect(sendEmbedWithAskButtons).toHaveBeenCalledTimes(1);
      expect(sendEmbedWithApprovalButtons).not.toHaveBeenCalled();

      const pending = store.getPendingApproval('t1');
      expect(pending?.askState).toBeDefined();
      expect(pending?.askState?.totalQuestions).toBe(1);

      store.resolvePendingApproval('t1', { behavior: 'allow', updatedInput: input });
      await promise;
    });

    it('AskUser alias also triggers special handling', async () => {
      const store = makeStore('t1');
      const thread = makeThread('t1');
      const canUseTool = createCanUseTool({ store, threadId: 't1', thread, cwd: '/test' });

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
      expect(sendEmbedWithAskButtons).toHaveBeenCalledTimes(1);

      store.resolvePendingApproval('t1', { behavior: 'allow' });
      await promise;
    });

    it('AskUserQuestion falls back to normal permission flow when no options', async () => {
      const store = makeStore('t1');
      const thread = makeThread('t1');
      const canUseTool = createCanUseTool({ store, threadId: 't1', thread, cwd: '/test' });

      const signal = new AbortController().signal;
      const input = {
        questions: [{ question: 'Q?' }],
      };

      const promise = canUseTool('AskUserQuestion', input, { signal });

      await waitForPending(store, 't1');
      expect(sendEmbedWithApprovalButtons).toHaveBeenCalledTimes(1);

      store.resolvePendingApproval('t1', { behavior: 'allow' });
      await promise;
    });

    it('@mention notifies user to answer questions', async () => {
      const store = makeStore('t1', 'user-456');
      const thread = makeThread('t1');
      const canUseTool = createCanUseTool({ store, threadId: 't1', thread, cwd: '/test' });

      const signal = new AbortController().signal;
      const input = {
        questions: [{ question: 'Q?', options: [{ label: 'A' }] }],
      };

      const promise = canUseTool('AskUserQuestion', input, { signal });

      await waitForPending(store, 't1');

      expect(sendTextInThread).toHaveBeenCalledWith(
        thread,
        '<@user-456> Claude has questions for you to answer.',
      );

      store.resolvePendingApproval('t1', { behavior: 'allow' });
      await promise;
    });

    it('AskUserQuestion auto-denies on AbortSignal', async () => {
      const store = makeStore('t1');
      const thread = makeThread('t1');
      const canUseTool = createCanUseTool({ store, threadId: 't1', thread, cwd: '/test' });

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
  });
});
