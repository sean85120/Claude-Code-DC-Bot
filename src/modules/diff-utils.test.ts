import { describe, it, expect } from 'vitest';
import { generateUnifiedDiff, truncateDiff, diffSummary } from './diff-utils.js';

describe('generateUnifiedDiff', () => {
  it('returns empty string for identical strings', () => {
    const result = generateUnifiedDiff('hello\nworld', 'hello\nworld', 'test.ts');
    expect(result).toBe('');
  });

  it('returns empty string for both empty strings', () => {
    const result = generateUnifiedDiff('', '', 'test.ts');
    expect(result).toBe('');
  });

  it('handles pure addition (empty old string)', () => {
    const result = generateUnifiedDiff('', 'line1\nline2', 'test.ts');
    expect(result).toContain('--- a/test.ts');
    expect(result).toContain('+++ b/test.ts');
    expect(result).toContain('+line1');
    expect(result).toContain('+line2');
    expect(result).toContain('@@ -0,0 +1,2 @@');
  });

  it('handles pure deletion (empty new string)', () => {
    const result = generateUnifiedDiff('line1\nline2', '', 'test.ts');
    expect(result).toContain('--- a/test.ts');
    expect(result).toContain('+++ b/test.ts');
    expect(result).toContain('-line1');
    expect(result).toContain('-line2');
    expect(result).toContain('@@ -1,2 +0,0 @@');
  });

  it('shows simple single-line change', () => {
    const old = 'const x = 1;';
    const newStr = 'const x = 2;';
    const result = generateUnifiedDiff(old, newStr, 'test.ts');
    expect(result).toContain('-const x = 1;');
    expect(result).toContain('+const x = 2;');
  });

  it('shows multi-line changes with context', () => {
    const old = [
      'line 1',
      'line 2',
      'line 3',
      'line 4',
      'line 5',
    ].join('\n');
    const newStr = [
      'line 1',
      'line 2',
      'line 3 modified',
      'line 4',
      'line 5',
    ].join('\n');
    const result = generateUnifiedDiff(old, newStr, 'test.ts', 2);
    expect(result).toContain(' line 1');
    expect(result).toContain(' line 2');
    expect(result).toContain('-line 3');
    expect(result).toContain('+line 3 modified');
    expect(result).toContain(' line 4');
    expect(result).toContain(' line 5');
  });

  it('shows additions in the middle of a file', () => {
    const old = 'line 1\nline 2\nline 3';
    const newStr = 'line 1\nline 2\nnew line\nline 3';
    const result = generateUnifiedDiff(old, newStr, 'test.ts');
    expect(result).toContain('+new line');
    expect(result).toContain(' line 2');
    expect(result).toContain(' line 3');
  });

  it('shows removals in the middle of a file', () => {
    const old = 'line 1\nline 2\nline 3\nline 4';
    const newStr = 'line 1\nline 4';
    const result = generateUnifiedDiff(old, newStr, 'test.ts');
    expect(result).toContain('-line 2');
    expect(result).toContain('-line 3');
    expect(result).toContain(' line 1');
    expect(result).toContain(' line 4');
  });

  it('includes diff header with file name', () => {
    const result = generateUnifiedDiff('a', 'b', 'src/foo/bar.ts');
    expect(result).toContain('--- a/src/foo/bar.ts');
    expect(result).toContain('+++ b/src/foo/bar.ts');
  });

  it('includes hunk header with line numbers', () => {
    const result = generateUnifiedDiff('old line', 'new line', 'test.ts');
    expect(result).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });

  it('handles unicode content', () => {
    const old = 'const greeting = "hello";';
    const newStr = 'const greeting = "こんにちは";';
    const result = generateUnifiedDiff(old, newStr, 'test.ts');
    expect(result).toContain('-const greeting = "hello";');
    expect(result).toContain('+const greeting = "こんにちは";');
  });

  it('handles mixed additions and removals', () => {
    const old = 'function foo(a) {\n  return a + 1;\n}';
    const newStr = 'function foo(a, b) {\n  return a + b;\n}';
    const result = generateUnifiedDiff(old, newStr, 'test.ts');
    expect(result).toContain('-function foo(a) {');
    expect(result).toContain('+function foo(a, b) {');
    expect(result).toContain('-  return a + 1;');
    expect(result).toContain('+  return a + b;');
    expect(result).toContain(' }');
  });

  it('respects contextLines parameter', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const oldStr = lines.join('\n');
    const newLines = [...lines];
    newLines[10] = 'modified line 11';
    const newStr = newLines.join('\n');

    // With 1 context line, we should see fewer context lines
    const result = generateUnifiedDiff(oldStr, newStr, 'test.ts', 1);
    expect(result).toContain('-line 11');
    expect(result).toContain('+modified line 11');
    // Should have context but limited
    expect(result).toContain(' line 10');
    expect(result).toContain(' line 12');
  });

  it('returns summary fallback for large files (>500 lines)', () => {
    const oldLines = Array.from({ length: 600 }, (_, i) => `old line ${i}`).join('\n');
    const newLines = Array.from({ length: 650 }, (_, i) => `new line ${i}`).join('\n');
    const result = generateUnifiedDiff(oldLines, newLines, 'big-file.ts');
    expect(result).toContain('diff too large');
    expect(result).toContain('600');
    expect(result).toContain('650');
    expect(result).toContain('+50');
    expect(result).not.toContain('@@ '); // No hunk headers
  });

  it('processes files just under 500 lines normally', () => {
    const lines = Array.from({ length: 499 }, (_, i) => `line ${i}`);
    const newLines = [...lines];
    newLines[250] = 'modified line';
    const result = generateUnifiedDiff(lines.join('\n'), newLines.join('\n'), 'test.ts');
    expect(result).toContain('-line 250');
    expect(result).toContain('+modified line');
    expect(result).toContain('@@ ');
  });

  it('handles file with trailing newlines', () => {
    const old = 'line1\nline2\n';
    const newStr = 'line1\nline2\nline3\n';
    const result = generateUnifiedDiff(old, newStr, 'test.ts');
    expect(result).toContain('+line3');
  });
});

describe('truncateDiff', () => {
  it('returns diff unchanged if under max length', () => {
    const diff = '--- a/test.ts\n+++ b/test.ts\n@@ -1,1 +1,1 @@\n-old\n+new';
    expect(truncateDiff(diff, 1000)).toBe(diff);
  });

  it('truncates long diffs at line boundaries', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `+line ${i}`);
    const diff = lines.join('\n');
    const result = truncateDiff(diff, 200);
    expect(result.length).toBeLessThanOrEqual(220); // Allow room for truncation message
    expect(result).toContain('... (truncated)');
  });

  it('handles single very long line', () => {
    const longLine = 'x'.repeat(2000);
    const result = truncateDiff(longLine, 500);
    expect(result.length).toBeLessThanOrEqual(500);
    expect(result).toContain('...');
  });

  it('preserves complete lines when possible', () => {
    const diff = 'short line 1\nshort line 2\nshort line 3';
    const result = truncateDiff(diff, 30);
    // Should contain at least one complete line
    expect(result).toContain('short line 1');
  });

  it('uses default maxLength of 900', () => {
    const longDiff = Array.from({ length: 200 }, (_, i) => `+line number ${i} with some content`).join('\n');
    const result = truncateDiff(longDiff);
    expect(result.length).toBeLessThanOrEqual(920); // 900 + truncation indicator
  });
});

describe('diffSummary', () => {
  it('shows positive delta for additions', () => {
    expect(diffSummary('a', 'a\nb\nc')).toBe('1 → 3 lines (+2)');
  });

  it('shows negative delta for removals', () => {
    expect(diffSummary('a\nb\nc', 'a')).toBe('3 → 1 lines (-2)');
  });

  it('shows zero delta for same line count', () => {
    expect(diffSummary('old', 'new')).toBe('1 → 1 lines (+0)');
  });

  it('handles empty old string', () => {
    expect(diffSummary('', 'a\nb')).toBe('0 → 2 lines (+2)');
  });

  it('handles empty new string', () => {
    expect(diffSummary('a\nb', '')).toBe('2 → 0 lines (-2)');
  });
});
