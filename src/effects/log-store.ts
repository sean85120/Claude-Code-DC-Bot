/** A single log entry stored in the circular buffer */
export interface LogEntry {
  timestamp: Date;
  level: string;
  module: string;
  message: string;
  data?: Record<string, unknown>;
}

/** Query options for filtering log entries */
export interface LogQuery {
  level?: string;
  module?: string;
  count?: number;
}

/**
 * In-memory circular buffer for recent log entries.
 * Evicts the oldest entry when the buffer is full.
 */
export class LogStore {
  private buffer: (LogEntry | undefined)[];
  private head = 0;
  private count = 0;
  private readonly capacity: number;

  constructor(capacity = 200) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  /** Push a new log entry, evicting the oldest if full */
  push(entry: LogEntry): void {
    this.buffer[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /** Get the number of stored entries */
  get size(): number {
    return this.count;
  }

  /** Get the N most recent entries (newest last) */
  getRecent(n: number): LogEntry[] {
    const limit = Math.min(n, this.count);
    const entries: LogEntry[] = [];
    // Start from oldest within the requested range
    const start = (this.head - limit + this.capacity) % this.capacity;
    for (let i = 0; i < limit; i++) {
      const idx = (start + i) % this.capacity;
      const entry = this.buffer[idx];
      if (entry) {
        entries.push(entry);
      }
    }
    return entries;
  }

  /** Query entries with optional filters */
  query(opts: LogQuery = {}): LogEntry[] {
    const { level, module, count = 20 } = opts;
    // Get all entries then filter
    const all = this.getRecent(this.count);
    let filtered = all;

    if (level) {
      filtered = filtered.filter((e) => e.level.toLowerCase() === level.toLowerCase());
    }
    if (module) {
      filtered = filtered.filter((e) => e.module.toLowerCase().includes(module.toLowerCase()));
    }

    // Return the last N matching entries
    return filtered.slice(-count);
  }
}
