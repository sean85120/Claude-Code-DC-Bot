import type { RateLimitEntry } from '../modules/rate-limiter.js';

/** In-memory rate limit store, keyed by userId */
export class RateLimitStore {
  private entries = new Map<string, RateLimitEntry>();

  /**
   * Get the rate limit record for a specified user
   * @param userId - Discord user ID
   * @returns The rate limit record, or undefined if not found
   */
  getEntry(userId: string): RateLimitEntry | undefined {
    return this.entries.get(userId);
  }

  /**
   * Save or update the rate limit record for a specified user
   * @param userId - Discord user ID
   * @param entry - The updated rate limit record
   */
  setEntry(userId: string, entry: RateLimitEntry): void {
    this.entries.set(userId, entry);
  }
}
