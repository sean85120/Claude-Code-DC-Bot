import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PromptTemplate } from '../types.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'TemplateStore' });

/**
 * Persistent template storage, backed by a JSON file.
 */
export class TemplateStore {
  private dataFilePath: string;
  private templates: PromptTemplate[];

  constructor(dataDir = process.cwd()) {
    this.dataFilePath = resolve(dataDir, 'templates.json');
    this.templates = this.loadFromDisk();
  }

  private loadFromDisk(): PromptTemplate[] {
    if (!existsSync(this.dataFilePath)) return [];
    try {
      const raw = readFileSync(this.dataFilePath, 'utf-8');
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      log.warn({ err: error }, 'Failed to load templates, starting fresh');
      return [];
    }
  }

  private saveToDisk(): boolean {
    try {
      writeFileSync(this.dataFilePath, JSON.stringify(this.templates, null, 2), 'utf-8');
      return true;
    } catch (error) {
      log.error({ err: error }, 'Failed to save templates');
      return false;
    }
  }

  /** Save a new template (overwrites if name exists). Returns false if persistence failed. */
  save(template: PromptTemplate): boolean {
    const idx = this.templates.findIndex((t) => t.name === template.name);
    if (idx >= 0) {
      this.templates[idx] = template;
    } else {
      this.templates.push(template);
    }
    const ok = this.saveToDisk();
    if (ok) log.info({ name: template.name }, 'Template saved');
    return ok;
  }

  /** List all templates */
  list(): PromptTemplate[] {
    return [...this.templates];
  }

  /** Get a template by name */
  get(name: string): PromptTemplate | undefined {
    return this.templates.find((t) => t.name === name);
  }

  /** Delete a template by name. Returns true if found and deleted. */
  delete(name: string): boolean {
    const idx = this.templates.findIndex((t) => t.name === name);
    if (idx < 0) return false;
    this.templates.splice(idx, 1);
    const ok = this.saveToDisk();
    if (ok) log.info({ name }, 'Template deleted');
    return ok;
  }
}
