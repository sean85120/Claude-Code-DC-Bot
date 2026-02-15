import { describe, it, expect } from 'vitest';
import { formatToolInput } from './tool-display.js';

const CWD = '/home/user/project';

describe('formatToolInput', () => {
  describe('Read', () => {
    it('shows relative path', () => {
      const result = formatToolInput('Read', { file_path: `${CWD}/src/index.ts` }, CWD);
      expect(result.title).toBe('Read File');
      expect(result.description).toContain('src/index.ts');
    });

    it('shows range when offset/limit are provided', () => {
      const result = formatToolInput('Read', { file_path: `${CWD}/file.ts`, offset: 10, limit: 20 }, CWD);
      expect(result.fields).toBeDefined();
      expect(result.fields![0].value).toContain('10');
      expect(result.fields![0].value).toContain('20');
    });

    it('has no fields when offset/limit are absent', () => {
      const result = formatToolInput('Read', { file_path: `${CWD}/file.ts` }, CWD);
      expect(result.fields).toBeUndefined();
    });

    it('does not crash when file_path is undefined', () => {
      const result = formatToolInput('Read', {}, CWD);
      expect(result.title).toBe('Read File');
      expect(result.description).toContain('Unknown');
    });
  });

  describe('Write', () => {
    it('shows file path and content size', () => {
      const result = formatToolInput('Write', {
        file_path: `${CWD}/out.ts`,
        content: 'line1\nline2\nline3',
      }, CWD);
      expect(result.title).toBe('Write File');
      expect(result.fields![0].value).toContain('3 lines');
    });

    it('shows content preview', () => {
      const result = formatToolInput('Write', {
        file_path: `${CWD}/out.ts`,
        content: 'const x = 1;\nconst y = 2;',
      }, CWD);
      expect(result.fields).toHaveLength(2);
      expect(result.fields![1].name).toContain('Preview');
      expect(result.fields![1].value).toContain('const x = 1;');
    });

    it('has no fields when content is absent', () => {
      const result = formatToolInput('Write', { file_path: `${CWD}/out.ts` }, CWD);
      expect(result.fields).toBeUndefined();
    });
  });

  describe('Edit', () => {
    it('shows unified diff with Changes field', () => {
      const result = formatToolInput('Edit', {
        file_path: `${CWD}/file.ts`,
        old_string: 'old line',
        new_string: 'new line',
      }, CWD);
      expect(result.title).toBe('Edit File');
      expect(result.fields).toHaveLength(2);
      expect(result.fields![0].name).toContain('Changes');
      expect(result.fields![0].value).toContain('-old line');
      expect(result.fields![0].value).toContain('+new line');
    });

    it('shows diff summary with line counts', () => {
      const result = formatToolInput('Edit', {
        file_path: `${CWD}/file.ts`,
        old_string: 'line1\nline2',
        new_string: 'line1\nline2\nline3',
      }, CWD);
      expect(result.fields![1].name).toContain('Summary');
      expect(result.fields![1].value).toContain('2');
      expect(result.fields![1].value).toContain('3');
    });

    it('shows new content field when only new_string is provided', () => {
      const result = formatToolInput('Edit', {
        file_path: `${CWD}/file.ts`,
        new_string: 'brand new content',
      }, CWD);
      expect(result.fields).toHaveLength(1);
      expect(result.fields![0].name).toContain('New Content');
      expect(result.fields![0].value).toContain('brand new content');
    });

    it('has no diff fields when old_string and new_string are both missing', () => {
      const result = formatToolInput('Edit', { file_path: `${CWD}/file.ts` }, CWD);
      expect(result.fields).toBeUndefined();
    });

    it('shows multi-line unified diff with context', () => {
      const result = formatToolInput('Edit', {
        file_path: `${CWD}/file.ts`,
        old_string: 'function foo(a) {\n  return a + 1;\n}',
        new_string: 'function foo(a, b) {\n  return a + b;\n}',
      }, CWD);
      expect(result.fields![0].value).toContain('-function foo(a)');
      expect(result.fields![0].value).toContain('+function foo(a, b)');
      expect(result.fields![0].value).toContain(' }');
    });
  });

  describe('Bash', () => {
    it('shows command', () => {
      const result = formatToolInput('Bash', { command: 'ls -la' }, CWD);
      expect(result.title).toBe('Run Command');
      expect(result.description).toContain('ls -la');
    });

    it('shows description when provided', () => {
      const result = formatToolInput('Bash', { command: 'npm test', description: 'run tests' }, CWD);
      expect(result.fields![0].value).toBe('run tests');
    });

    it('truncates overly long commands', () => {
      const longCmd = 'a'.repeat(1000);
      const result = formatToolInput('Bash', { command: longCmd }, CWD);
      expect(result.description!.length).toBeLessThan(600);
    });
  });

  describe('Glob', () => {
    it('shows pattern', () => {
      const result = formatToolInput('Glob', { pattern: '**/*.ts' }, CWD);
      expect(result.title).toBe('Search Files');
      expect(result.description).toContain('**/*.ts');
    });

    it('shows path when provided', () => {
      const result = formatToolInput('Glob', { pattern: '*.ts', path: `${CWD}/src` }, CWD);
      expect(result.fields).toBeDefined();
    });
  });

  describe('Grep', () => {
    it('shows pattern', () => {
      const result = formatToolInput('Grep', { pattern: 'TODO' }, CWD);
      expect(result.title).toBe('Search Content');
      expect(result.description).toContain('TODO');
    });

    it('shows fields when path and glob are provided', () => {
      const result = formatToolInput('Grep', {
        pattern: 'error',
        path: `${CWD}/src`,
        glob: '*.ts',
      }, CWD);
      expect(result.fields).toHaveLength(2);
    });
  });

  describe('WebFetch', () => {
    it('shows URL', () => {
      const result = formatToolInput('WebFetch', { url: 'https://example.com' }, CWD);
      expect(result.title).toBe('Fetch Web Page');
      expect(result.description).toContain('example.com');
    });
  });

  describe('WebSearch', () => {
    it('shows query', () => {
      const result = formatToolInput('WebSearch', { query: 'TypeScript tips' }, CWD);
      expect(result.title).toBe('Web Search');
      expect(result.description).toContain('TypeScript tips');
    });
  });

  describe('Task', () => {
    it('shows subtask description', () => {
      const result = formatToolInput('Task', { description: 'search files', subagent_type: 'Explore' }, CWD);
      expect(result.title).toBe('Launch Subtask');
      expect(result.description).toBe('search files');
      expect(result.fields![0].value).toContain('Explore');
    });

    it('uses default when description is missing', () => {
      const result = formatToolInput('Task', {}, CWD);
      expect(result.description).toBe('Execute subtask');
    });
  });

  describe('AskUserQuestion', () => {
    it('shows question and options', () => {
      const result = formatToolInput('AskUserQuestion', {
        questions: [{
          header: 'Choose',
          question: 'Which one to use?',
          options: [
            { label: 'A', description: 'Option A' },
            { label: 'B' },
          ],
        }],
      }, CWD);
      expect(result.title).toBe('Ask User');
      expect(result.description).toContain('Choose');
      expect(result.description).toContain('Which one to use?');
      expect(result.description).toContain('A');
    });

    it('returns default for empty questions', () => {
      const result = formatToolInput('AskUserQuestion', { questions: [] }, CWD);
      expect(result.description).toContain('Waiting');
    });

    it('returns default when questions field is missing', () => {
      const result = formatToolInput('AskUserQuestion', {}, CWD);
      expect(result.description).toContain('Waiting');
    });
  });

  describe('Unknown tool', () => {
    it('shows tool name and first few keys', () => {
      const result = formatToolInput('UnknownTool', { key1: 'val1', key2: 42 }, CWD);
      expect(result.title).toBe('UnknownTool');
      expect(result.description).toContain('key1');
      expect(result.description).toContain('val1');
    });

    it('shows tool name for empty input', () => {
      const result = formatToolInput('EmptyTool', {}, CWD);
      expect(result.description).toBe('EmptyTool');
    });

    it('JSON serializes object values', () => {
      const result = formatToolInput('X', { data: { nested: true } }, CWD);
      expect(result.description).toContain('nested');
    });
  });
});
