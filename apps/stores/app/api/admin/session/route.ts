/**
 * Staff session endpoint (PRD F-10).
 *
 *   POST   {passcode} → verify against store.admin.passcodeHash (bcrypt),
 *          set the 30-day HttpOnly `wa_admin` cookie. 401 generic on wrong
 *          passcode, 429 after 5 attempts/min per IP+slug.
 *   GET    → 200 when the current cookie is valid for this store (cheap
 *          "am I still logged in?" probe for PasscodeGate), else 401.
 *   DELETE → logout (clears the cookie).
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireStore } from '@/lib/store-context';
import { requireStoreAdmin } from '@/lib/admin-guard';
import {
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_TTL_MS,
  adminCookieOptions,
  checkPasscode,
  signAdminSession,
} from '@/lib/admin-session';
import { rateLimit, clientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const gate = await requireStore(req, { audience: 'staff' });
  if (!gate.ok) return gate.response;
  const store = gate.store;

  // 5 passcode attempts per minute per IP+slug (PRD F-10 验收).
  const limit = rateLimit(`admin-session:${clientIp(req)}:${store.slug}`, 5, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: 'too many attempts — try again in a minute' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    );
  }

  let passcode = '';
  try {
    const body = (await req.json()) as { passcode?: unknown };
    if (typeof body.passcode === 'string') passcode = body.passcode.trim();
  } catch {
    /* fall through to the generic 401 — same response as a wrong passcode */
  }

  if (!checkPasscode(passcode, store.admin.passcodeHash)) {
    // Generic on purpose: don't reveal whether the store has no passcode set,
    // the format was wrong, or the digits didn't match.
    return NextResponse.json({ ok: false, error: 'invalid passcode' }, { status: 401 });
  }

  let token: string;
  try {
    token = signAdminSession(store);
  } catch (err) {
    console.error('[admin-session] cannot sign cookie:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { ok: false, error: 'server session signing is not configured' },
      { status: 500 }
    );
  }

  const jar = await cookies();
  jar.set(ADMIN_COOKIE_NAME, token, adminCookieOptions(ADMIN_SESSION_TTL_MS / 1000));
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const gate = await requireStore(req, { audience: 'staff' });
  if (!gate.ok) return gate.response;
  const admin = requireStoreAdmin(req, gate.store);
  if (!admin.ok) return admin.response;
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest) {
  const jar = await cookies();
  jar.set(ADMIN_COOKIE_NAME, '', adminCookieOptions(0));
  return NextResponse.json({ ok: true });
}
