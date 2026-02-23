import { randomUUID } from 'crypto';

/**
 * Tracks virtual sessions per WhatsApp chat.
 * Each chat can have at most one active session at a time.
 * Thread IDs are formatted as `wa:{chatId}:{sessionUUID}`
 */
export class WhatsAppSessionTracker {
  /** Map of chatId → active threadId */
  private activeSessions = new Map<string, string>();

  /** Create a new virtual session for a chat, returning the thread ID */
  createSession(chatId: string): string {
    const sessionId = randomUUID().slice(0, 8);
    const threadId = `wa:${chatId}:${sessionId}`;
    this.activeSessions.set(chatId, threadId);
    return threadId;
  }

  /** Get the active thread ID for a chat, or null if none */
  getActiveThreadId(chatId: string): string | null {
    return this.activeSessions.get(chatId) ?? null;
  }

  /** Remove the active session for a chat */
  removeSession(chatId: string): void {
    this.activeSessions.delete(chatId);
  }

  /** Extract the chatId from a thread ID */
  static extractChatId(threadId: string): string {
    // Format: wa:{chatId}:{sessionId}
    const parts = threadId.split(':');
    if (parts.length >= 3 && parts[0] === 'wa') {
      // chatId may itself contain colons (unlikely but safe)
      return parts.slice(1, -1).join(':');
    }
    return threadId;
  }

  /** Check if a thread ID is a WhatsApp thread */
  static isWhatsAppThread(threadId: string): boolean {
    return threadId.startsWith('wa:');
  }
}
