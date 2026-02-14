import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the SDK before importing
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
import { startQuery, interruptQuery } from './claude-bridge.js';

describe('startQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls SDK query with correct arguments', async () => {
    const mockMessages = {
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sess-1' };
      },
    };
    vi.mocked(query).mockReturnValue(mockMessages as never);

    const onMessage = vi.fn();
    const onError = vi.fn();
    const onComplete = vi.fn();
    const abortController = new AbortController();

    await startQuery('hello', {
      cwd: '/test',
      model: 'claude-opus-4-6',
      permissionMode: 'default',
      abortController,
      onMessage,
      onError,
      onComplete,
    });

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'hello',
        options: expect.objectContaining({
          cwd: '/test',
          model: 'claude-opus-4-6',
          settingSources: ['project', 'local'],
        }),
      }),
    );
  });

  it('bypassPermissions is set correctly', async () => {
    const mockMessages = {
      [Symbol.asyncIterator]: async function* () {
        // empty
      },
    };
    vi.mocked(query).mockReturnValue(mockMessages as never);

    await startQuery('hello', {
      cwd: '/test',
      model: 'model',
      permissionMode: 'bypassPermissions',
      abortController: new AbortController(),
      onMessage: vi.fn(),
      onError: vi.fn(),
      onComplete: vi.fn(),
    });

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
        }),
      }),
    );
  });

  it('resume passes session id', async () => {
    const mockMessages = {
      [Symbol.asyncIterator]: async function* () {
        // empty
      },
    };
    vi.mocked(query).mockReturnValue(mockMessages as never);

    await startQuery('follow up', {
      cwd: '/test',
      model: 'model',
      permissionMode: 'default',
      abortController: new AbortController(),
      onMessage: vi.fn(),
      onError: vi.fn(),
      onComplete: vi.fn(),
      resume: 'prev-session-id',
    });

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          resume: 'prev-session-id',
        }),
      }),
    );
  });

  it('uses AsyncIterable prompt when attachments are present', async () => {
    const mockMessages = {
      [Symbol.asyncIterator]: async function* () {
        // empty
      },
    };
    vi.mocked(query).mockReturnValue(mockMessages as never);

    await startQuery('look at this image', {
      cwd: '/test',
      model: 'model',
      permissionMode: 'default',
      abortController: new AbortController(),
      onMessage: vi.fn(),
      onError: vi.fn(),
      onComplete: vi.fn(),
      attachments: [
        { type: 'image', base64: 'abc', mediaType: 'image/png', filename: 'pic.png' },
      ],
    });

    // prompt should be AsyncIterable, not string
    const callArgs = vi.mocked(query).mock.calls[0][0] as Record<string, unknown>;
    expect(typeof callArgs.prompt).not.toBe('string');
  });

  it('uses string prompt when no attachments', async () => {
    const mockMessages = {
      [Symbol.asyncIterator]: async function* () {
        // empty
      },
    };
    vi.mocked(query).mockReturnValue(mockMessages as never);

    await startQuery('plain text', {
      cwd: '/test',
      model: 'model',
      permissionMode: 'default',
      abortController: new AbortController(),
      onMessage: vi.fn(),
      onError: vi.fn(),
      onComplete: vi.fn(),
    });

    const callArgs = vi.mocked(query).mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.prompt).toBe('plain text');
  });

  it('calls onComplete when iteration finishes', async () => {
    const mockMessages = {
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sess-1' };
      },
    };
    vi.mocked(query).mockReturnValue(mockMessages as never);

    const onComplete = vi.fn();
    await startQuery('test', {
      cwd: '/test',
      model: 'model',
      permissionMode: 'default',
      abortController: new AbortController(),
      onMessage: vi.fn(),
      onError: vi.fn(),
      onComplete,
    });

    // wait for async iteration to complete
    await new Promise((r) => setTimeout(r, 600));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('calls onError when iteration throws', async () => {
    const mockMessages = {
      [Symbol.asyncIterator]: async function* () {
        throw new Error('SDK error');
      },
    };
    vi.mocked(query).mockReturnValue(mockMessages as never);

    const onError = vi.fn();
    await startQuery('test', {
      cwd: '/test',
      model: 'model',
      permissionMode: 'default',
      abortController: new AbortController(),
      onMessage: vi.fn(),
      onError,
      onComplete: vi.fn(),
    });

    await new Promise((r) => setTimeout(r, 600));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('SDK error');
  });

  it('AbortError calls onComplete instead of onError', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    const mockMessages = {
      [Symbol.asyncIterator]: async function* () {
        throw abortError;
      },
    };
    vi.mocked(query).mockReturnValue(mockMessages as never);

    const onError = vi.fn();
    const onComplete = vi.fn();
    await startQuery('test', {
      cwd: '/test',
      model: 'model',
      permissionMode: 'default',
      abortController: new AbortController(),
      onMessage: vi.fn(),
      onError,
      onComplete,
    });

    await new Promise((r) => setTimeout(r, 600));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('interruptQuery', () => {
  it('calls query.interrupt()', async () => {
    const mockQuery = {
      interrupt: vi.fn().mockResolvedValue(undefined),
    };
    await interruptQuery(mockQuery as never);
    expect(mockQuery.interrupt).toHaveBeenCalledTimes(1);
  });

  it('does not throw when interrupt fails', async () => {
    const mockQuery = {
      interrupt: vi.fn().mockRejectedValue(new Error('already done')),
    };
    await expect(interruptQuery(mockQuery as never)).resolves.toBeUndefined();
  });
});
