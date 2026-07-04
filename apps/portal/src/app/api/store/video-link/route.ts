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
 * POST /api/store/video-link (PRD F-5 / task #6)
 *
 * Escape hatch: instead of uploading, the owner pastes an external drive link
 * (网盘链接) to their layout footage. Same awaiting_video → building transition
 * and founder notification as a real upload.
 *
 * SECURITY: session-authed; acts only on the caller's OWN store.
 */

const bodySchema = z.object({
  url: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .refine((value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'Must be a valid http(s) URL'),
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

  const isAwaiting = store.status === STORE_STATUS.AWAITING_VIDEO;
  const isBuilding = store.status === STORE_STATUS.BUILDING;
  if (!isAwaiting && !isBuilding) {
    return NextResponse.json(
      { error: `Cannot attach a link while store is '${store.status}'` },
      { status: 409 }
    );
  }

  const db = await getDb();
  const now = new Date();

  await db
    .update(stores)
    .set({
      videoExternalUrl: parsed.url,
      status: STORE_STATUS.BUILDING,
      updatedAt: now,
    })
    .where(and(eq(stores.id, store.id), eq(stores.userId, session.user.id)));

  if (isAwaiting) {
    void updateStore(store.slug, { status: STORE_STATUS.BUILDING }).catch(
      (error) => {
        console.error(
          `[video-link] failed to push 'building' for '${store.slug}':`,
          error
        );
      }
    );
    void notifyFounder(
      `🔗 What-Aisle: '${store.slug}' submitted an external video link (${parsed.url}). Ready to build.`
    );
  }

  return NextResponse.json({ ok: true });
}
