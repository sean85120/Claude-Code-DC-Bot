import { query, type AccountInfo, type ModelInfo } from '@anthropic-ai/claude-agent-sdk';

/** Result of the Claude Code connection check at startup */
export interface StartupCheckResult {
  success: boolean;
  accountInfo?: AccountInfo;
  models?: ModelInfo[];
  error?: string;
}

/**
 * Check Claude Code connection status at startup by creating a minimal query to retrieve account info, then immediately closing it
 * @param cwd - Working directory, used for SDK initialization
 * @returns Connection check result, including account info and available models
 */
export async function checkClaudeStatus(cwd: string): Promise<StartupCheckResult> {
  const abortController = new AbortController();
  const q = query({
    prompt: 'hi',
    options: {
      cwd,
      permissionMode: 'plan',
      abortController,
      maxTurns: 1,
    },
  });

  try {
    // Start iterating to trigger init
    const iter = q[Symbol.asyncIterator]();
    const first = await Promise.race([
      iter.next(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
    ]);

    if (first === null) {
      throw new Error('Connection timed out (10 seconds)');
    }

    const accountInfo = await q.accountInfo();
    const initResult = await q.initializationResult();

    abortController.abort();
    q.close();

    return {
      success: true,
      accountInfo,
      models: initResult.models,
    };
  } catch (error) {
    abortController.abort();
    try { q.close(); } catch { /* ignore */ }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
