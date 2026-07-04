import { getDb } from '@/db';
import { stores } from '@/db/schema';
import { STORE_STATUSES, type StoreStatus } from '@/lib/store-status';
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * Internal endpoint: the Stores App superadmin reports status changes
 * back to the portal (Go Live / Suspend, PRD F-13).
 *
 * Auth: shared bearer secret over the loopback interface only —
 * Caddy returns 403 for /api/internal/* on every public vhost.
 */

const bodySchema = z.object({
  slug: z.string().min(1),
  status: z.enum(STORE_STATUSES as [StoreStatus, ...StoreStatus[]]),
  liveAt: z.iso.datetime().optional(),
});

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    console.error('INTERNAL_API_SECRET environment variable is not set');
    return false;
  }
  const header = req.headers.get('authorization') || '';
  return header === `Bearer ${secret}`;
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

    const patch: Record<string, unknown> = {
      status,
      updatedAt: now,
    };
    if (status === 'live') {
      patch.liveAt = liveAt ? new Date(liveAt) : now;
      patch.suspendedAt = null;
    } else if (status === 'suspended') {
      patch.suspendedAt = now;
    } else if (status === 'canceled') {
      patch.canceledAt = now;
    }

    const updated = await db
      .update(stores)
      .set(patch)
      .where(eq(stores.slug, slug))
      .returning({ id: stores.id, status: stores.status });

    if (updated.length === 0) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 });
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
