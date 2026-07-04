/**
 * Founder-console store mutations (PRD F-12), guarded by the `wa_super`
 * cookie — NOT the tenant staff cookie (superadmin pages run on the
 * superadmin subdomain with no tenant context).
 *
 * PATCH body — any combination of:
 *   status:        'live' | 'suspended'  (manual transitions only:
 *                  building→live [Go Live], live→suspended [Suspend],
 *                  suspended→live [Reactivate]); the change is synced
 *                  fire-and-forget to the portal's Postgres ledger via
 *                  POST $PORTAL_INTERNAL_URL/api/internal/store-status.
 *   shelves:       full taxonomy array (schema-validated, F-12 editor)
 *   floorplan:     full floorplan object (schema-validated; unknown rect
 *                  codes are a warning, not an error)
 *   passcodeReset: true → new 6-digit code, bcrypt-stored, returned ONCE
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireSuperadmin } from '@/lib/superadmin-session';
import { validateSlug } from '@/lib/slug';
import { generatePasscode, hashPasscode } from '@/lib/admin-session';
import { bustStoreCache } from '@/lib/store-context';
import { validateShelves, validateFloorplan } from '@/lib/store-config-validate';
import { Store, StoreStatus, STORES_COLLECTION } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

/** Manual transitions the console may drive: from → allowed targets. */
const MANUAL_TRANSITIONS: Partial<Record<StoreStatus, readonly StoreStatus[]>> = {
  building: ['live'],       // Go Live
  live: ['suspended'],      // Suspend
  suspended: ['live'],      // Reactivate
};

/**
 * Fire-and-forget reverse sync: the portal's Postgres is the source of truth
 * for billing/status, so console-driven transitions must land there too.
 * Non-2xx / network failure is alert-logged, never blocks the console
 * (PRD F-13: the portal whitelists building→live and live⇄suspended).
 */
function syncStatusToPortal(slug: string, status: StoreStatus, liveAt?: string): void {
  const base = process.env.PORTAL_INTERNAL_URL?.trim() || 'http://127.0.0.1:3002';
  const secret = process.env.INTERNAL_API_SECRET?.trim();
  if (!secret) {
    console.error('[superadmin] ALERT: INTERNAL_API_SECRET unset — portal NOT notified of', slug, '→', status);
    return;
  }
  fetch(`${base}/api/internal/store-status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ slug, status, ...(liveAt ? { liveAt } : {}) }),
  })
    .then(async res => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error(
          `[superadmin] ALERT: portal status sync failed for '${slug}' → '${status}': ` +
          `HTTP ${res.status} ${text.slice(0, 300)}`
        );
      }
    })
    .catch(err => {
      console.error(
        `[superadmin] ALERT: portal status sync unreachable for '${slug}' → '${status}':`,
        err instanceof Error ? err.message : err
      );
    });
}

interface PatchBody {
  status?: unknown;
  shelves?: unknown;
  floorplan?: unknown;
  passcodeReset?: unknown;
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = requireSuperadmin(req);
  if (!auth.ok) return auth.response;

  const { slug: rawSlug } = await ctx.params;
  const slugCheck = validateSlug(rawSlug ?? '');
  if (!slugCheck.ok) {
    return NextResponse.json({ ok: false, error: 'invalid slug' }, { status: 400 });
  }
  const slug = slugCheck.slug;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const db = await getDb();
  const col = db.collection<Store>(STORES_COLLECTION);
  const store = await col.findOne({ slug });
  if (!store) {
    return NextResponse.json({ ok: false, error: 'store not found' }, { status: 404 });
  }

  const set: Record<string, unknown> = {};
  const warnings: string[] = [];
  let newPasscode: string | undefined;
  let statusChange: { to: StoreStatus; liveAt?: string } | undefined;

  // ── status transition ──
  if (body.status !== undefined) {
    const target = body.status as StoreStatus;
    const allowed = MANUAL_TRANSITIONS[store.status] ?? [];
    if (typeof target !== 'string' || !allowed.includes(target)) {
      return NextResponse.json(
        {
          ok: false,
          error: `cannot transition '${store.status}' → '${String(body.status)}' from the console`,
        },
        { status: 409 }
      );
    }
    set.status = target;
    statusChange = {
      to: target,
      // liveAt marks the FIRST go-live (building→live) for the portal ledger.
      ...(store.status === 'building' && target === 'live'
        ? { liveAt: new Date().toISOString() }
        : {}),
    };
  }

  // ── shelves taxonomy ──
  if (body.shelves !== undefined) {
    const v = validateShelves(body.shelves);
    if (!v.ok) {
      return NextResponse.json({ ok: false, error: 'invalid shelves', errors: v.errors }, { status: 400 });
    }
    set.shelves = v.value;
    warnings.push(...v.warnings);
  }

  // ── floorplan ──
  if (body.floorplan !== undefined) {
    const shelfCodes = (body.shelves !== undefined && Array.isArray(set.shelves)
      ? (set.shelves as { code: string }[])
      : store.shelves
    ).map(s => s.code);
    const v = validateFloorplan(body.floorplan, shelfCodes);
    if (!v.ok) {
      return NextResponse.json({ ok: false, error: 'invalid floorplan', errors: v.errors }, { status: 400 });
    }
    set.floorplan = v.value;
    warnings.push(...v.warnings);
  }

  // ── passcode reset ──
  if (body.passcodeReset === true) {
    newPasscode = generatePasscode();
    set['admin.passcodeHash'] = hashPasscode(newPasscode);
    set['admin.passcodeUpdatedAt'] = new Date();
  }

  if (Object.keys(set).length === 0) {
    return NextResponse.json({ ok: false, error: 'nothing to update' }, { status: 400 });
  }

  set.updated_at = new Date();
  await col.updateOne({ slug }, { $set: set });
  bustStoreCache(slug);

  if (statusChange) syncStatusToPortal(slug, statusChange.to, statusChange.liveAt);

  return NextResponse.json({
    ok: true,
    slug,
    status: (set.status as StoreStatus) ?? store.status,
    ...(warnings.length > 0 ? { warnings } : {}),
    // Plaintext passcode is shown exactly once, in this response.
    ...(newPasscode ? { passcode: newPasscode } : {}),
  });
}
