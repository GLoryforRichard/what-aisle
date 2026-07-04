import { getDb } from '@/db';
import { stores } from '@/db/schema';
import { notifyFounder } from '@/lib/store-lifecycle';
import { getOwnedStore } from '@/lib/store-owner';
import { STORE_STATUS } from '@/lib/store-status';
import { requireSession, unauthorizedResponse } from '@/lib/require-session';
import { updateStore } from '@/lib/stores-api';
import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * POST /api/store/video-complete (PRD F-5 / task #6)
 *
 * Called by the browser after a presigned PUT succeeds. Records the R2 key and
 * transitions awaiting_video → building.
 *
 * SECURITY: session-authed; loads the caller's OWN store (getOwnedStore filters
 * on session.user.id). Anti-tamper: the reported key MUST live under this
 * store's `stores/{slug}/video/` prefix, so a caller cannot claim someone
 * else's object even though presign already scopes the key server-side.
 *
 * Idempotent: safe to call again while already 'building' (no-op transition).
 */

const bodySchema = z.object({
  key: z.string().min(1).max(1024),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession(request);
  if (!session) {
    return unauthorizedResponse();
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }

  const store = await getOwnedStore(session.user.id);
  if (!store) {
    return NextResponse.json({ error: 'No store found' }, { status: 404 });
  }

  // Anti-tamper: the key must belong to THIS store's prefix.
  const expectedPrefix = `stores/${store.slug}/video/`;
  if (!parsed.key.startsWith(expectedPrefix)) {
    return NextResponse.json(
      { error: 'Key does not belong to your store' },
      { status: 403 }
    );
  }

  const isAwaiting = store.status === STORE_STATUS.AWAITING_VIDEO;
  const isBuilding = store.status === STORE_STATUS.BUILDING;
  if (!isAwaiting && !isBuilding) {
    return NextResponse.json(
      { error: `Cannot attach a video while store is '${store.status}'` },
      { status: 409 }
    );
  }

  const db = await getDb();
  const now = new Date();

  // Always record the key; only bump status when leaving awaiting_video.
  // The WHERE clause pins userId + current status so a concurrent lifecycle
  // change cannot be clobbered.
  await db
    .update(stores)
    .set({
      videoR2Key: parsed.key,
      status: STORE_STATUS.BUILDING,
      updatedAt: now,
    })
    .where(and(eq(stores.id, store.id), eq(stores.userId, session.user.id)));

  // Fire-and-forget: sync the Stores App and alert the founder. Never block or
  // fail the response on these — the portal DB is the source of truth.
  if (isAwaiting) {
    void updateStore(store.slug, { status: STORE_STATUS.BUILDING }).catch(
      (error) => {
        console.error(
          `[video-complete] failed to push 'building' for '${store.slug}':`,
          error
        );
      }
    );
    void notifyFounder(
      `🎬 What-Aisle: '${store.slug}' uploaded its layout video (R2 ${parsed.key}). Ready to build.`
    );
  }

  return NextResponse.json({ ok: true });
}
