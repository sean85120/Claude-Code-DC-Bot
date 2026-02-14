import pino from 'pino';

/** Global pino logger instance */
export const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
    },
  },
});

/**
 * Output multi-line text to stdout as-is (for startup banner, without timestamps or levels)
 * @param lines - The lines of text to output
 */
export function printBanner(lines: string[]): void {
  for (const line of lines) {
    process.stdout.write(line + '\n');
  }
}
