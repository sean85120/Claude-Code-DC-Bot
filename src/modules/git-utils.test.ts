import { describe, it, expect } from 'vitest';
import { parseGitDiffStat, parseGitNumstat } from './git-utils.js';

describe('parseGitNumstat', () => {
  it('parses typical numstat output', () => {
    const output = `20\t5\tsrc/index.ts
15\t3\tsrc/config.ts
10\t4\tsrc/types.ts`;

    const result = parseGitNumstat(output);
    expect(result).not.toBeNull();
    expect(result!.filesChanged).toBe(3);
    expect(result!.insertions).toBe(45);
    expect(result!.deletions).toBe(12);
    expect(result!.files[0]).toEqual({ path: 'src/index.ts', insertions: 20, deletions: 5 });
  });

  it('handles binary files (- marks)', () => {
    const output = `-\t-\timage.png
10\t2\tsrc/index.ts`;

    const result = parseGitNumstat(output);
    expect(result).not.toBeNull();
    expect(result!.filesChanged).toBe(2);
    expect(result!.files[0]).toEqual({ path: 'image.png', insertions: 0, deletions: 0 });
  });

  it('returns null for empty output', () => {
    expect(parseGitNumstat('')).toBeNull();
  });

  it('returns null for unrecognizable output', () => {
    expect(parseGitNumstat('nothing here')).toBeNull();
  });
});

describe('parseGitDiffStat', () => {
  it('parses a typical git diff --stat output', () => {
    const output = ` src/index.ts   | 20 +++++-----
 src/config.ts  | 15 +++---
 src/types.ts   | 10 ++++------
 3 files changed, 45 insertions(+), 12 deletions(-)`;

    const result = parseGitDiffStat(output);
    expect(result).not.toBeNull();
    expect(result!.filesChanged).toBe(3);
    expect(result!.insertions).toBe(45);
    expect(result!.deletions).toBe(12);
    expect(result!.files.length).toBe(3);
    expect(result!.files[0].path).toBe('src/index.ts');
  });

  it('parses insertions only', () => {
    const output = ` src/new.ts | 10 ++++++++++
 1 file changed, 10 insertions(+)`;

    const result = parseGitDiffStat(output);
    expect(result).not.toBeNull();
    expect(result!.filesChanged).toBe(1);
    expect(result!.insertions).toBe(10);
    expect(result!.deletions).toBe(0);
  });

  it('parses deletions only', () => {
    const output = ` src/old.ts | 5 -----
 1 file changed, 5 deletions(-)`;

    const result = parseGitDiffStat(output);
    expect(result).not.toBeNull();
    expect(result!.filesChanged).toBe(1);
    expect(result!.insertions).toBe(0);
    expect(result!.deletions).toBe(5);
  });

  it('returns null for empty output', () => {
    expect(parseGitDiffStat('')).toBeNull();
  });

  it('returns null for output with no recognizable patterns', () => {
    expect(parseGitDiffStat('nothing here')).toBeNull();
  });
});
