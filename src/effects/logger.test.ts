import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, printBanner } from './logger.js';

describe('logger', () => {
  it('should have basic pino logger methods', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.child).toBe('function');
  });
});

describe('printBanner', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('calls stdout.write for each line', () => {
    printBanner(['line1', 'line2', 'line3']);
    expect(writeSpy).toHaveBeenCalledTimes(3);
  });

  it('appends newline to each line', () => {
    printBanner(['line1', 'line2', 'line3']);
    expect(writeSpy).toHaveBeenNthCalledWith(1, 'line1\n');
    expect(writeSpy).toHaveBeenNthCalledWith(2, 'line2\n');
    expect(writeSpy).toHaveBeenNthCalledWith(3, 'line3\n');
  });

  it('empty array does not call write', () => {
    printBanner([]);
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
