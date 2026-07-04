/**
 * POST /api/internal/stores — provision a store (PRD F-13, called by the
 * portal after Stripe `checkout.session.completed`).
 *
 * Idempotent for webhook retries: if the slug already exists we return
 * 200 {alreadyExists:true} and DO NOT touch the document (in particular the
 * passcode is never regenerated — its plaintext only ever leaves once, in
 * the 201 response of the call that created the store).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireInternalAuth } from '@/lib/internal-auth';
import { validateSlug } from '@/lib/slug';
import { generatePasscode, hashPasscode } from '@/lib/admin-session';
import { bustStoreCache } from '@/lib/store-context';
import { FLOORPLAN_TEMPLATE } from '@/lib/templates/default-store';
import { Store, STORES_COLLECTION } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CreateBody {
  slug?: unknown;
  name?: unknown;
  portalUserId?: unknown;
  stripeCustomerId?: unknown;
  subscriptionId?: unknown;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export async function POST(req: NextRequest) {
  const denied = requireInternalAuth(req);
  if (denied) return denied;

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const slugCheck = validateSlug(typeof body.slug === 'string' ? body.slug : '');
  if (!slugCheck.ok) {
    return NextResponse.json(
      { ok: false, error: 'invalid slug', reason: slugCheck.reason },
      { status: 400 }
    );
  }
  const slug = slugCheck.slug;

  const name = str(body.name);
  if (!name) {
    return NextResponse.json({ ok: false, error: 'name is required' }, { status: 400 });
  }

  const db = await getDb();
  const col = db.collection<Store>(STORES_COLLECTION);

  const existing = await col.findOne({ slug }, { projection: { slug: 1, status: 1 } });
  if (existing) {
    return NextResponse.json({
      ok: true,
      alreadyExists: true,
      slug,
      status: existing.status,
    });
  }

  const passcode = generatePasscode();
  const now = new Date();
  const doc: Store = {
    slug,
    name,
    status: 'awaiting_video',
    branding: {
      displayName: name,
      defaultLocale: 'en',
    },
    admin: {
      passcodeHash: hashPasscode(passcode),
      passcodeUpdatedAt: now,
    },
    // New stores start with an EMPTY taxonomy/floorplan — the founder builds
    // them in the superadmin console (from the walkthrough video), optionally
    // starting from the template. The viewBox is copied so the floorplan
    // editor's preview has a sane canvas before any rects exist.
    shelves: [],
    floorplan: {
      viewBox: { ...FLOORPLAN_TEMPLATE.viewBox },
      rects: [],
      labels: [],
    },
    billing: {
      portalUserId: str(body.portalUserId),
      stripeCustomerId: str(body.stripeCustomerId),
      subscriptionId: str(body.subscriptionId),
    },
    video: {},
    created_at: now,
    updated_at: now,
  };

  try {
    await col.insertOne(doc);
  } catch (err) {
    // Unique-index race with a concurrent webhook retry → same idempotent
    // answer as the findOne fast path above.
    if (err && typeof err === 'object' && (err as { code?: number }).code === 11000) {
      const raced = await col.findOne({ slug }, { projection: { status: 1 } });
      return NextResponse.json({
        ok: true,
        alreadyExists: true,
        slug,
        status: raced?.status ?? 'awaiting_video',
      });
    }
    throw err;
  }

  bustStoreCache(slug);
  // Plaintext passcode leaves the system exactly ONCE, here (portal emails it
  // to the store owner at Go-Live). Only the bcrypt hash is stored.
  return NextResponse.json(
    { ok: true, slug, status: doc.status, passcode },
    { status: 201 }
  );
}
