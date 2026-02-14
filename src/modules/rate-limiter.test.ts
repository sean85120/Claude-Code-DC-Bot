import { describe, it, expect } from 'vitest';
import { checkRateLimit, recordRequest } from './rate-limiter.js';

describe('checkRateLimit', () => {
  const config = { windowMs: 60_000, maxRequests: 3 };

  it('allows undefined entry', () => {
    const result = checkRateLimit(undefined, config, 1000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
  });

  it('allows empty timestamps', () => {
    const result = checkRateLimit({ timestamps: [] }, config, 1000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
  });

  it('allows when under the limit', () => {
    const now = 100_000;
    const result = checkRateLimit(
      { timestamps: [now - 10_000, now - 5_000] },
      config,
      now,
    );
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });

  it('denies when limit is reached', () => {
    const now = 100_000;
    const result = checkRateLimit(
      { timestamps: [now - 30_000, now - 20_000, now - 10_000] },
      config,
      now,
    );
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('does not count expired timestamps', () => {
    const now = 200_000;
    const result = checkRateLimit(
      { timestamps: [100_000, now - 10_000] }, // 100_000 is beyond the 60s window
      config,
      now,
    );
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it('calculates retryAfterMs correctly', () => {
    const now = 100_000;
    const oldest = now - 30_000;
    const result = checkRateLimit(
      { timestamps: [oldest, now - 20_000, now - 10_000] },
      config,
      now,
    );
    expect(result.allowed).toBe(false);
    // retryAfterMs = windowMs - (now - oldest) = 60000 - 30000 = 30000
    expect(result.retryAfterMs).toBe(30_000);
  });

  it('reaches limit with a single request when maxRequests = 1', () => {
    const now = 100_000;
    const result = checkRateLimit(
      { timestamps: [now - 1000] },
      { windowMs: 60_000, maxRequests: 1 },
      now,
    );
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('allows when all timestamps are expired', () => {
    const now = 1_000_000;
    const result = checkRateLimit(
      { timestamps: [100, 200, 300] },
      config,
      now,
    );
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
  });

  it('does not count timestamp exactly at the window boundary', () => {
    const now = 160_000;
    // timestamp 100_000, now - t = 60_000, not < 60_000, so it is expired
    const result = checkRateLimit(
      { timestamps: [100_000] },
      config,
      now,
    );
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
  });
});

describe('recordRequest', () => {
  it('creates new entry from undefined', () => {
    const entry = recordRequest(undefined, 1000, 60_000);
    expect(entry.timestamps).toEqual([1000]);
  });

  it('appends to existing timestamps', () => {
    const entry = recordRequest({ timestamps: [500] }, 1000, 60_000);
    expect(entry.timestamps).toEqual([500, 1000]);
  });

  it('clears expired timestamps', () => {
    const now = 200_000;
    const entry = recordRequest(
      { timestamps: [100_000, now - 10_000] },
      now,
      60_000,
    );
    // 100_000 is expired (200000 - 100000 = 100000 > 60000)
    expect(entry.timestamps).toEqual([now - 10_000, now]);
  });
});
