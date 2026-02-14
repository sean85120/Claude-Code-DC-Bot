import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildQuestionButtons,
  buildAnswerModal,
  sendEmbed,
  sendEmbedWithApprovalButtons,
  sendEmbedWithAskButtons,
  updateMessageEmbed,
  editMessageText,
  sendPlainInThread,
  createThread,
  sendInThread,
  sendTextInThread,
  deferReply,
  deferReplyEphemeral,
  editReply,
  sendFollowUp,
} from './discord-sender.js';
import { MessageFlags } from 'discord.js';
import type {
  SendableChannels,
  TextChannel,
  ThreadChannel,
  Message,
  ChatInputCommandInteraction,
  APIEmbed,
} from 'discord.js';
import type { AskState } from '../types.js';

function makeAskState(overrides?: Partial<AskState>): AskState {
  return {
    totalQuestions: 1,
    currentQuestionIndex: 0,
    collectedAnswers: {},
    selectedOptions: new Set(),
    isMultiSelect: false,
    questions: [
      {
        question: 'Which one do you want to choose?',
        header: 'Q1',
        options: [
          { label: 'Option A', description: 'Description A' },
          { label: 'Option B', description: 'Description B' },
        ],
        multiSelect: false,
      },
    ],
    ...overrides,
  };
}

describe('buildQuestionButtons', () => {
  it('creates a button for each option', () => {
    const state = makeAskState();
    const rows = buildQuestionButtons('thread-1', state);

    // should have at least one ActionRow
    expect(rows.length).toBeGreaterThanOrEqual(1);

    // first row should contain option buttons + other button
    const firstRow = rows[0];
    const components = firstRow.components;
    // 2 options + 1 "Other" = 3
    expect(components.length).toBe(3);
  });

  it('button customId contains threadId, qIdx, and optIdx', () => {
    const state = makeAskState();
    const rows = buildQuestionButtons('t1', state);
    const btn = rows[0].components[0];
    expect(btn.data).toMatchObject({
      custom_id: 'ask:t1:0:0',
    });
  });

  it('selected options use Success style', () => {
    const state = makeAskState({ selectedOptions: new Set([1]) });
    const rows = buildQuestionButtons('t1', state);
    // second button (index 1) should use Success style
    expect(rows[0].components[1].data).toMatchObject({
      style: 3, // ButtonStyle.Success = 3
    });
    // first button is not selected, should be Primary
    expect(rows[0].components[0].data).toMatchObject({
      style: 1, // ButtonStyle.Primary = 1
    });
  });

  it('includes an "Other" button', () => {
    const state = makeAskState();
    const rows = buildQuestionButtons('t1', state);
    const allComponents = rows.flatMap((r) => r.components);
    const otherBtn = allComponents.find(
      (c) => (c.data as Record<string, unknown>).custom_id === 'ask_other:t1:0',
    );
    expect(otherBtn).toBeDefined();
  });

  it('includes a "Confirm Selection" button in multi-select mode', () => {
    const state = makeAskState({ isMultiSelect: true });
    const rows = buildQuestionButtons('t1', state);
    const allComponents = rows.flatMap((r) => r.components);
    const submitBtn = allComponents.find(
      (c) => (c.data as Record<string, unknown>).custom_id === 'ask_submit:t1:0',
    );
    expect(submitBtn).toBeDefined();
  });

  it('does not include "Confirm Selection" button in single-select mode', () => {
    const state = makeAskState({ isMultiSelect: false });
    const rows = buildQuestionButtons('t1', state);
    const allComponents = rows.flatMap((r) => r.components);
    const submitBtn = allComponents.find(
      (c) => (c.data as Record<string, unknown>).custom_id === 'ask_submit:t1:0',
    );
    expect(submitBtn).toBeUndefined();
  });

  it('wraps to next row when more than 4 options', () => {
    const manyOptions = Array.from({ length: 6 }, (_, i) => ({
      label: `Option ${i}`,
      description: `Description ${i}`,
    }));
    const state = makeAskState({
      questions: [{ question: 'Q', header: 'H', options: manyOptions, multiSelect: false }],
    });
    const rows = buildQuestionButtons('t1', state);
    // 4 buttons per row, second row has remaining 2 + Other
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('returns at most 5 rows', () => {
    const manyOptions = Array.from({ length: 20 }, (_, i) => ({
      label: `Option ${i}`,
      description: `Description ${i}`,
    }));
    const state = makeAskState({
      questions: [{ question: 'Q', header: 'H', options: manyOptions, multiSelect: true }],
    });
    const rows = buildQuestionButtons('t1', state);
    expect(rows.length).toBeLessThanOrEqual(5);
  });

  it('truncates labels longer than 80 characters', () => {
    const longLabel = 'A'.repeat(100);
    const state = makeAskState({
      questions: [{ question: 'Q', header: 'H', options: [{ label: longLabel, description: '' }], multiSelect: false }],
    });
    const rows = buildQuestionButtons('t1', state);
    const btnLabel = (rows[0].components[0].data as Record<string, unknown>).label as string;
    expect(btnLabel.length).toBeLessThanOrEqual(80);
  });
});

describe('buildAnswerModal', () => {
  it('creates a Modal with the correct customId', () => {
    const modal = buildAnswerModal('t1', 'What do you want to do?', 2);
    expect(modal.data.custom_id).toBe('ask_modal:t1:2');
  });

  it('title is "Custom Answer"', () => {
    const modal = buildAnswerModal('t1', 'Q');
    expect(modal.data.title).toBe('Custom Answer');
  });

  it('contains one text input component', () => {
    const modal = buildAnswerModal('t1', 'Q');
    expect(modal.components.length).toBe(1);
  });

  it('defaults qIdx to 0', () => {
    const modal = buildAnswerModal('t1', 'Q');
    expect(modal.data.custom_id).toBe('ask_modal:t1:0');
  });

  it('truncates question text longer than 45 characters', () => {
    const longQuestion = 'A'.repeat(100);
    const modal = buildAnswerModal('t1', longQuestion);
    const row = modal.components[0];
    const input = row.components[0];
    expect((input.data as Record<string, unknown>).label).toHaveLength(45);
  });
});

// --- Mock ---------------------------------------------------

vi.mock('../modules/formatters.js', () => ({
  chunkMessage: vi.fn((text: string) => [text]),
}));

import { chunkMessage } from '../modules/formatters.js';

// --- Factory helpers ----------------------------------------

function makeEmbed(overrides?: Partial<APIEmbed>): APIEmbed {
  return { title: 'Test Embed', description: 'Content', ...overrides };
}

function makeChannel() {
  return { send: vi.fn().mockResolvedValue({ id: 'sent-1' }) } as unknown as SendableChannels;
}

function makeMsg() {
  return { edit: vi.fn().mockResolvedValue({ id: 'edited-1' }) } as unknown as Message;
}

function makeThread(archived = false) {
  return {
    archived,
    send: vi.fn().mockResolvedValue({ id: 'thread-msg-1' }),
    setArchived: vi.fn().mockResolvedValue(undefined),
  } as unknown as ThreadChannel;
}

function makeTextChannel() {
  return {
    threads: { create: vi.fn().mockResolvedValue({ id: 'new-thread' }) },
  } as unknown as TextChannel;
}

function makeInteraction() {
  return {
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue({ id: 'reply-1' }),
    followUp: vi.fn().mockResolvedValue({ id: 'followup-1' }),
  } as unknown as ChatInputCommandInteraction;
}

// --- sendEmbed ----------------------------------------------

describe('sendEmbed', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls channel.send with embeds', async () => {
    const channel = makeChannel();
    const embed = makeEmbed();
    await sendEmbed(channel, embed);

    expect(channel.send).toHaveBeenCalledWith({ embeds: [embed] });
  });

  it('returns the sent message', async () => {
    const channel = makeChannel();
    const result = await sendEmbed(channel, makeEmbed());

    expect(result).toEqual({ id: 'sent-1' });
  });
});

// --- sendEmbedWithApprovalButtons ---------------------------

describe('sendEmbedWithApprovalButtons', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends embed with approve and deny buttons', async () => {
    const channel = makeChannel();
    const embed = makeEmbed();
    await sendEmbedWithApprovalButtons(channel, embed, 'thread-42');

    expect(channel.send).toHaveBeenCalledTimes(1);
    const callArg = (channel.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.embeds).toEqual([embed]);
    expect(callArg.components).toHaveLength(1);
  });

  it('button customId contains threadId', async () => {
    const channel = makeChannel();
    await sendEmbedWithApprovalButtons(channel, makeEmbed(), 'thread-42');

    const callArg = (channel.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const row = callArg.components[0];
    const buttonIds = row.components.map(
      (c: { data: Record<string, unknown> }) => c.data.custom_id,
    );
    expect(buttonIds).toContain('approve:thread-42');
    expect(buttonIds).toContain('deny:thread-42');
  });
});

// --- sendEmbedWithAskButtons --------------------------------

describe('sendEmbedWithAskButtons', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends embed with pre-built buttons', async () => {
    const channel = makeChannel();
    const embed = makeEmbed();
    const state = makeAskState();
    const buttons = buildQuestionButtons('t1', state);

    await sendEmbedWithAskButtons(channel, embed, buttons);

    const callArg = (channel.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.embeds).toEqual([embed]);
    expect(callArg.components).toBe(buttons);
  });
});

// --- updateMessageEmbed -------------------------------------

describe('updateMessageEmbed', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates embed and clears components', async () => {
    const msg = makeMsg();
    const embed = makeEmbed();
    await updateMessageEmbed(msg, embed);

    expect(msg.edit).toHaveBeenCalledWith({ embeds: [embed], components: [] });
  });
});

// --- editMessageText ----------------------------------------

describe('editMessageText', () => {
  beforeEach(() => vi.clearAllMocks());

  it('edits to plain text and clears embeds and components', async () => {
    const msg = makeMsg();
    await editMessageText(msg, 'new text');

    expect(msg.edit).toHaveBeenCalledWith({
      content: 'new text',
      embeds: [],
      components: [],
    });
  });
});

// --- sendPlainInThread --------------------------------------

describe('sendPlainInThread', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends directly in non-archived thread without calling setArchived', async () => {
    const thread = makeThread(false);
    await sendPlainInThread(thread, 'hello');

    expect(thread.setArchived).not.toHaveBeenCalled();
    expect(thread.send).toHaveBeenCalledWith('hello');
  });

  it('unarchives thread before sending in archived thread', async () => {
    const thread = makeThread(true);
    await sendPlainInThread(thread, 'hello');

    expect(thread.setArchived).toHaveBeenCalledWith(false);
    expect(thread.send).toHaveBeenCalledWith('hello');
  });
});

// --- createThread -------------------------------------------

describe('createThread', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a public thread in the channel', async () => {
    const channel = makeTextChannel();
    await createThread(channel, 'Test Thread');

    expect(channel.threads.create).toHaveBeenCalledWith({
      name: 'Test Thread',
      autoArchiveDuration: 60,
      type: 11, // ChannelType.PublicThread
    });
  });
});

// --- sendInThread -------------------------------------------

describe('sendInThread', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends embed to thread', async () => {
    const thread = makeThread(false);
    const embed = makeEmbed();
    await sendInThread(thread, embed);

    expect(thread.setArchived).not.toHaveBeenCalled();
    expect(thread.send).toHaveBeenCalledWith({ embeds: [embed] });
  });

  it('unarchives thread before sending embed in archived thread', async () => {
    const thread = makeThread(true);
    const embed = makeEmbed();
    await sendInThread(thread, embed);

    expect(thread.setArchived).toHaveBeenCalledWith(false);
    expect(thread.send).toHaveBeenCalledWith({ embeds: [embed] });
  });
});

// --- sendTextInThread ---------------------------------------

describe('sendTextInThread', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends short text as a single message', async () => {
    const thread = makeThread(false);
    const result = await sendTextInThread(thread, 'short text');

    expect(chunkMessage).toHaveBeenCalledWith('short text', 2000);
    expect(thread.send).toHaveBeenCalledTimes(1);
    expect(thread.send).toHaveBeenCalledWith('short text');
    expect(result).toHaveLength(1);
  });

  it('splits long text into multiple messages', async () => {
    vi.mocked(chunkMessage).mockReturnValueOnce(['chunk1', 'chunk2']);
    const thread = makeThread(false);
    const result = await sendTextInThread(thread, 'very long text');

    expect(thread.send).toHaveBeenCalledTimes(2);
    expect(thread.send).toHaveBeenNthCalledWith(1, 'chunk1');
    expect(thread.send).toHaveBeenNthCalledWith(2, 'chunk2');
    expect(result).toHaveLength(2);
  });

  it('unarchives thread before sending', async () => {
    const thread = makeThread(true);
    await sendTextInThread(thread, 'text');

    expect(thread.setArchived).toHaveBeenCalledWith(false);
    expect(thread.send).toHaveBeenCalled();
  });

  it('returns array of all messages', async () => {
    vi.mocked(chunkMessage).mockReturnValueOnce(['a', 'b', 'c']);
    const thread = makeThread(false);
    const result = await sendTextInThread(thread, 'long text');

    expect(result).toHaveLength(3);
    result.forEach((msg) => expect(msg).toEqual({ id: 'thread-msg-1' }));
  });
});

// --- Interaction responses ----------------------------------

describe('deferReply', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls interaction.deferReply', async () => {
    const interaction = makeInteraction();
    await deferReply(interaction);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
  });
});

describe('deferReplyEphemeral', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls deferReply with Ephemeral flags', async () => {
    const interaction = makeInteraction();
    await deferReplyEphemeral(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: [MessageFlags.Ephemeral],
    });
  });
});

describe('editReply', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the edited message', async () => {
    const interaction = makeInteraction();
    const options = { content: 'done' };
    const result = await editReply(interaction, options);

    expect(interaction.editReply).toHaveBeenCalledWith(options);
    expect(result).toEqual({ id: 'reply-1' });
  });
});

describe('sendFollowUp', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends a follow-up message', async () => {
    const interaction = makeInteraction();
    const options = { content: 'follow-up content' };
    const result = await sendFollowUp(interaction, options);

    expect(interaction.followUp).toHaveBeenCalledWith(options);
    expect(result).toEqual({ id: 'followup-1' });
  });
});
