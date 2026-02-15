import type { GitDiffSummary } from '../types.js';

/**
 * Parse `git diff --numstat` output into a GitDiffSummary.
 * Each line: "insertions\tdeletions\tfilename"
 */
export function parseGitNumstat(output: string): GitDiffSummary | null {
  const lines = output.trim().split('\n').filter(Boolean);
  if (lines.length === 0) return null;

  const files: GitDiffSummary['files'] = [];
  let totalInsertions = 0;
  let totalDeletions = 0;

  for (const line of lines) {
    const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (match) {
      const ins = match[1] === '-' ? 0 : parseInt(match[1], 10);
      const del = match[2] === '-' ? 0 : parseInt(match[2], 10);
      files.push({ path: match[3], insertions: ins, deletions: del });
      totalInsertions += ins;
      totalDeletions += del;
    }
  }

  if (files.length === 0) return null;

  return {
    filesChanged: files.length,
    insertions: totalInsertions,
    deletions: totalDeletions,
    files,
  };
}

/**
 * Parse `git diff --stat` output into a GitDiffSummary.
 * Note: Per-file insertion/deletion counts are approximate (git truncates the bar chart).
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
