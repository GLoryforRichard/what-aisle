/**
 * Founder-console login (PRD F-12).
 *
 *   POST   {token} → timing-safe compare against SUPERADMIN_TOKEN, set the
 *          7-day HttpOnly `wa_super` cookie. 401 on mismatch, 429 after
 *          5 attempts/min per IP.
 *   DELETE → logout.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { safeEqual } from '@/lib/signed-token';
import {
  SUPER_COOKIE_NAME,
  SUPER_SESSION_TTL_MS,
  signSuperSession,
  superCookieOptions,
} from '@/lib/superadmin-session';
import { rateLimit, clientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const limit = rateLimit(`super-session:${clientIp(req)}`, 5, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: 'too many attempts — try again in a minute' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    );
  }

  const expected = process.env.SUPERADMIN_TOKEN?.trim();
  if (!expected) {
    console.error('[superadmin] SUPERADMIN_TOKEN is not set — console is locked');
    return NextResponse.json(
      { ok: false, error: 'superadmin console is not configured' },
      { status: 503 }
    );
  }

  let token = '';
  try {
    const body = (await req.json()) as { token?: unknown };
    if (typeof body.token === 'string') token = body.token.trim();
  } catch {
    /* same generic 401 as a wrong token */
  }

  if (!token || !safeEqual(token, expected)) {
    return NextResponse.json({ ok: false, error: 'invalid token' }, { status: 401 });
  }

  let cookieValue: string;
  try {
    cookieValue = signSuperSession();
  } catch (err) {
    console.error('[superadmin] cannot sign cookie:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { ok: false, error: 'server session signing is not configured' },
      { status: 500 }
    );
  }

  const jar = await cookies();
  jar.set(SUPER_COOKIE_NAME, cookieValue, superCookieOptions(SUPER_SESSION_TTL_MS / 1000));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest) {
  const jar = await cookies();
  jar.set(SUPER_COOKIE_NAME, '', superCookieOptions(0));
  return NextResponse.json({ ok: true });
}
