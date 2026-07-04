/**
 * Minimal HMAC-signed token (PRD F-10 / F-12) — the cookie format shared by
 * the per-store staff session (`wa_admin`) and the founder console session
 * (`wa_super`).
 *
 * Format: `base64url(JSON payload) + '.' + base64url(HMAC-SHA256(payloadB64))`
 *
 * Deliberately NOT a JWT: no header, no algorithm negotiation, one secret,
 * one verifier — nothing to downgrade. Payloads carry a `t` discriminator so
 * a staff token can never verify as a superadmin token (and vice versa).
 *
 * Secret: STORE_ADMIN_COOKIE_SECRET (any long random string). Fail-closed:
 * signing throws without it; verification returns null.
 */

import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

export function getCookieSecret(): string | null {
  const s = process.env.STORE_ADMIN_COOKIE_SECRET?.trim();
  return s && s.length >= 16 ? s : null;
}

/** Constant-time string equality (over SHA-256 digests, so unequal lengths are safe). */
export function safeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a, 'utf8').digest();
  const db = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(da, db);
}

function hmacB64url(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data, 'utf8').digest('base64url');
}

/** Sign a JSON-serializable payload. THROWS if the secret is not configured. */
export function signToken(payload: object, secret?: string): string {
  const key = secret ?? getCookieSecret() ?? null;
  if (!key) {
    throw new Error(
      'STORE_ADMIN_COOKIE_SECRET is not set (need ≥16 chars) — cannot sign session cookies.'
    );
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${hmacB64url(body, key)}`;
}

/**
 * Verify a token and return its payload, or null on ANY failure (bad format,
 * bad signature, unparsable JSON, missing secret). Fail closed.
 */
export function verifyToken<T = Record<string, unknown>>(
  token: string | undefined | null,
  secret?: string
): T | null {
  const key = secret ?? getCookieSecret() ?? null;
  if (!key || !token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!safeEqual(sig, hmacB64url(body, key))) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}
