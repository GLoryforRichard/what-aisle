/**
 * In-memory fixed-window rate limiter (PRD F-10: passcode attempts 5/min per
 * IP+slug). Single-VM deployment → one Node process → a Map is enough; this
 * intentionally does NOT survive restarts or scale horizontally.
 */

import type { NextRequest } from 'next/server';

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Drop expired windows so the map can't grow unbounded under a scan. */
function prune(now: number): void {
  if (windows.size < 10_000) return;
  for (const [k, w] of windows) {
    if (w.resetAt <= now) windows.delete(k);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets (for a Retry-After header). */
  retryAfterSec: number;
}

/** Count one attempt against `key`. Fixed window of `windowMs`, max `limit`. */
export function rateLimit(key: string, limit = 5, windowMs = 60_000): RateLimitResult {
  const now = Date.now();
  prune(now);
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  w.count += 1;
  if (w.count > limit) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/** Best-effort client IP: Caddy sets X-Forwarded-For; first hop is the client. */
export function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}
