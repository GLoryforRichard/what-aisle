/**
 * Bearer auth for /api/internal/* (PRD F-13).
 *
 * The portal calls these endpoints over the loopback (127.0.0.1) with
 * `Authorization: Bearer $INTERNAL_API_SECRET`; Caddy 403s the path on every
 * public vhost, and proxy.ts passes it through without tenant resolution —
 * these routes have NO x-store-slug dependency.
 *
 * Comparison is timing-safe (SHA-256 digests → timingSafeEqual, so length
 * differences leak nothing). Fail closed when the secret is unconfigured.
 */

import { NextRequest, NextResponse } from 'next/server';
import { safeEqual } from './signed-token';

/** Returns null when authorized; otherwise the error response to send. */
export function requireInternalAuth(req: NextRequest): NextResponse | null {
  const secret = process.env.INTERNAL_API_SECRET?.trim();
  if (!secret) {
    console.error('[internal-api] INTERNAL_API_SECRET is not set — rejecting all calls');
    return NextResponse.json(
      { ok: false, error: 'internal API is not configured' },
      { status: 503 }
    );
  }

  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token || !safeEqual(token, secret)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
