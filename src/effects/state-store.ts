import type { SessionState, PendingApproval, PermissionResult } from '../types.js';

/** In-memory session state management, keyed by Discord Thread ID */
export class StateStore {
  private sessions = new Map<string, SessionState>();

  /**
   * Get the session for a specified Thread
   * @param threadId - Discord Thread ID
   * @returns The session state, or null if not found
   */
  getSession(threadId: string): SessionState | null {
    return this.sessions.get(threadId) ?? null;
  }

  /**
   * Save a session state
   * @param threadId - Discord Thread ID
   * @param state - The complete session state
   */
  setSession(threadId: string, state: SessionState): void {
    this.sessions.set(threadId, state);
  }

  /**
   * Partially update session fields, also refreshing lastActivityAt
   * @param threadId - Discord Thread ID
   * @param update - The fields to update
   */
  updateSession(threadId: string, update: Partial<SessionState>): void {
    const session = this.sessions.get(threadId);
    if (!session) return;
    Object.assign(session, update, { lastActivityAt: new Date() });
  }

  /**
   * Clear and delete a session
   * @param threadId - Discord Thread ID
   */
  clearSession(threadId: string): void {
    this.sessions.delete(threadId);
  }

  /**
   * Record a tool usage, incrementing the count and refreshing lastActivityAt
   * @param threadId - Discord Thread ID
   * @param toolName - The name of the tool used
   */
  recordToolUse(threadId: string, toolName: string): void {
    const session = this.sessions.get(threadId);
    if (!session) return;
    session.toolCount++;
    session.tools[toolName] = (session.tools[toolName] || 0) + 1;
    session.lastActivityAt = new Date();
  }

  /**
   * Get the pending approval item for a specified session
   * @param threadId - Discord Thread ID
   * @returns The pending approval item, or null if not found
   */
  getPendingApproval(threadId: string): PendingApproval | null {
    const session = this.sessions.get(threadId);
    return session?.pendingApproval ?? null;
  }

  /**
   * Set a pending approval item, also switching the session status to `awaiting_permission`
   * @param threadId - Discord Thread ID
   * @param approval - The pending approval item
   */
  setPendingApproval(threadId: string, approval: PendingApproval): void {
    const session = this.sessions.get(threadId);
    if (!session) return;
    session.pendingApproval = approval;
    session.status = 'awaiting_permission';
  }

  /**
   * Resolve a pending approval: call resolve, then clear the pending item and restore `running` status
   * @param threadId - Discord Thread ID
   * @param result - The approval result (allow/deny)
   */
  resolvePendingApproval(threadId: string, result: PermissionResult): void {
    const session = this.sessions.get(threadId);
    if (!session?.pendingApproval) return;
    session.pendingApproval.resolve(result);
    session.pendingApproval = null;
    session.status = 'running';
  }

  /**
   * Get all active sessions (excluding completed and error statuses)
   * @returns Map of threadId to SessionState
   */
  getAllActiveSessions(): Map<string, SessionState> {
    const active = new Map<string, SessionState>();
    for (const [threadId, session] of this.sessions) {
      if (session.status !== 'completed' && session.status !== 'error') {
        active.set(threadId, session);
      }
    }
    return active;
  }

  /**
   * Get the count of active sessions
   * @returns The number of sessions not in completed/error status
   */
  getActiveSessionCount(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.status !== 'completed' && session.status !== 'error') {
        count++;
      }
    }
    return count;
  }
}
