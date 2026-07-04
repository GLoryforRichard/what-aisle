import { getDb } from '@/db';
import { stores } from '@/db/schema';
import {
  PAYMENT_FAILED_GRACE_MS,
  notifyFounder,
  pushStatusToStoresApp,
} from '@/lib/store-lifecycle';
import {
  PENDING_PAYMENT_TTL_MS,
  STORE_STATUS,
  SUSPENSION_REASON,
} from '@/lib/store-status';
import { expireCheckout } from '@/payment';
import { createHash, timingSafeEqual } from 'crypto';
import { and, eq, lt } from 'drizzle-orm';
import { NextResponse } from 'next/server';

/**
 * Daily store-maintenance cron (PRD backstop; schedule it once a day,
 * see env.example → "Cron Jobs"). Auth follows the template's cron
 * pattern: basic auth via CRON_JOBS_USERNAME / CRON_JOBS_PASSWORD.
 *
 * (a) Dunning backstop: suspend live stores whose first payment
 *     failure is older than the 7-day grace period. The webhook path
 *     only suspends when ANOTHER invoice.payment_failed arrives after
 *     the grace expiry — without this cron a store whose retries
 *     stopped early would stay live forever.
 * (b) Slug-lock backstop: release pending_payment rows older than 24h
 *     (expire their Stripe Checkout session first, best-effort) —
 *     covers missed/undelivered checkout.session.expired webhooks.
 */

/** Constant-time string comparison over sha256 digests of both values */
function safeCompare(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a).digest();
  const digestB = createHash('sha256').update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

// Basic authentication middleware (same pattern as /api/distribute-credits)
function validateBasicAuth(request: Request): boolean {
  const authHeader = request.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return false;
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString(
    'utf-8'
  );

  const expectedUsername = process.env.CRON_JOBS_USERNAME;
  const expectedPassword = process.env.CRON_JOBS_PASSWORD;

  if (!expectedUsername || !expectedPassword) {
    console.error(
      'Basic auth credentials not configured in environment variables'
    );
    return false;
  }

  return safeCompare(credentials, `${expectedUsername}:${expectedPassword}`);
}

/**
 * (a) Suspend live stores whose dunning grace period has expired.
 */
async function suspendOverdueStores(): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - PAYMENT_FAILED_GRACE_MS);

  const candidates = await db
    .select()
    .from(stores)
    .where(
      and(
        eq(stores.status, STORE_STATUS.LIVE),
        lt(stores.paymentFailedAt, cutoff)
      )
    );

  let suspended = 0;
  for (const store of candidates) {
    const now = new Date();
    // Optimistic guard: skip if a webhook changed the status meanwhile
    const updated = await db
      .update(stores)
      .set({
        status: STORE_STATUS.SUSPENDED,
        suspensionReason: SUSPENSION_REASON.DUNNING,
        suspendedAt: now,
        updatedAt: now,
      })
      .where(and(eq(stores.id, store.id), eq(stores.status, STORE_STATUS.LIVE)))
      .returning({ id: stores.id });
    if (updated.length === 0) continue;

    suspended++;
    console.log(
      `[store-maintenance] store '${store.slug}' suspended (payment failed > 7 days, cron backstop)`
    );
    // Cron is not a webhook path — awaiting is fine (never rejects)
    await pushStatusToStoresApp(store.slug, STORE_STATUS.SUSPENDED);
    await notifyFounder(
      `🛑 What-Aisle: store '${store.slug}' SUSPENDED by the daily cron after 7 days of failed payments.`
    );
  }
  return suspended;
}

/**
 * (b) Release pending_payment rows older than the 24h TTL: expire the
 * associated Checkout session at Stripe (ignore errors), then delete
 * the row so the slug can be claimed again.
 */
async function releaseStalePendingRows(): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - PENDING_PAYMENT_TTL_MS);

  const staleRows = await db
    .select()
    .from(stores)
    .where(
      and(
        eq(stores.status, STORE_STATUS.PENDING_PAYMENT),
        lt(stores.createdAt, cutoff)
      )
    );

  let released = 0;
  for (const row of staleRows) {
    if (row.checkoutSessionId) {
      try {
        await expireCheckout(row.checkoutSessionId);
      } catch (error) {
        console.error(
          `[store-maintenance] failed to expire checkout session ${row.checkoutSessionId} for slug '${row.slug}':`,
          error
        );
        // proceed: the session dies on its own (23h expires_at) and the
        // session↔row correlation in the webhook guards provisioning
      }
    }

    // createdAt guard: a concurrent takeover resets createdAt, so we
    // never delete a freshly re-claimed lock.
    const deleted = await db
      .delete(stores)
      .where(
        and(
          eq(stores.id, row.id),
          eq(stores.status, STORE_STATUS.PENDING_PAYMENT),
          eq(stores.createdAt, row.createdAt)
        )
      )
      .returning({ id: stores.id });
    if (deleted.length > 0) {
      released++;
      console.log(
        `[store-maintenance] released stale pending slug '${row.slug}' (row older than 24h)`
      );
    }
  }
  return released;
}

/**
 * Daily store maintenance: dunning suspension backstop + stale
 * pending_payment cleanup.
 */
export async function GET(request: Request) {
  if (!validateBasicAuth(request)) {
    console.error('store maintenance cron unauthorized');
    return new NextResponse('Unauthorized', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Secure Area"',
      },
    });
  }

  try {
    const suspendedCount = await suspendOverdueStores();
    const releasedCount = await releaseStalePendingRows();

    return NextResponse.json({
      message: `store maintenance success, suspended: ${suspendedCount}, released: ${releasedCount}`,
      suspendedCount,
      releasedCount,
    });
  } catch (error) {
    console.error('[store-maintenance] cron error:', error);
    return NextResponse.json(
      { error: 'Store maintenance failed' },
      { status: 500 }
    );
  }
}
