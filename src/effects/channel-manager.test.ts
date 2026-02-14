import { describe, it, expect } from 'vitest';
import { normalizeChannelName } from './channel-manager.js';

describe('normalizeChannelName', () => {
  it('adds claude- prefix', () => {
    expect(normalizeChannelName('myproject')).toBe('claude-myproject');
  });

  it('converts to lowercase', () => {
    expect(normalizeChannelName('MyProject')).toBe('claude-myproject');
  });

  it('replaces spaces with hyphens', () => {
    expect(normalizeChannelName('my project')).toBe('claude-my-project');
  });

  it('replaces special characters with hyphens', () => {
    expect(normalizeChannelName('my_project@v2')).toBe('claude-my-project-v2');
  });

  it('collapses consecutive hyphens', () => {
    expect(normalizeChannelName('my---project')).toBe('claude-my-project');
  });

  it('removes leading and trailing hyphens from the base name', () => {
    expect(normalizeChannelName('-my-project-')).toBe('claude-my-project');
  });

  it('handles mixed special characters', () => {
    expect(normalizeChannelName('My Cool Project! (v2)')).toBe('claude-my-cool-project-v2');
  });

  it('preserves existing hyphens', () => {
    expect(normalizeChannelName('my-project')).toBe('claude-my-project');
  });

  it('preserves numbers', () => {
    expect(normalizeChannelName('project123')).toBe('claude-project123');
  });

  it('truncates to 100 characters including prefix', () => {
    const longName = 'a'.repeat(150);
    const result = normalizeChannelName(longName);
    expect(result).toHaveLength(100);
    expect(result.startsWith('claude-')).toBe(true);
  });

  it('handles names that become empty after normalization', () => {
    expect(normalizeChannelName('!!!')).toBe('');
  });

  it('handles unicode characters', () => {
    expect(normalizeChannelName('projet-francais')).toBe('claude-projet-francais');
  });

  it('handles dots and underscores', () => {
    expect(normalizeChannelName('my.project_name')).toBe('claude-my-project-name');
  });

  it('handles already-valid names', () => {
    expect(normalizeChannelName('valid-channel-name')).toBe('claude-valid-channel-name');
  });

  it('avoids collisions with common channel names', () => {
    expect(normalizeChannelName('general')).toBe('claude-general');
  });
});
