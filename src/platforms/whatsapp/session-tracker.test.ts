import { describe, it, expect } from 'vitest';
import { WhatsAppSessionTracker } from './session-tracker.js';

describe('WhatsAppSessionTracker', () => {
  it('creates a session and returns a valid thread ID', () => {
    const tracker = new WhatsAppSessionTracker();
    const threadId = tracker.createSession('123456@c.us');

    expect(threadId).toMatch(/^wa:123456@c\.us:[a-f0-9]+$/);
  });

  it('getActiveThreadId returns the active session', () => {
    const tracker = new WhatsAppSessionTracker();
    const threadId = tracker.createSession('chat1');

    expect(tracker.getActiveThreadId('chat1')).toBe(threadId);
    expect(tracker.getActiveThreadId('chat2')).toBeNull();
  });

  it('removeSession clears the active session', () => {
    const tracker = new WhatsAppSessionTracker();
    tracker.createSession('chat1');

    tracker.removeSession('chat1');
    expect(tracker.getActiveThreadId('chat1')).toBeNull();
  });

  it('creating a new session overwrites the old one', () => {
    const tracker = new WhatsAppSessionTracker();
    const first = tracker.createSession('chat1');
    const second = tracker.createSession('chat1');

    expect(first).not.toBe(second);
    expect(tracker.getActiveThreadId('chat1')).toBe(second);
  });
});

describe('WhatsAppSessionTracker.extractChatId', () => {
  it('extracts chat ID from thread ID', () => {
    expect(WhatsAppSessionTracker.extractChatId('wa:123@c.us:abc123'))
      .toBe('123@c.us');
  });

  it('returns input for non-wa thread IDs', () => {
    expect(WhatsAppSessionTracker.extractChatId('some-other-id'))
      .toBe('some-other-id');
  });
});

describe('WhatsAppSessionTracker.isWhatsAppThread', () => {
  it('returns true for wa: prefixed IDs', () => {
    expect(WhatsAppSessionTracker.isWhatsAppThread('wa:chat:session')).toBe(true);
  });

  it('returns false for other IDs', () => {
    expect(WhatsAppSessionTracker.isWhatsAppThread('discord-thread-id')).toBe(false);
    expect(WhatsAppSessionTracker.isWhatsAppThread('channel:ts')).toBe(false);
  });
});
