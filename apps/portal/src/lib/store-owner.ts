import 'server-only';

import { getDb } from '@/db';
import { stores } from '@/db/schema';
import { desc, eq } from 'drizzle-orm';

/**
 * Shared server-side store-ownership resolution (PRD F-5 / task #6).
 *
 * SECURITY: every store-owner route and the dashboard page load the caller's
 * store THROUGH this helper, which filters strictly on `userId`. A user can
 * therefore never see or mutate a store they do not own — there is no code
 * path that fetches a store by slug and then trusts a client-supplied owner.
 *
 * MVP is one store per user; if a user somehow has several, the most recent is
 * treated as "their" store (the dashboard renders it, routes act on it).
 */
export type Store = typeof stores.$inferSelect;

/**
 * Load the store owned by `userId`, or null if the user owns none.
 */
export async function getOwnedStore(userId: string): Promise<Store | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(stores)
    .where(eq(stores.userId, userId))
    .orderBy(desc(stores.createdAt))
    .limit(1);
  return rows[0] ?? null;
}
