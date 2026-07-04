import { requireSession, unauthorizedResponse } from '@/lib/require-session';
import {
  MAX_VIDEO_BYTES,
  buildVideoKey,
  presignVideoUpload,
} from '@/lib/r2-presign';
import { getOwnedStore } from '@/lib/store-owner';
import { STORE_STATUS } from '@/lib/store-status';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * POST /api/store/video-upload-url (PRD F-5 / task #6)
 *
 * Mint a short-lived presigned R2 PUT URL so the browser can upload the store
 * layout video directly (bypassing the 4MB image upload route).
 *
 * SECURITY: session-authed; the caller must OWN a store (getOwnedStore filters
 * on session.user.id) whose status is awaiting_video or building. The object
 * key is derived server-side from the OWNED store's slug — a client can never
 * steer the presign toward another store's prefix.
 */

// Only these states may (re)upload a video.
const UPLOADABLE_STATUSES: string[] = [
  STORE_STATUS.AWAITING_VIDEO,
  STORE_STATUS.BUILDING,
];

const bodySchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive().max(MAX_VIDEO_BYTES),
});

// Light in-memory rate limit: 10 presigns / user / minute. Enough to stop a
// runaway loop without a Redis dependency; resets on server restart.
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 1000;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const entry = hits.get(userId);
  if (!entry || now > entry.resetAt) {
    hits.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession(request);
  if (!session) {
    return unauthorizedResponse();
  }

  if (rateLimited(session.user.id)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
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

  const { filename, contentType, sizeBytes } = parsed;

  if (!contentType.startsWith('video/')) {
    return NextResponse.json(
      { error: 'Only video files are allowed' },
      { status: 400 }
    );
  }

  if (sizeBytes > MAX_VIDEO_BYTES) {
    return NextResponse.json(
      { error: 'File exceeds the 2GB limit' },
      { status: 400 }
    );
  }

  const store = await getOwnedStore(session.user.id);
  if (!store) {
    return NextResponse.json({ error: 'No store found' }, { status: 404 });
  }

  if (!UPLOADABLE_STATUSES.includes(store.status)) {
    return NextResponse.json(
      { error: `Cannot upload a video while store is '${store.status}'` },
      { status: 409 }
    );
  }

  const key = buildVideoKey(store.slug, filename);

  try {
    const uploadUrl = await presignVideoUpload(key, contentType);
    return NextResponse.json({ uploadUrl, key });
  } catch (error) {
    console.error('[video-upload-url] presign failed:', error);
    return NextResponse.json(
      { error: 'Could not create upload URL' },
      { status: 500 }
    );
  }
}
