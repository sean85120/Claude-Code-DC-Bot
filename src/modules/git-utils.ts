import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitDiffSummary } from '../types.js';

const execFileAsync = promisify(execFile);

/**
 * Get a summary of uncommitted git changes in the given directory.
 * Returns null if not a git repo or no changes.
 */
export async function getGitDiffSummary(cwd: string): Promise<GitDiffSummary | null> {
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--stat', 'HEAD'], {
      cwd,
      timeout: 10_000,
    });

    if (!stdout.trim()) return null;

    return parseGitDiffStat(stdout);
  } catch {
    // Not a git repo or git not available
    return null;
  }
}

/**
 * Parse `git diff --stat` output into a GitDiffSummary
 */
export function parseGitDiffStat(output: string): GitDiffSummary | null {
  const lines = output.trim().split('\n');
  if (lines.length === 0) return null;

  const files: GitDiffSummary['files'] = [];
  let totalInsertions = 0;
  let totalDeletions = 0;

  // Last line is the summary: " 3 files changed, 45 insertions(+), 12 deletions(-)"
  const summaryLine = lines[lines.length - 1];
  const summaryMatch = summaryLine.match(
    /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/,
  );

  if (summaryMatch) {
    totalInsertions = parseInt(summaryMatch[2] || '0', 10);
    totalDeletions = parseInt(summaryMatch[3] || '0', 10);
  }

  // Parse individual file lines: " src/index.ts | 25 +++++----"
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    const fileMatch = line.match(/^\s*(.+?)\s+\|\s+(\d+)\s+(\+*)(-*)/);
    if (fileMatch) {
      files.push({
        path: fileMatch[1].trim(),
        insertions: fileMatch[3].length,
        deletions: fileMatch[4].length,
      });
    }
  }

  if (files.length === 0 && !summaryMatch) return null;

  return {
    filesChanged: summaryMatch ? parseInt(summaryMatch[1], 10) : files.length,
    insertions: totalInsertions,
    deletions: totalDeletions,
    files,
  };
}
