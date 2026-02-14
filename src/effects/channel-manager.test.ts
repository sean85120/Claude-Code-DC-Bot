import { describe, it, expect } from 'vitest';
import { normalizeChannelName } from './channel-manager.js';

describe('normalizeChannelName', () => {
  it('converts to lowercase', () => {
    expect(normalizeChannelName('MyProject')).toBe('myproject');
  });

  it('replaces spaces with hyphens', () => {
    expect(normalizeChannelName('my project')).toBe('my-project');
  });

  it('replaces special characters with hyphens', () => {
    expect(normalizeChannelName('my_project@v2')).toBe('my-project-v2');
  });

  it('collapses consecutive hyphens', () => {
    expect(normalizeChannelName('my---project')).toBe('my-project');
  });

  it('removes leading and trailing hyphens', () => {
    expect(normalizeChannelName('-my-project-')).toBe('my-project');
  });

  it('handles mixed special characters', () => {
    expect(normalizeChannelName('My Cool Project! (v2)')).toBe('my-cool-project-v2');
  });

  it('preserves existing hyphens', () => {
    expect(normalizeChannelName('my-project')).toBe('my-project');
  });

  it('preserves numbers', () => {
    expect(normalizeChannelName('project123')).toBe('project123');
  });

  it('truncates to 100 characters', () => {
    const longName = 'a'.repeat(150);
    expect(normalizeChannelName(longName)).toHaveLength(100);
  });

  it('handles names that become empty after normalization', () => {
    expect(normalizeChannelName('!!!')).toBe('');
  });

  it('handles unicode characters', () => {
    expect(normalizeChannelName('projet-francais')).toBe('projet-francais');
  });

  it('handles dots and underscores', () => {
    expect(normalizeChannelName('my.project_name')).toBe('my-project-name');
  });

  it('handles already-valid names', () => {
    expect(normalizeChannelName('valid-channel-name')).toBe('valid-channel-name');
  });
});
