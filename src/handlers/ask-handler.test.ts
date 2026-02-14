import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { StateStore } from '../effects/state-store.js';
import type { AskState, PendingApproval, SessionState } from '../types.js';
import {
  handleAskOptionClick,
  handleAskSubmit,
  handleAskOther,
  handleAskModalSubmit,
} from './ask-handler.js';

// Mock dependencies
vi.mock('../effects/discord-sender.js', () => ({
  buildQuestionButtons: vi.fn().mockReturnValue([]),
  buildAnswerModal: vi.fn().mockReturnValue({ data: { custom_id: 'modal' } }),
}));

vi.mock('../modules/embeds.js', () => ({
  buildAskQuestionStepEmbed: vi.fn().mockReturnValue({ title: 'step' }),
  buildAskCompletedEmbed: vi.fn().mockReturnValue({ title: 'completed' }),
}));

function makeSession(threadId: string): SessionState {
  return {
    sessionId: null,
    status: 'awaiting_permission',
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
  };
}

function makeAskState(overrides?: Partial<AskState>): AskState {
  return {
    totalQuestions: 2,
    currentQuestionIndex: 0,
    collectedAnswers: {},
    selectedOptions: new Set(),
    isMultiSelect: false,
    questions: [
      {
        question: 'Question one?',
        header: 'Q1',
        options: [
          { label: 'A', description: 'desc A' },
          { label: 'B', description: 'desc B' },
        ],
        multiSelect: false,
      },
      {
        question: 'Question two?',
        header: 'Q2',
        options: [
          { label: 'X', description: 'desc X' },
          { label: 'Y', description: 'desc Y' },
        ],
        multiSelect: true,
      },
    ],
    ...overrides,
  };
}

function makePendingApproval(askState: AskState, resolve?: (result: unknown) => void): PendingApproval {
  return {
    toolName: 'AskUserQuestion',
    toolInput: { questions: [] },
    messageId: 'msg-1',
    resolve: resolve || vi.fn(),
    createdAt: new Date(),
    askState,
  };
}

function makeButtonInteraction(overrides?: Record<string, unknown>) {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    isButton: () => true,
    ...overrides,
  } as unknown;
}

function makeModalInteraction(answerText = 'Custom answer') {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
    isButton: () => false,
    fields: {
      getTextInputValue: vi.fn().mockReturnValue(answerText),
    },
    channel: {
      messages: {
        fetch: vi.fn().mockResolvedValue({
          edit: vi.fn().mockResolvedValue(undefined),
        }),
      },
    },
  } as unknown;
}

describe('handleAskOptionClick', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
    vi.clearAllMocks();
  });

  it('replies with expired message when no pending request', async () => {
    const interaction = makeButtonInteraction();
    await handleAskOptionClick(interaction as never, 'thread-1', 0, 0, { store });
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⚠️ This request has expired' }),
    );
  });

  it('replies with expired message when qIdx does not match', async () => {
    store.setSession('t1', makeSession('t1'));
    const askState = makeAskState();
    store.setPendingApproval('t1', makePendingApproval(askState));

    const interaction = makeButtonInteraction();
    // Currently at qIdx 0, passing in qIdx 1
    await handleAskOptionClick(interaction as never, 't1', 1, 0, { store });
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⚠️ This option has expired' }),
    );
  });

  it('records answer and advances to next question on single-select', async () => {
    store.setSession('t1', makeSession('t1'));
    const askState = makeAskState({ isMultiSelect: false });
    store.setPendingApproval('t1', makePendingApproval(askState));

    const interaction = makeButtonInteraction();
    await handleAskOptionClick(interaction as never, 't1', 0, 1, { store });

    expect(askState.collectedAnswers['0']).toBe('B');
    // Advances to next question, update should be called
    expect((interaction as Record<string, unknown>).update).toHaveBeenCalled();
  });

  it('toggles selected state on multi-select', async () => {
    store.setSession('t1', makeSession('t1'));
    const askState = makeAskState({ isMultiSelect: true });
    store.setPendingApproval('t1', makePendingApproval(askState));

    const interaction = makeButtonInteraction();
    // Select index 0
    await handleAskOptionClick(interaction as never, 't1', 0, 0, { store });
    expect(askState.selectedOptions.has(0)).toBe(true);

    // Click again to deselect
    await handleAskOptionClick(interaction as never, 't1', 0, 0, { store });
    expect(askState.selectedOptions.has(0)).toBe(false);
  });

  it('resolves pending on single-select last question', async () => {
    const resolveResult = vi.fn();
    store.setSession('t1', makeSession('t1'));
    const askState = makeAskState({
      totalQuestions: 1,
      questions: [makeAskState().questions[0]],
    });
    store.setPendingApproval('t1', makePendingApproval(askState, resolveResult));

    const interaction = makeButtonInteraction();
    await handleAskOptionClick(interaction as never, 't1', 0, 0, { store });

    expect(resolveResult).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'allow' }),
    );
  });
});

describe('handleAskSubmit', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
    vi.clearAllMocks();
  });

  it('replies with expired message when no pending request', async () => {
    const interaction = makeButtonInteraction();
    await handleAskSubmit(interaction as never, 't1', 0, { store });
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⚠️ This request has expired' }),
    );
  });

  it('prompts when no options are selected', async () => {
    store.setSession('t1', makeSession('t1'));
    const askState = makeAskState({ isMultiSelect: true, selectedOptions: new Set() });
    store.setPendingApproval('t1', makePendingApproval(askState));

    const interaction = makeButtonInteraction();
    await handleAskSubmit(interaction as never, 't1', 0, { store });
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⚠️ Please select at least one option' }),
    );
  });

  it('merges selected labels on multi-select submit', async () => {
    store.setSession('t1', makeSession('t1'));
    const askState = makeAskState({
      isMultiSelect: true,
      selectedOptions: new Set([0, 1]),
    });
    store.setPendingApproval('t1', makePendingApproval(askState));

    const interaction = makeButtonInteraction();
    await handleAskSubmit(interaction as never, 't1', 0, { store });
    expect(askState.collectedAnswers['0']).toBe('A, B');
  });

  it('replies with expired when qIdx does not match', async () => {
    store.setSession('t1', makeSession('t1'));
    const askState = makeAskState({ isMultiSelect: true });
    store.setPendingApproval('t1', makePendingApproval(askState));

    const interaction = makeButtonInteraction();
    await handleAskSubmit(interaction as never, 't1', 5, { store });
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⚠️ This option has expired' }),
    );
  });
});

describe('handleAskOther', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
    vi.clearAllMocks();
  });

  it('replies with expired message when no pending request', async () => {
    const interaction = makeButtonInteraction();
    await handleAskOther(interaction as never, 't1', 0, { store });
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⚠️ This request has expired' }),
    );
  });

  it('replies with expired when qIdx does not match', async () => {
    store.setSession('t1', makeSession('t1'));
    const askState = makeAskState();
    store.setPendingApproval('t1', makePendingApproval(askState));

    const interaction = makeButtonInteraction();
    await handleAskOther(interaction as never, 't1', 99, { store });
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⚠️ This option has expired' }),
    );
  });

  it('displays modal in normal case', async () => {
    store.setSession('t1', makeSession('t1'));
    const askState = makeAskState();
    store.setPendingApproval('t1', makePendingApproval(askState));

    const interaction = makeButtonInteraction({ showModal: vi.fn().mockResolvedValue(undefined) });
    await handleAskOther(interaction as never, 't1', 0, { store });
    expect((interaction as Record<string, unknown>).showModal).toHaveBeenCalled();
  });
});

describe('handleAskModalSubmit', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
    vi.clearAllMocks();
  });

  it('replies with expired message when no pending request', async () => {
    const interaction = makeModalInteraction();
    await handleAskModalSubmit(interaction as never, 't1', 0, { store });
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⚠️ This request has expired' }),
    );
  });

  it('replies with expired when qIdx does not match', async () => {
    store.setSession('t1', makeSession('t1'));
    const askState = makeAskState();
    store.setPendingApproval('t1', makePendingApproval(askState));

    const interaction = makeModalInteraction();
    await handleAskModalSubmit(interaction as never, 't1', 99, { store });
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⚠️ This option has expired' }),
    );
  });

  it('records custom answer', async () => {
    const resolveResult = vi.fn();
    store.setSession('t1', makeSession('t1'));
    const askState = makeAskState({
      totalQuestions: 1,
      questions: [makeAskState().questions[0]],
    });
    store.setPendingApproval('t1', makePendingApproval(askState, resolveResult));

    const interaction = makeModalInteraction('My custom answer');
    await handleAskModalSubmit(interaction as never, 't1', 0, { store });

    expect(askState.collectedAnswers['0']).toBe('My custom answer');
    expect(resolveResult).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'allow' }),
    );
  });
});
