/**
 * Per-store staff session cookie (`wa_admin`, PRD F-10) + passcode helpers.
 *
 * Design:
 *  - payload {t:'admin', slug, pcv, exp} signed with STORE_ADMIN_COOKIE_SECRET
 *    (HMAC-SHA256, see lib/signed-token.ts);
 *  - `pcv` = passcodeUpdatedAt epoch millis — a passcode reset bumps the
 *    stored timestamp, so every cookie signed before the reset stops
 *    verifying (no server-side session store needed);
 *  - the cookie is host-only (no Domain attribute) → it never travels to a
 *    sibling `<other-store>.whataisle.com`, giving cross-store isolation
 *    for free; `slug` is still checked on every request as defense in depth.
 */

import { hashSync, compareSync } from 'bcryptjs';
import { randomInt } from 'node:crypto';
import type { Store } from './types';
import { signToken, verifyToken } from './signed-token';

export const ADMIN_COOKIE_NAME = 'wa_admin';
export const ADMIN_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AdminSessionPayload {
  t: 'admin';
  /** Store the session was issued for. */
  slug: string;
  /** Passcode version = passcodeUpdatedAt epoch ms at issue time. */
  pcv: number;
  /** Absolute expiry, epoch ms. */
  exp: number;
}

/** Current passcode version of a store (cookie invalidation key). */
export function passcodeVersion(store: Store): number {
  return new Date(store.admin.passcodeUpdatedAt).getTime();
}

/** Sign a fresh 30-day staff session for this store. Throws without the secret. */
export function signAdminSession(store: Store): string {
  const payload: AdminSessionPayload = {
    t: 'admin',
    slug: store.slug,
    pcv: passcodeVersion(store),
    exp: Date.now() + ADMIN_SESSION_TTL_MS,
  };
  return signToken(payload);
}

/**
 * Verify a `wa_admin` cookie value against THIS store: signature, type,
 * slug match, passcode version match, not expired. Null on any failure.
 */
export function verifyAdminSession(
  cookieValue: string | undefined | null,
  store: Store
): AdminSessionPayload | null {
  const p = verifyToken<AdminSessionPayload>(cookieValue);
  if (!p || p.t !== 'admin') return null;
  if (typeof p.slug !== 'string' || p.slug !== store.slug) return null;
  if (typeof p.pcv !== 'number' || p.pcv !== passcodeVersion(store)) return null;
  if (typeof p.exp !== 'number' || p.exp <= Date.now()) return null;
  return p;
}

/** Cookie attributes shared by set + clear (Route Handler `cookies().set`). */
export function adminCookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSec,
  };
}

// ─────────────────────────────────────────────────────────────
// Passcodes (6 digits, bcrypt at rest)
// ─────────────────────────────────────────────────────────────

export const PASSCODE_LENGTH = 6;
const BCRYPT_ROUNDS = 10;

/** Crypto-random 6-digit passcode ('000000'–'999999', leading zeros kept). */
export function generatePasscode(): string {
  return String(randomInt(0, 10 ** PASSCODE_LENGTH)).padStart(PASSCODE_LENGTH, '0');
}

export function hashPasscode(passcode: string): string {
  return hashSync(passcode, BCRYPT_ROUNDS);
}

/** Constant-ish time thanks to bcrypt; false for empty/malformed hashes. */
export function checkPasscode(passcode: string, passcodeHash: string): boolean {
  if (!passcode || !passcodeHash) return false;
  try {
    return compareSync(passcode, passcodeHash);
  } catch {
    return false;
  }
}
