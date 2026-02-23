import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../effects/logger.js', () => ({
  logger: { child: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) },
}));
vi.mock('../modules/embeds.js', () => ({
  buildFollowUpEmbed: vi.fn().mockReturnValue({ title: 'follow-up' }),
}));
vi.mock('../modules/permissions.js', () => ({
  isUserAuthorized: vi.fn().mockReturnValue(true),
}));

import type { PlatformAdapter, PlatformInteraction } from '../platforms/types.js';
import type { BotConfig, FileAttachment, SessionState } from '../types.js';
import type { ThreadMessageHandlerDeps } from './thread-message-handler.js';
import { StateStore } from '../effects/state-store.js';
import { classifyAttachment, createThreadMessageHandler } from './thread-message-handler.js';
import { buildFollowUpEmbed } from '../modules/embeds.js';
import { isUserAuthorized } from '../modules/permissions.js';

describe('classifyAttachment', () => {
  // Image types
  it('image/jpeg returns image', () => {
    expect(classifyAttachment('image/jpeg', 'photo.jpg')).toBe('image');
  });

  it('image/png returns image', () => {
    expect(classifyAttachment('image/png', 'screenshot.png')).toBe('image');
  });

  it('image/gif returns image', () => {
    expect(classifyAttachment('image/gif', 'anim.gif')).toBe('image');
  });

  it('image/webp returns image', () => {
    expect(classifyAttachment('image/webp', 'pic.webp')).toBe('image');
  });

  it('unsupported image format returns null', () => {
    expect(classifyAttachment('image/bmp', 'old.bmp')).toBeNull();
  });

  // PDF
  it('application/pdf returns document', () => {
    expect(classifyAttachment('application/pdf', 'doc.pdf')).toBe('document');
  });

  // Text files (by file extension)
  it('.ts returns text', () => {
    expect(classifyAttachment('application/octet-stream', 'index.ts')).toBe('text');
  });

  it('.py returns text', () => {
    expect(classifyAttachment(null, 'script.py')).toBe('text');
  });

  it('.json returns text', () => {
    expect(classifyAttachment(null, 'config.json')).toBe('text');
  });

  it('.md returns text', () => {
    expect(classifyAttachment(null, 'README.md')).toBe('text');
  });

  it('.sh returns text', () => {
    expect(classifyAttachment(null, 'deploy.sh')).toBe('text');
  });

  it('.env returns text', () => {
    expect(classifyAttachment(null, '.env')).toBe('text');
  });

  it('.dockerfile returns text', () => {
    expect(classifyAttachment(null, 'app.dockerfile')).toBe('text');
  });

  // text/* content type fallback
  it('text/plain returns text', () => {
    expect(classifyAttachment('text/plain', 'unknown.xyz')).toBe('text');
  });

  it('text/csv returns text', () => {
    expect(classifyAttachment('text/csv', 'data.dat')).toBe('text');
  });

  // Unsupported types
  it('unrecognized content type and extension returns null', () => {
    expect(classifyAttachment('application/zip', 'archive.zip')).toBeNull();
  });

  it('null content type and unrecognized extension returns null', () => {
    expect(classifyAttachment(null, 'binary.exe')).toBeNull();
  });

  it('no extension and no content type returns null', () => {
    expect(classifyAttachment(null, 'Makefile')).toBeNull();
  });

  // Case sensitivity
  it('file extension is case insensitive', () => {
    expect(classifyAttachment(null, 'Main.TS')).toBe('text');
  });

  // Image contentType takes priority over extension
  it('image contentType takes priority over .txt extension', () => {
    expect(classifyAttachment('image/png', 'misleading.txt')).toBe('image');
  });

  // PDF contentType takes priority over extension
  it('pdf contentType takes priority over extension', () => {
    expect(classifyAttachment('application/pdf', 'file.unknown')).toBe('document');
  });
});

// ─── createThreadMessageHandler ────────────────────

function makeSession(threadId: string, overrides?: Partial<SessionState>): SessionState {
  return {
    sessionId: 'sess-abc',
    platform: 'discord',
    status: 'waiting_input',
    threadId,
    userId: 'u1',
    startedAt: new Date(),
    lastActivityAt: new Date(),
    promptText: 'original prompt',
    cwd: '/test',
    model: 'claude-sonnet',
    toolCount: 0,
    tools: {},
    pendingApproval: null,
    abortController: new AbortController(),
    transcript: [],
    allowedTools: new Set(),
    ...overrides,
  };
}

function makePI(overrides?: Partial<PlatformInteraction>): PlatformInteraction {
  return {
    userId: 'u1',
    threadId: 'thread-1',
    platform: 'discord',
    text: 'Please continue the analysis',
    raw: {},
    ...overrides,
  };
}

function makeMockAdapter() {
  return {
    platform: 'discord' as const,
    messageLimit: 2000,
    sendRichMessage: vi.fn().mockResolvedValue({ id: 'msg1', threadId: 't1', platform: 'discord' }),
    sendText: vi.fn().mockResolvedValue([]),
    downloadAttachments: vi.fn().mockResolvedValue([]),
  } as unknown as PlatformAdapter;
}

function makeDeps(store: StateStore, overrides?: Partial<ThreadMessageHandlerDeps>): ThreadMessageHandlerDeps {
  return {
    config: {
      discordToken: 'token',
      discordGuildId: 'guild-1',
      discordChannelId: 'ch-1',
      discordClientId: 'client-id',
      allowedUserIds: ['u1'],
      defaultCwd: '/test',
      defaultModel: 'claude-sonnet',
      defaultPermissionMode: 'default',
      maxMessageLength: 2000,
      streamUpdateIntervalMs: 2000,
      rateLimitWindowMs: 60000,
      rateLimitMaxRequests: 10,
      projects: [],
      botRepoPath: '/test',
      approvalTimeoutMs: 300000,
      sessionIdleTimeoutMs: 1800000,
    } as BotConfig,
    store,
    adapter: makeMockAdapter(),
    startClaudeQuery: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('createThreadMessageHandler', () => {
  let store: StateStore;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isUserAuthorized).mockReturnValue(true);
    vi.unstubAllGlobals();
    store = new StateStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ignores when no matching Session exists', async () => {
    // No session in store
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    await handler(makePI());

    expect(deps.startClaudeQuery).not.toHaveBeenCalled();
  });

  it('ignores when not in waiting_input state', async () => {
    store.setSession('thread-1', makeSession('thread-1', { status: 'running' }));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    await handler(makePI());

    expect(deps.startClaudeQuery).not.toHaveBeenCalled();
  });

  it('ignores unauthorized users', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);
    vi.mocked(isUserAuthorized).mockReturnValue(false);

    await handler(makePI());

    expect(deps.startClaudeQuery).not.toHaveBeenCalled();
  });

  it('ignores when no text and no attachments', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    await handler(makePI({ text: '' }));

    expect(deps.startClaudeQuery).not.toHaveBeenCalled();
  });

  it('ignores when only whitespace text and no attachments', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    await handler(makePI({ text: '   ' }));

    expect(deps.startClaudeQuery).not.toHaveBeenCalled();
  });

  it('replies with warning when sessionId is missing', async () => {
    store.setSession('thread-1', makeSession('thread-1', { sessionId: null }));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    await handler(makePI());

    expect((deps.adapter as any).sendText).toHaveBeenCalledWith('thread-1', '⚠️ Unable to resume conversation: missing Session ID');
    expect(deps.startClaudeQuery).not.toHaveBeenCalled();
  });

  it('plain text follow-up: updates state and calls startClaudeQuery', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    await handler(makePI({ text: 'What is the next step?' }));

    // Verify store is updated to running
    const session = store.getSession('thread-1');
    expect(session?.status).toBe('running');
    expect(session?.promptText).toBe('What is the next step?');

    // Verify adapter.sendRichMessage was called
    expect((deps.adapter as any).sendRichMessage).toHaveBeenCalled();

    // Verify buildFollowUpEmbed was called
    expect(buildFollowUpEmbed).toHaveBeenCalledWith('What is the next step?', 0, []);

    // Verify startClaudeQuery was called
    expect(deps.startClaudeQuery).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'thread-1', status: 'running' }),
      'thread-1',
    );
  });

  it('records transcript', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    await handler(makePI({ text: 'Continue' }));

    const session = store.getSession('thread-1');
    expect(session?.transcript).toHaveLength(1);
    expect(session?.transcript[0]).toMatchObject({
      type: 'user',
      content: 'Continue',
    });
    expect(session?.transcript[0]?.timestamp).toBeInstanceOf(Date);
  });

  it('downloads image attachments and converts to base64', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const mockAdapter = makeMockAdapter();
    vi.mocked(mockAdapter.downloadAttachments).mockResolvedValue([
      { type: 'image', base64: 'iVBORw0KGgo=', mediaType: 'image/png', filename: 'screenshot.png' },
    ] as FileAttachment[]);
    const deps = makeDeps(store, { adapter: mockAdapter });
    const handler = createThreadMessageHandler(deps);

    await handler(makePI({ text: 'Look at this image' }));

    // Verify startClaudeQuery was called and session contains image attachments
    const session = store.getSession('thread-1');
    expect(session?.attachments).toHaveLength(1);
    expect(session?.attachments?.[0]).toMatchObject({
      type: 'image',
      mediaType: 'image/png',
      filename: 'screenshot.png',
    });
    expect(session?.attachments?.[0]?.base64).toBeTruthy();
  });

  it('downloads text attachments and saves textContent', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const mockAdapter = makeMockAdapter();
    vi.mocked(mockAdapter.downloadAttachments).mockResolvedValue([
      { type: 'text', base64: '', mediaType: 'application/octet-stream', filename: 'index.ts', textContent: 'console.log("hello");' },
    ] as FileAttachment[]);
    const deps = makeDeps(store, { adapter: mockAdapter });
    const handler = createThreadMessageHandler(deps);

    await handler(makePI({ text: '' }));

    // Text file content is embedded in prompt, not in attachments (those are rich attachments)
    const session = store.getSession('thread-1');
    // promptText should contain file content
    expect(session?.promptText).toContain('index.ts');
    expect(session?.promptText).toContain('console.log("hello");');
  });

  it('skips unsupported attachment types', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    // adapter.downloadAttachments returns empty when unsupported types are filtered by adapter
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    // No text, downloadAttachments returns [] (default mock) -> ignored
    await handler(makePI({ text: '' }));

    // No text and no attachments -> message is ignored
    expect(deps.startClaudeQuery).not.toHaveBeenCalled();
  });

  it('skips attachments exceeding size limit', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    // adapter.downloadAttachments returns empty when oversized files are filtered by adapter
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    // No text, downloadAttachments returns [] (default mock) -> ignored
    await handler(makePI({ text: '' }));

    // No attachments and no text -> ignored
    expect(deps.startClaudeQuery).not.toHaveBeenCalled();
  });

  it('skips text files exceeding 1MB limit', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    // adapter.downloadAttachments returns empty when oversized text files are filtered by adapter
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    // No text, downloadAttachments returns [] (default mock) -> ignored
    await handler(makePI({ text: '' }));

    expect(deps.startClaudeQuery).not.toHaveBeenCalled();
  });

  it('skips attachment when fetch fails', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    // adapter.downloadAttachments returns empty when fetch fails internally
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    // No text, downloadAttachments returns [] (default mock) -> ignored
    await handler(makePI({ text: '' }));

    expect(deps.startClaudeQuery).not.toHaveBeenCalled();
  });

  it('continues when fetch fails but text is present', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    // adapter.downloadAttachments returns empty (fetch failed), but text is present
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    await handler(makePI({ text: 'Analyze this' }));

    // Text is still present, failed attachments are skipped, should continue
    expect(deps.startClaudeQuery).toHaveBeenCalled();
    const session = store.getSession('thread-1');
    expect(session?.promptText).toBe('Analyze this');
  });

  it('combines prompt when text and files are both present', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const mockAdapter = makeMockAdapter();
    vi.mocked(mockAdapter.downloadAttachments).mockResolvedValue([
      { type: 'text', base64: '', mediaType: 'application/octet-stream', filename: 'app.ts', textContent: 'const x = 1;' },
      { type: 'image', base64: 'iVBORw0KGgo=', mediaType: 'image/png', filename: 'ui.png' },
    ] as FileAttachment[]);
    const deps = makeDeps(store, { adapter: mockAdapter });
    const handler = createThreadMessageHandler(deps);

    await handler(makePI({ text: 'Please check these files' }));

    const session = store.getSession('thread-1');
    // Prompt should contain user text + text file content
    expect(session?.promptText).toContain('Please check these files');
    expect(session?.promptText).toContain('app.ts');
    expect(session?.promptText).toContain('const x = 1;');

    // Images should be in attachments (rich attachments)
    expect(session?.attachments).toHaveLength(1);
    expect(session?.attachments?.[0]?.type).toBe('image');

    // buildFollowUpEmbed should receive complete information
    expect(buildFollowUpEmbed).toHaveBeenCalledWith(
      expect.stringContaining('Please check these files'),
      2,
      ['app.ts', 'ui.png'],
    );
  });

  it('uses default prompt when only attachments and no text', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const mockAdapter = makeMockAdapter();
    vi.mocked(mockAdapter.downloadAttachments).mockResolvedValue([
      { type: 'image', base64: 'iVBORw0KGgo=', mediaType: 'image/png', filename: 'photo.png' },
    ] as FileAttachment[]);
    const deps = makeDeps(store, { adapter: mockAdapter });
    const handler = createThreadMessageHandler(deps);

    await handler(makePI({ text: '' }));

    const session = store.getSession('thread-1');
    // No text and no text file content -> prompt should be default value
    expect(session?.promptText).toBe('(Please see attachments)');

    // buildFollowUpEmbed first argument should be '(See attachments)'
    expect(buildFollowUpEmbed).toHaveBeenCalledWith('(See attachments)', 1, ['photo.png']);
  });

  it('updates status to error when startClaudeQuery throws', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const startClaudeQuery = vi.fn().mockRejectedValue(new Error('Claude crashed'));
    const deps = makeDeps(store, { startClaudeQuery });
    const handler = createThreadMessageHandler(deps);

    await handler(makePI());

    // startClaudeQuery's .catch is fire-and-forget, need to wait for microtasks to settle
    await vi.waitFor(() => {
      const session = store.getSession('thread-1');
      expect(session?.status).toBe('error');
    });
  });

  it('sets new AbortController when updating Session', async () => {
    const originalController = new AbortController();
    store.setSession('thread-1', makeSession('thread-1', { abortController: originalController }));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    await handler(makePI({ text: 'Continue' }));

    const session = store.getSession('thread-1');
    expect(session?.abortController).not.toBe(originalController);
    expect(session?.abortController).toBeInstanceOf(AbortController);
  });

  it('clears pendingApproval when updating Session', async () => {
    store.setSession('thread-1', makeSession('thread-1', {
      pendingApproval: {
        toolName: 'Bash',
        toolInput: { command: 'ls' },
        messageId: 'old-msg',
        resolve: vi.fn(),
        createdAt: new Date(),
      },
    }));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    await handler(makePI({ text: 'Continue' }));

    const session = store.getSession('thread-1');
    expect(session?.pendingApproval).toBeNull();
  });

  it('transcript records include attachment summary', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const mockAdapter = makeMockAdapter();
    vi.mocked(mockAdapter.downloadAttachments).mockResolvedValue([
      { type: 'image', base64: 'iQ==', mediaType: 'image/png', filename: 'shot.png' },
    ] as FileAttachment[]);
    const deps = makeDeps(store, { adapter: mockAdapter });
    const handler = createThreadMessageHandler(deps);

    await handler(makePI({ text: 'Look at the image' }));

    const session = store.getSession('thread-1');
    expect(session?.transcript).toHaveLength(1);
    expect(session?.transcript[0]?.content).toContain('Look at the image');
    expect(session?.transcript[0]?.content).toContain('shot.png');
  });
});
