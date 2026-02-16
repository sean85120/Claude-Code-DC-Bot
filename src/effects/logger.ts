import pino from 'pino';
import { Writable } from 'node:stream';
import { LogStore } from './log-store.js';

/** Global log store for in-memory log access from Discord */
export const logStore = new LogStore(200);

// Leftover partial line from previous write chunk
let partialLine = '';

// Custom writable stream that parses pino JSON and pushes to LogStore.
// Pino may deliver multiple JSON log lines in a single chunk, so we split by newline.
const logStoreStream = new Writable({
  write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void) {
    try {
      const text = partialLine + chunk.toString();
      const lines = text.split('\n');
      // Last element may be incomplete — save it for next chunk
      partialLine = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          const level = pino.levels.labels[parsed.level] ?? String(parsed.level);
          logStore.push({
            timestamp: new Date(parsed.time ?? Date.now()),
            level,
            module: parsed.module ?? '',
            message: parsed.msg ?? '',
            data: parsed.err ? { err: parsed.err } : undefined,
          });
        } catch {
          // Ignore individual unparseable lines
        }
      }
    } catch (err) {
      callback(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    callback();
  },
});

// Pretty stream for console output
const prettyStream = pino.transport({
  target: 'pino-pretty',
  options: {
    colorize: true,
    translateTime: 'HH:MM:ss',
    ignore: 'pid,hostname',
  },
});

/** Global pino logger instance */
export const logger = pino(
  { level: 'info' },
  pino.multistream([
    { stream: prettyStream, level: 'info' as const },
    { stream: logStoreStream, level: 'info' as const },
  ]),
);

/**
 * Output multi-line text to stdout as-is (for startup banner, without timestamps or levels)
 * @param lines - The lines of text to output
 */
export function printBanner(lines: string[]): void {
  for (const line of lines) {
    process.stdout.write(line + '\n');
  }
}
