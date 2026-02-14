import { describe, it, expect } from 'vitest';
import { msUntilNextSummary } from './summary-scheduler.js';

describe('msUntilNextSummary', () => {
  it('returns positive delay for a future hour today', () => {
    const ms = msUntilNextSummary(23); // 11 PM UTC - likely in the future
    expect(ms).toBeGreaterThan(0);
    // Should be less than 24 hours
    expect(ms).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it('schedules for tomorrow if target hour has passed', () => {
    // Use hour 0 (midnight) — unless it's currently midnight, this will be tomorrow
    const now = new Date();
    if (now.getUTCHours() > 0) {
      const ms = msUntilNextSummary(0);
      // Should be more than ~23 hours minus current minutes
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    }
  });

  it('result is always within 0-24h range', () => {
    for (let hour = 0; hour < 24; hour++) {
      const ms = msUntilNextSummary(hour);
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    }
  });

  it('returns a delay that matches manual calculation', () => {
    const now = new Date();
    const targetHour = 12; // noon UTC
    const ms = msUntilNextSummary(targetHour);

    // Manually calculate expected delay
    const next = new Date();
    next.setUTCHours(targetHour, 0, 0, 0);
    if (next.getTime() <= now.getTime()) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    const expected = next.getTime() - now.getTime();

    // Allow 1 second of tolerance for test execution time
    expect(Math.abs(ms - expected)).toBeLessThan(1000);
  });
});
