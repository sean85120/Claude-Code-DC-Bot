/**
 * Unified diff generation for Edit tool approval previews.
 *
 * Implements a simple Myers-like line diff using LCS (longest common subsequence)
 * to produce unified diff output. No external dependencies.
 */

/** A single diff operation */
interface DiffOp {
  type: 'keep' | 'add' | 'remove';
  line: string;
  oldLineNo?: number;
  newLineNo?: number;
}

/** A hunk in the unified diff */
interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

/**
 * Compute the longest common subsequence table for two arrays of lines
 * @param oldLines - Original lines
 * @param newLines - New lines
 * @returns 2D LCS length table
 */
function buildLcsTable(oldLines: string[], newLines: string[]): number[][] {
  const m = oldLines.length;
  const n = newLines.length;
  const table: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        table[i][j] = table[i - 1][j - 1] + 1;
      } else {
        table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
  }

  return table;
}

/**
 * Backtrack through the LCS table to produce a sequence of diff operations
 * @param oldLines - Original lines
 * @param newLines - New lines
 * @param table - LCS table
 * @returns Array of diff operations
 */
function backtrackDiff(oldLines: string[], newLines: string[], table: number[][]): DiffOp[] {
  const ops: DiffOp[] = [];
  let i = oldLines.length;
  let j = newLines.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: 'keep', line: oldLines[i - 1], oldLineNo: i, newLineNo: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      ops.push({ type: 'add', line: newLines[j - 1], newLineNo: j });
      j--;
    } else {
      ops.push({ type: 'remove', line: oldLines[i - 1], oldLineNo: i });
      i--;
    }
  }

  return ops.reverse();
}

/**
 * Group diff operations into hunks with context lines
 * @param ops - Diff operations
 * @param contextLines - Number of context lines around changes
 * @returns Array of hunks
 */
function groupIntoHunks(ops: DiffOp[], contextLines: number): Hunk[] {
  // Find indices of changed operations
  const changeIndices: number[] = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type !== 'keep') {
      changeIndices.push(i);
    }
  }

  if (changeIndices.length === 0) return [];

  // Group changes that are close together (within 2 * contextLines)
  const groups: Array<{ start: number; end: number }> = [];
  let groupStart = changeIndices[0];
  let groupEnd = changeIndices[0];

  for (let i = 1; i < changeIndices.length; i++) {
    if (changeIndices[i] - groupEnd <= contextLines * 2) {
      groupEnd = changeIndices[i];
    } else {
      groups.push({ start: groupStart, end: groupEnd });
      groupStart = changeIndices[i];
      groupEnd = changeIndices[i];
    }
  }
  groups.push({ start: groupStart, end: groupEnd });

  // Build hunks from groups
  const hunks: Hunk[] = [];
  for (const group of groups) {
    const hunkStart = Math.max(0, group.start - contextLines);
    const hunkEnd = Math.min(ops.length - 1, group.end + contextLines);

    const lines: string[] = [];
    let oldStart = 0;
    let oldCount = 0;
    let newStart = 0;
    let newCount = 0;
    let oldStartSet = false;
    let newStartSet = false;

    for (let i = hunkStart; i <= hunkEnd; i++) {
      const op = ops[i];
      switch (op.type) {
        case 'keep':
          lines.push(` ${op.line}`);
          if (!oldStartSet && op.oldLineNo !== undefined) {
            oldStart = op.oldLineNo;
            oldStartSet = true;
          }
          if (!newStartSet && op.newLineNo !== undefined) {
            newStart = op.newLineNo;
            newStartSet = true;
          }
          oldCount++;
          newCount++;
          break;
        case 'remove':
          lines.push(`-${op.line}`);
          if (!oldStartSet && op.oldLineNo !== undefined) {
            oldStart = op.oldLineNo;
            oldStartSet = true;
          }
          if (!newStartSet) {
            // Next add or keep will set newStart
            newStart = (op.oldLineNo ?? 1);
            newStartSet = true;
          }
          oldCount++;
          break;
        case 'add':
          lines.push(`+${op.line}`);
          if (!newStartSet && op.newLineNo !== undefined) {
            newStart = op.newLineNo;
            newStartSet = true;
          }
          if (!oldStartSet) {
            oldStart = (op.newLineNo ?? 1);
            oldStartSet = true;
          }
          newCount++;
          break;
      }
    }

    hunks.push({ oldStart, oldCount, newStart, newCount, lines });
  }

  return hunks;
}

/**
 * Generate a unified diff between two strings
 * @param oldStr - Original text
 * @param newStr - New text
 * @param fileName - File name for diff header
 * @param contextLines - Number of context lines around changes (default: 3)
 * @returns Formatted unified diff string
 */
export function generateUnifiedDiff(
  oldStr: string,
  newStr: string,
  fileName: string,
  contextLines = 3,
): string {
  // Handle identical strings
  if (oldStr === newStr) return '';

  // Handle empty inputs
  if (!oldStr && !newStr) return '';

  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');

  // Guard against excessive memory usage for large files (O(m*n) LCS table).
  // This is only for Discord embed preview, so a summary is fine for large diffs.
  const MAX_DIFF_LINES = 500;
  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) {
    const delta = newLines.length - oldLines.length;
    const sign = delta >= 0 ? '+' : '';
    return `--- a/${fileName}\n+++ b/${fileName}\n(diff too large: ${oldLines.length} → ${newLines.length} lines, ${sign}${delta})`;
  }

  // For pure addition (empty old)
  if (!oldStr) {
    const addedLines = newLines.map((l) => `+${l}`).join('\n');
    return `--- a/${fileName}\n+++ b/${fileName}\n@@ -0,0 +1,${newLines.length} @@\n${addedLines}`;
  }

  // For pure deletion (empty new)
  if (!newStr) {
    const removedLines = oldLines.map((l) => `-${l}`).join('\n');
    return `--- a/${fileName}\n+++ b/${fileName}\n@@ -1,${oldLines.length} +0,0 @@\n${removedLines}`;
  }

  const table = buildLcsTable(oldLines, newLines);
  const ops = backtrackDiff(oldLines, newLines, table);
  const hunks = groupIntoHunks(ops, contextLines);

  if (hunks.length === 0) return '';

  const header = `--- a/${fileName}\n+++ b/${fileName}`;
  const hunkStrings = hunks.map((h) => {
    const hunkHeader = `@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@`;
    return `${hunkHeader}\n${h.lines.join('\n')}`;
  });

  return `${header}\n${hunkStrings.join('\n')}`;
}

/**
 * Truncate a diff to fit within Discord embed limits while keeping it meaningful.
 * Truncates at line boundaries and adds an indicator when truncated.
 *
 * @param diff - Full diff string
 * @param maxLength - Max character length (default: 900, to fit in 1024-char embed field with formatting)
 * @returns Truncated diff
 */
export function truncateDiff(diff: string, maxLength = 900): string {
  if (diff.length <= maxLength) return diff;

  // Try to truncate at a line boundary
  const lines = diff.split('\n');
  let result = '';

  for (const line of lines) {
    const candidate = result ? `${result}\n${line}` : line;
    if (candidate.length > maxLength - 20) {
      // Leave room for truncation indicator
      break;
    }
    result = candidate;
  }

  if (!result) {
    // Single line is too long; hard truncate
    return diff.slice(0, maxLength - 3) + '...';
  }

  return result + '\n... (truncated)';
}

/**
 * Generate a compact change summary string
 * @param oldStr - Original text
 * @param newStr - New text
 * @returns Human-readable summary like "5 → 8 lines (+3)"
 */
export function diffSummary(oldStr: string, newStr: string): string {
  const oldLines = oldStr ? oldStr.split('\n').length : 0;
  const newLines = newStr ? newStr.split('\n').length : 0;
  const delta = newLines - oldLines;
  const sign = delta >= 0 ? '+' : '';
  return `${oldLines} → ${newLines} lines (${sign}${delta})`;
}
