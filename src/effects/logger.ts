import pino from 'pino';
import { Writable } from 'node:stream';
import { LogStore } from './log-store.js';

/** Global log store for in-memory log access from Discord */
export const logStore = new LogStore(200);

// Custom writable stream that parses pino JSON and pushes to LogStore
const logStoreStream = new Writable({
  write(chunk: Buffer, _encoding: string, callback: () => void) {
    try {
      const line = chunk.toString().trim();
      if (line) {
        const parsed = JSON.parse(line);
        const level = pino.levels.labels[parsed.level] ?? String(parsed.level);
        logStore.push({
          timestamp: new Date(parsed.time ?? Date.now()),
          level,
          module: parsed.module ?? '',
          message: parsed.msg ?? '',
          data: parsed.err ? { err: parsed.err } : undefined,
        });
      }
    } catch {
      // Ignore unparseable lines
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
  { level: 'trace' },
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
