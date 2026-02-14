import path from 'node:path';

/**
 * Truncate text, adding ellipsis if it exceeds the maximum length
 * @param str - Original string
 * @param maxLen - Maximum length
 * @returns Truncated string
 */
export function truncate(str: string, maxLen: number): string {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

/**
 * Get file name
 * @param filePath - Full file path
 * @returns File name (without path)
 */
export function getFileName(filePath: string): string {
  return filePath ? path.basename(filePath) : 'Unknown';
}

/**
 * Get relative path
 * @param filePath - Full file path
 * @param cwd - Working directory
 * @returns Path relative to working directory
 */
export function getRelativePath(filePath: string, cwd: string): string {
  if (!filePath) return 'Unknown';
  if (cwd && filePath.startsWith(cwd)) {
    return filePath.slice(cwd.length + 1) || getFileName(filePath);
  }
  return filePath;
}

/**
 * Format number with thousands separator
 * @param num - Number to format
 * @returns Number string with thousands separator
 */
export function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

/**
 * Split long text into multiple chunks, each not exceeding the specified length
 * @param text - Original text
 * @param maxLen - Maximum length per chunk
 * @returns Array of text chunks
 */
export function chunkMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let current = '';

  for (const line of text.split('\n')) {
    if (current.length + line.length + 1 > maxLen) {
      if (current) chunks.push(current);
      current = line.length > maxLen ? line.slice(0, maxLen) : line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

/**
 * Wrap content in a code block
 * @param code - Code content
 * @param language - Language identifier
 * @param maxLen - Maximum length (including code block syntax)
 * @returns Markdown code block string
 */
export function formatCodeBlock(code: string, language = '', maxLen = 1900): string {
  const prefix = `\`\`\`${language}\n`;
  const suffix = '\n```';
  const available = maxLen - prefix.length - suffix.length;
  const truncated = truncate(code, available);
  return `${prefix}${truncated}${suffix}`;
}

/**
 * Format diff display
 * @param oldStr - Old content
 * @param newStr - New content
 * @param maxLen - Maximum length per section
 * @returns Markdown diff format string
 */
export function formatDiff(oldStr: string, newStr: string, maxLen = 400): string {
  const oldLines = '- ' + truncate(oldStr.replace(/\n/g, '\n- '), maxLen);
  const newLines = '+ ' + truncate(newStr.replace(/\n/g, '\n+ '), maxLen);
  return `\`\`\`diff\n${oldLines}\n\`\`\`\n\`\`\`diff\n${newLines}\n\`\`\``;
}

/**
 * Format duration (milliseconds to human-readable format)
 * @param ms - Milliseconds
 * @returns Human-readable duration string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Format cost
 * @param usd - USD amount
 * @returns Formatted cost string
 */
export function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}
