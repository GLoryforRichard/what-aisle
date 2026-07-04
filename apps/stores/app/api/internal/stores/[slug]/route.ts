/**
 * /api/internal/stores/:slug (PRD F-13) — portal → stores app pushes.
 *
 *   GET   → {exists, status}  (slug-availability backstop for the portal's
 *           name checker; the portal's Postgres holds the primary claim).
 *   PATCH → {status?, passcodeReset?, branding?}
 *           - status: only transitions the portal legitimately drives
 *             (awaiting_video re-open, building, suspended, live, canceled);
 *             'canceled' is terminal — leaving it is a 409.
 *           - passcodeReset: new random 6-digit code, bcrypt-stored,
 *             passcodeUpdatedAt bumped (kills existing wa_admin cookies),
 *             plaintext returned ONCE.
 *           - branding: shallow merge of displayName/logoUrl/themeColor/
 *             defaultLocale.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireInternalAuth } from '@/lib/internal-auth';
import { validateSlug } from '@/lib/slug';
import { generatePasscode, hashPasscode } from '@/lib/admin-session';
import { bustStoreCache } from '@/lib/store-context';
import { Store, StoreStatus, STORES_COLLECTION } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

/** Statuses the PORTAL may push (superadmin console drives the rest). */
const PORTAL_PUSHABLE: ReadonlySet<StoreStatus> = new Set([
  'awaiting_video', // re-open (e.g. video rejected, owner re-records)
  'building',       // video uploaded
  'suspended',      // dunning expired / subscription canceled
  'live',           // invoice.paid recovery
  'canceled',       // refund / account closure (terminal)
]);

async function parseSlug(ctx: Ctx): Promise<string | null> {
  const { slug } = await ctx.params;
  const v = validateSlug(slug ?? '');
  return v.ok ? v.slug : null;
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const denied = requireInternalAuth(req);
  if (denied) return denied;

  const slug = await parseSlug(ctx);
  if (!slug) {
    // Reserved or malformed → can never be provisioned; report as taken so
    // the portal's availability check fails safe.
    return NextResponse.json({ ok: true, exists: true, status: null, reserved: true });
  }

  const db = await getDb();
  const store = await db
    .collection<Store>(STORES_COLLECTION)
    .findOne({ slug }, { projection: { status: 1 } });

  return NextResponse.json({
    ok: true,
    exists: !!store,
    status: store?.status ?? null,
  });
}

interface PatchBody {
  status?: unknown;
  passcodeReset?: unknown;
  branding?: unknown;
}

interface BrandingPatch {
  displayName?: string;
  logoUrl?: string;
  themeColor?: string;
  defaultLocale?: 'en' | 'zh';
}

function sanitizeBranding(raw: unknown): BrandingPatch | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const out: BrandingPatch = {};
  if (typeof b.displayName === 'string' && b.displayName.trim()) {
    out.displayName = b.displayName.trim().slice(0, 80);
  }
  if (typeof b.logoUrl === 'string') out.logoUrl = b.logoUrl.trim().slice(0, 500);
  if (typeof b.themeColor === 'string') out.themeColor = b.themeColor.trim().slice(0, 32);
  if (b.defaultLocale === 'en' || b.defaultLocale === 'zh') out.defaultLocale = b.defaultLocale;
  return Object.keys(out).length > 0 ? out : null;
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const denied = requireInternalAuth(req);
  if (denied) return denied;

  const slug = await parseSlug(ctx);
  if (!slug) {
    return NextResponse.json({ ok: false, error: 'invalid slug' }, { status: 400 });
  }

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
  let newPasscode: string | undefined;
  let nextStatus: StoreStatus | undefined;

  // ── status push ──
  if (body.status !== undefined) {
    const target = body.status as StoreStatus;
    if (typeof target !== 'string' || !PORTAL_PUSHABLE.has(target)) {
      return NextResponse.json(
        { ok: false, error: `unsupported status '${String(body.status)}'` },
        { status: 400 }
      );
    }
    if (store.status === 'canceled' && target !== 'canceled') {
      return NextResponse.json(
        { ok: false, error: "store is canceled — terminal state, cannot leave 'canceled'" },
        { status: 409 }
      );
    }
    if (target !== store.status) {
      set.status = target;
    }
    nextStatus = target;
  }

  // ── passcode reset ──
  if (body.passcodeReset === true) {
    newPasscode = generatePasscode();
    set['admin.passcodeHash'] = hashPasscode(newPasscode);
    set['admin.passcodeUpdatedAt'] = new Date();
  }

  // ── branding merge ──
  if (body.branding !== undefined) {
    const patch = sanitizeBranding(body.branding);
    if (!patch) {
      return NextResponse.json(
        { ok: false, error: 'branding patch has no valid fields' },
        { status: 400 }
      );
    }
    for (const [k, v] of Object.entries(patch)) set[`branding.${k}`] = v;
  }

  if (Object.keys(set).length > 0) {
    set.updated_at = new Date();
    await col.updateOne({ slug }, { $set: set });
  }
  bustStoreCache(slug);

  return NextResponse.json({
    ok: true,
    slug,
    status: nextStatus ?? store.status,
    // Plaintext passcode leaves the system exactly once, in this response.
    ...(newPasscode ? { passcode: newPasscode } : {}),
  });
}
