import { describe, it, expect } from 'vitest';
import { RateLimitStore } from './rate-limit-store.js';

describe('RateLimitStore', () => {
  it('getEntry returns undefined when not set', () => {
    const store = new RateLimitStore();
    expect(store.getEntry('user1')).toBeUndefined();
  });

  it('setEntry / getEntry', () => {
    const store = new RateLimitStore();
    const entry = { timestamps: [1000, 2000] };
    store.setEntry('user1', entry);
    expect(store.getEntry('user1')).toEqual(entry);
  });

  it('different users are stored independently', () => {
    const store = new RateLimitStore();
    store.setEntry('user1', { timestamps: [100] });
    store.setEntry('user2', { timestamps: [200] });
    expect(store.getEntry('user1')?.timestamps).toEqual([100]);
    expect(store.getEntry('user2')?.timestamps).toEqual([200]);
  });
});
