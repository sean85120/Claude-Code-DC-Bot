/** Rate limit entry for a single user's request timestamps */
export interface RateLimitEntry {
  timestamps: number[];
}

/** Rate limit configuration parameters */
export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

/** Rate limit check result */
export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
  remaining: number;
}

/**
 * Check if a user has reached the rate limit
 * @param entry - User's request timestamp record (undefined means no record)
 * @param config - Rate limit configuration parameters
 * @param now - Current timestamp in milliseconds
 * @returns Rate limit check result (including whether allowed, remaining count, retry wait time)
 */
export function checkRateLimit(
  entry: RateLimitEntry | undefined,
  config: RateLimitConfig,
  now: number,
): RateLimitResult {
  if (!entry || entry.timestamps.length === 0) {
    return { allowed: true, remaining: config.maxRequests };
  }

  // Only keep records within the time window
  const validTimestamps = entry.timestamps.filter(
    (t) => now - t < config.windowMs,
  );

  const remaining = config.maxRequests - validTimestamps.length;

  if (remaining <= 0) {
    // Calculate when the earliest record expires
    const oldest = Math.min(...validTimestamps);
    const retryAfterMs = config.windowMs - (now - oldest);
    return { allowed: false, retryAfterMs, remaining: 0 };
  }

  return { allowed: true, remaining };
}

/**
 * Record a request and return the updated entry
 * @param entry - User's request timestamp record (undefined means no record)
 * @param now - Current timestamp in milliseconds
 * @param windowMs - Time window size in milliseconds
 * @returns Updated request timestamp record
 */
export function recordRequest(
  entry: RateLimitEntry | undefined,
  now: number,
  windowMs: number,
): RateLimitEntry {
  const timestamps = entry
    ? entry.timestamps.filter((t) => now - t < windowMs)
    : [];
  timestamps.push(now);
  return { timestamps };
}
