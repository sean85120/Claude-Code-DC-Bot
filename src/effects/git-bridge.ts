import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { GitDiffSummary } from '../types.js';
import { parseGitNumstat } from '../modules/git-utils.js';

const execFileAsync = promisify(execFile);

/**
 * Get a summary of uncommitted git changes in the given directory.
 * Uses `git diff --numstat HEAD` for accurate per-file counts.
 * Returns null if not a git repo, cwd is invalid, or no changes.
 */
export async function getGitDiffSummary(cwd: string): Promise<GitDiffSummary | null> {
  const resolvedPath = resolve(cwd);

  // Validate path exists and is a directory
  try {
    if (!existsSync(resolvedPath) || !statSync(resolvedPath).isDirectory()) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const { stdout } = await execFileAsync('git', ['diff', '--numstat', 'HEAD'], {
      cwd: resolvedPath,
      timeout: 10_000,
    });

    if (!stdout.trim()) return null;

    return parseGitNumstat(stdout);
  } catch {
    // Not a git repo or git not available
    return null;
  }
}
