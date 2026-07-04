import { getDb } from '@/db';
import { stores } from '@/db/schema';
import {
  STORE_STATUS,
  STORE_STATUSES,
  SUSPENSION_REASON,
  type StoreStatus,
} from '@/lib/store-status';
import { createHash, timingSafeEqual } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * Internal endpoint: the Stores App superadmin reports status changes
 * back to the portal (Go Live / Suspend, PRD F-13).
 *
 * Auth: shared bearer secret over the loopback interface only —
 * Caddy returns 403 for /api/internal/* on every public vhost.
 *
 * Only a whitelist of manual transitions is allowed (the billing
 * lifecycle is driven exclusively by Stripe webhooks):
 *   awaiting_video → building   (video received, build started)
 *   building       → live       (founder clicks Go Live)
 *   live           → suspended  (manual suspension)
 *   suspended      → live       (manual revive)
 * 'canceled' is terminal — nothing transitions out of it, and this
 * endpoint cannot set it.
 */

const ALLOWED_TRANSITIONS: ReadonlyArray<[StoreStatus, StoreStatus]> = [
  [STORE_STATUS.AWAITING_VIDEO, STORE_STATUS.BUILDING],
  [STORE_STATUS.BUILDING, STORE_STATUS.LIVE],
  [STORE_STATUS.LIVE, STORE_STATUS.SUSPENDED],
  [STORE_STATUS.SUSPENDED, STORE_STATUS.LIVE],
];

const bodySchema = z.object({
  slug: z.string().min(1),
  status: z.enum(STORE_STATUSES as [StoreStatus, ...StoreStatus[]]),
  liveAt: z.iso.datetime().optional(),
});

/** Constant-time string comparison over sha256 digests of both values */
function safeCompare(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a).digest();
  const digestB = createHash('sha256').update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    console.error('INTERNAL_API_SECRET environment variable is not set');
    return false;
  }
  const header = req.headers.get('authorization') || '';
  return safeCompare(header, `Bearer ${secret}`);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }

  const { slug, status, liveAt } = parsed;

  try {
    const db = await getDb();
    const now = new Date();

    const rows = await db
      .select()
      .from(stores)
      .where(eq(stores.slug, slug))
      .limit(1);
    const store = rows[0];
    if (!store) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 });
    }

    const isAllowed = ALLOWED_TRANSITIONS.some(
      ([from, to]) => from === store.status && to === status
    );
    if (!isAllowed) {
      return NextResponse.json(
        {
          error: `Transition '${store.status}' → '${status}' is not allowed for this endpoint`,
          currentStatus: store.status,
          requestedStatus: status,
          allowedTransitions: ALLOWED_TRANSITIONS.map(
            ([from, to]) => `${from} → ${to}`
          ),
        },
        { status: 409 }
      );
    }

    const patch: Record<string, unknown> = {
      status,
      updatedAt: now,
    };
    if (status === STORE_STATUS.LIVE) {
      // Going live (Go Live or manual revive) always clears the dunning
      // timer and any suspension bookkeeping.
      patch.liveAt = liveAt ? new Date(liveAt) : (store.liveAt ?? now);
      patch.suspendedAt = null;
      patch.paymentFailedAt = null;
      patch.suspensionReason = null;
    } else if (status === STORE_STATUS.SUSPENDED) {
      patch.suspendedAt = now;
      patch.suspensionReason = SUSPENSION_REASON.MANUAL;
    }

    // Optimistic guard on the previously-read status so a concurrent
    // webhook transition cannot be overwritten blindly.
    const updated = await db
      .update(stores)
      .set(patch)
      .where(and(eq(stores.id, store.id), eq(stores.status, store.status)))
      .returning({ id: stores.id, status: stores.status });

    if (updated.length === 0) {
      return NextResponse.json(
        {
          error: `Store '${slug}' changed status concurrently, retry with the current state`,
        },
        { status: 409 }
      );
    }

    console.log(`[internal] store '${slug}' status set to '${status}'`);
    return NextResponse.json({ success: true, slug, status });
  } catch (error) {
    console.error('[internal] store-status update error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
