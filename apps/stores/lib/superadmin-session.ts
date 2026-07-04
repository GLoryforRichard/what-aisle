/**
 * Founder-console session (`wa_super`, PRD F-12).
 *
 * Entry: a token form POSTs to /api/superadmin/session, which compares the
 * token against SUPERADMIN_TOKEN (timing-safe) and sets a 7-day HMAC-signed
 * HttpOnly cookie. The cookie payload {t:'super'} is disjoint from the staff
 * cookie's {t:'admin', slug, pcv} — neither can ever verify as the other.
 *
 * Superadmin pages run on superadmin.whataisle.com with NO tenant context,
 * so /api/superadmin/* routes are guarded by THIS cookie, never `wa_admin`.
 * (Production adds Caddy basic_auth in front as the second layer.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { signToken, verifyToken } from './signed-token';

export const SUPER_COOKIE_NAME = 'wa_super';
export const SUPER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface SuperSessionPayload {
  t: 'super';
  exp: number;
}

export function signSuperSession(): string {
  const payload: SuperSessionPayload = { t: 'super', exp: Date.now() + SUPER_SESSION_TTL_MS };
  return signToken(payload);
}

export function verifySuperSession(cookieValue: string | undefined | null): boolean {
  const p = verifyToken<SuperSessionPayload>(cookieValue);
  return !!p && p.t === 'super' && typeof p.exp === 'number' && p.exp > Date.now();
}

export function superCookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSec,
  };
}

/**
 * Page-level check (Server Components). IMPORTANT: call this at the top of
 * EVERY /superadmin page — App Router renders pages and layouts in parallel,
 * so a layout-only check would not stop a page from fetching data.
 */
export async function hasSuperSession(): Promise<boolean> {
  const jar = await cookies();
  return verifySuperSession(jar.get(SUPER_COOKIE_NAME)?.value);
}

export type SuperadminResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

/** API-route guard for /api/superadmin/*. */
export function requireSuperadmin(req: NextRequest): SuperadminResult {
  if (!verifySuperSession(req.cookies.get(SUPER_COOKIE_NAME)?.value)) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'superadmin authentication required' },
        { status: 401 }
      ),
    };
  }
  return { ok: true };
}
