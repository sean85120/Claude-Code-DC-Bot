import { describe, it, expect } from 'vitest';
import { isUserAuthorized, isChannelAuthorized, canExecuteCommand, isAllowedCwd } from './permissions.js';
import type { BotConfig, Project } from '../types.js';

describe('isUserAuthorized', () => {
  it('returns true when in the allow list', () => {
    expect(isUserAuthorized('123', ['123', '456'])).toBe(true);
  });

  it('returns false when not in the allow list', () => {
    expect(isUserAuthorized('789', ['123', '456'])).toBe(false);
  });

  it('returns false for empty list', () => {
    expect(isUserAuthorized('123', [])).toBe(false);
  });
});

describe('isChannelAuthorized', () => {
  it('returns true when channel ID matches', () => {
    expect(isChannelAuthorized('ch1', 'ch1')).toBe(true);
  });

  it('returns true when parent channel ID matches (Thread)', () => {
    expect(isChannelAuthorized('thread1', 'ch1', 'ch1')).toBe(true);
  });

  it('returns false when neither matches', () => {
    expect(isChannelAuthorized('ch2', 'ch1', 'ch3')).toBe(false);
  });
});

describe('canExecuteCommand', () => {
  const config = {
    allowedUserIds: ['user1'],
    discordChannelId: 'ch1',
  } as BotConfig;

  it('allows authorized user from any channel', () => {
    const result = canExecuteCommand('user1', 'any-channel', config);
    expect(result.allowed).toBe(true);
  });

  it('denies when user does not match', () => {
    const result = canExecuteCommand('user2', 'ch1', config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('permission');
  });

  it('allows authorized user from a thread', () => {
    const result = canExecuteCommand('user1', 'thread1', config, 'ch1');
    expect(result.allowed).toBe(true);
  });
});

describe('isAllowedCwd', () => {
  const projects: Project[] = [
    { name: 'project-a', path: '/home/user/project-a' },
    { name: 'project-b', path: '/home/user/project-b' },
  ];

  it('returns true when path is in the project list', () => {
    expect(isAllowedCwd('/home/user/project-a', projects)).toBe(true);
  });

  it('returns false when path is not in the project list', () => {
    expect(isAllowedCwd('/home/user/other', projects)).toBe(false);
  });

  it('returns false for empty project list', () => {
    expect(isAllowedCwd('/home/user/project-a', [])).toBe(false);
  });

  it('sub-paths do not count as a match', () => {
    expect(isAllowedCwd('/home/user/project-a/src', projects)).toBe(false);
  });
});
