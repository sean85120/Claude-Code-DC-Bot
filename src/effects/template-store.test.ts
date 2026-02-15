import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TemplateStore } from './template-store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PromptTemplate } from '../types.js';

describe('TemplateStore', () => {
  let tempDir: string;
  let store: TemplateStore;

  const template: PromptTemplate = {
    name: 'test-template',
    promptText: 'Fix all bugs',
    cwd: '/tmp/project',
    model: 'claude-opus-4-6',
    createdBy: 'user1',
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'template-test-'));
    store = new TemplateStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('starts with empty list', () => {
    expect(store.list()).toEqual([]);
  });

  it('saves and retrieves a template', () => {
    store.save(template);
    expect(store.get('test-template')).toEqual(template);
    expect(store.list().length).toBe(1);
  });

  it('overwrites a template with same name', () => {
    store.save(template);
    const updated = { ...template, promptText: 'Updated prompt' };
    store.save(updated);
    expect(store.list().length).toBe(1);
    expect(store.get('test-template')?.promptText).toBe('Updated prompt');
  });

  it('deletes a template', () => {
    store.save(template);
    expect(store.delete('test-template')).toBe(true);
    expect(store.list().length).toBe(0);
  });

  it('returns false when deleting non-existent template', () => {
    expect(store.delete('nope')).toBe(false);
  });

  it('persists across instances', () => {
    store.save(template);
    const store2 = new TemplateStore(tempDir);
    expect(store2.get('test-template')).toEqual(template);
  });

  it('returns undefined for non-existent template', () => {
    expect(store.get('nope')).toBeUndefined();
  });
});
