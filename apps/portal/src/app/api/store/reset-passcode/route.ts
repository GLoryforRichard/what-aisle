import { getOwnedStore } from '@/lib/store-owner';
import { STORE_STATUS } from '@/lib/store-status';
import { requireSession, unauthorizedResponse } from '@/lib/require-session';
import { resetStorePasscode } from '@/lib/stores-api';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/store/reset-passcode (PRD F-5 / task #6)
 *
 * Rotate the staff /admin passcode for the owner's store and return the new
 * value ONCE (the Stores App only stores a hash, so it is never retrievable
 * again). Only meaningful once the store is live.
 *
 * SECURITY: session-authed; acts only on the caller's OWN store.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession(request);
  if (!session) {
    return unauthorizedResponse();
  }

  const store = await getOwnedStore(session.user.id);
  if (!store) {
    return NextResponse.json({ error: 'No store found' }, { status: 404 });
  }

  if (store.status !== STORE_STATUS.LIVE) {
    return NextResponse.json(
      { error: 'Passcode can only be reset for a live store' },
      { status: 409 }
    );
  }

  try {
    const { passcode } = await resetStorePasscode(store.slug);
    return NextResponse.json({ passcode });
  } catch (error) {
    console.error('[reset-passcode] failed:', error);
    return NextResponse.json(
      { error: 'Could not reset the passcode. Please try again.' },
      { status: 502 }
    );
  }
}
