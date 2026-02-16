import { describe, it, expect } from 'vitest';
import { isUserAuthorized, canExecuteCommand, isAllowedCwd, checkChannelRepoRestriction, getProjectFromChannel } from './permissions.js';
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

describe('canExecuteCommand', () => {
  const config = {
    allowedUserIds: ['user1'],
  } as BotConfig;

  it('allows authorized user', () => {
    const result = canExecuteCommand('user1', config);
    expect(result.allowed).toBe(true);
  });

  it('denies when user does not match', () => {
    const result = canExecuteCommand('user2', config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('permission');
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

describe('checkChannelRepoRestriction', () => {
  const projects: Project[] = [
    { name: 'my-app', path: '/home/user/my-app' },
    { name: 'backend', path: '/home/user/backend' },
  ];

  it('allows matching project in its own channel', () => {
    const result = checkChannelRepoRestriction('claude-my-app', '/home/user/my-app', projects);
    expect(result.allowed).toBe(true);
    expect(result.boundProjectName).toBe('my-app');
  });

  it('denies non-matching project in a project channel', () => {
    const result = checkChannelRepoRestriction('claude-my-app', '/home/user/backend', projects);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('my-app');
    expect(result.boundProjectName).toBe('my-app');
  });

  it('allows any project in non-project channels', () => {
    const result = checkChannelRepoRestriction('random-channel', '/home/user/my-app', projects);
    expect(result.allowed).toBe(true);
    expect(result.boundProjectName).toBeUndefined();
  });

  it('allows any project in general-like channels', () => {
    const result = checkChannelRepoRestriction('general', '/home/user/backend', projects);
    expect(result.allowed).toBe(true);
  });

  it('handles empty project list', () => {
    const result = checkChannelRepoRestriction('claude-my-app', '/some/path', []);
    expect(result.allowed).toBe(true);
  });

  it('denies from second project channel selecting first project', () => {
    const result = checkChannelRepoRestriction('claude-backend', '/home/user/my-app', projects);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('backend');
    expect(result.boundProjectName).toBe('backend');
  });

  it('allows second project in its own channel', () => {
    const result = checkChannelRepoRestriction('claude-backend', '/home/user/backend', projects);
    expect(result.allowed).toBe(true);
    expect(result.boundProjectName).toBe('backend');
  });
});

describe('getProjectFromChannel', () => {
  const projects: Project[] = [
    { name: 'my-app', path: '/home/user/my-app' },
    { name: 'backend', path: '/home/user/backend' },
  ];

  it('returns the matching project for a project channel', () => {
    const result = getProjectFromChannel('claude-my-app', projects);
    expect(result).toEqual({ name: 'my-app', path: '/home/user/my-app' });
  });

  it('returns the second project for its channel', () => {
    const result = getProjectFromChannel('claude-backend', projects);
    expect(result).toEqual({ name: 'backend', path: '/home/user/backend' });
  });

  it('returns null for a non-project channel', () => {
    const result = getProjectFromChannel('general', projects);
    expect(result).toBeNull();
  });

  it('returns null for an empty project list', () => {
    const result = getProjectFromChannel('claude-my-app', []);
    expect(result).toBeNull();
  });

  it('returns null for a random channel name', () => {
    const result = getProjectFromChannel('off-topic', projects);
    expect(result).toBeNull();
  });
});
