/**
 * Per-store staff authorization for API routes (PRD F-10).
 *
 * Replaces the old ADMIN_WRITES env-var demo lock: every staff surface now
 * requires a valid `wa_admin` session cookie issued by
 * POST /api/admin/session after the store's 6-digit passcode checked out.
 *
 * Usage (ALWAYS after the requireStore staff-audience gate, which resolves
 * the tenant and its status):
 *
 *   const gate = await requireStore(req, { audience: 'staff' });
 *   if (!gate.ok) return gate.response;
 *   const admin = requireStoreAdmin(req, gate.store);
 *   if (!admin.ok) return admin.response;
 */

import { NextRequest, NextResponse } from 'next/server';
import type { Store } from './types';
import { ADMIN_COOKIE_NAME, verifyAdminSession } from './admin-session';

export type StoreAdminResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

export function requireStoreAdmin(req: NextRequest, store: Store): StoreAdminResult {
  const cookie = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  const session = verifyAdminSession(cookie, store);
  if (!session) {
    return {
      ok: false,
      // Generic message on purpose — don't reveal whether the cookie was
      // absent, expired, for another store, or invalidated by a reset.
      response: NextResponse.json(
        { ok: false, error: 'staff authentication required' },
        { status: 401 }
      ),
    };
  }
  return { ok: true };
}
