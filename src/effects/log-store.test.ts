import { describe, it, expect } from 'vitest';
import { LogStore, type LogEntry } from './log-store.js';

function makeEntry(overrides?: Partial<LogEntry>): LogEntry {
  return {
    timestamp: new Date(),
    level: 'info',
    module: 'Test',
    message: 'test message',
    ...overrides,
  };
}

describe('LogStore', () => {
  it('pushes and retrieves entries', () => {
    const store = new LogStore(10);
    store.push(makeEntry({ message: 'one' }));
    store.push(makeEntry({ message: 'two' }));

    expect(store.size).toBe(2);
    const entries = store.getRecent(10);
    expect(entries).toHaveLength(2);
    expect(entries[0].message).toBe('one');
    expect(entries[1].message).toBe('two');
  });

  it('evicts oldest entries when capacity is reached', () => {
    const store = new LogStore(3);
    store.push(makeEntry({ message: 'a' }));
    store.push(makeEntry({ message: 'b' }));
    store.push(makeEntry({ message: 'c' }));
    store.push(makeEntry({ message: 'd' }));

    expect(store.size).toBe(3);
    const entries = store.getRecent(10);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.message)).toEqual(['b', 'c', 'd']);
  });

  it('filters by level', () => {
    const store = new LogStore(10);
    store.push(makeEntry({ level: 'info', message: 'info msg' }));
    store.push(makeEntry({ level: 'error', message: 'error msg' }));
    store.push(makeEntry({ level: 'warn', message: 'warn msg' }));

    const errors = store.query({ level: 'error' });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('error msg');
  });

  it('filters by level case-insensitively', () => {
    const store = new LogStore(10);
    store.push(makeEntry({ level: 'ERROR', message: 'loud error' }));

    const errors = store.query({ level: 'error' });
    expect(errors).toHaveLength(1);
  });

  it('filters by module (case-insensitive substring)', () => {
    const store = new LogStore(10);
    store.push(makeEntry({ module: 'Bot', message: 'bot msg' }));
    store.push(makeEntry({ module: 'Claude', message: 'claude msg' }));
    store.push(makeEntry({ module: 'Interaction', message: 'inter msg' }));

    const result = store.query({ module: 'claude' });
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe('claude msg');
  });

  it('respects count limit', () => {
    const store = new LogStore(10);
    for (let i = 0; i < 10; i++) {
      store.push(makeEntry({ message: `msg-${i}` }));
    }

    const result = store.query({ count: 3 });
    expect(result).toHaveLength(3);
    expect(result.map((e) => e.message)).toEqual(['msg-7', 'msg-8', 'msg-9']);
  });

  it('returns empty array for empty store', () => {
    const store = new LogStore(10);
    expect(store.getRecent(5)).toEqual([]);
    expect(store.query()).toEqual([]);
    expect(store.size).toBe(0);
  });

  it('defaults count to 20 in query', () => {
    const store = new LogStore(50);
    for (let i = 0; i < 30; i++) {
      store.push(makeEntry({ message: `msg-${i}` }));
    }

    const result = store.query();
    expect(result).toHaveLength(20);
  });
});
