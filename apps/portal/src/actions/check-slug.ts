'use server';

import { getDb } from '@/db';
import { stores } from '@/db/schema';
import { actionClient } from '@/lib/safe-action';
import { slugify, validateSlug } from '@/lib/slug';
import { PENDING_PAYMENT_TTL_MS, STORE_STATUS } from '@/lib/store-status';
import { and, eq, gt, ne, or } from 'drizzle-orm';
import { z } from 'zod';

const checkSlugSchema = z.object({
  // Raw store name typed by the visitor (will be slugified) or a slug
  storeName: z.string().min(1).max(100),
});

export interface CheckSlugResult {
  available: boolean;
  slug: string;
  reason?: 'invalid' | 'reserved' | 'taken';
}

/**
 * Check whether a store row locks the given slug:
 * - any non-canceled store locks its slug
 * - EXCEPT pending_payment rows older than 24h (abandoned checkouts),
 *   which are considered released (PRD 3.2)
 */
async function isSlugTaken(slug: string): Promise<boolean> {
  const db = await getDb();
  const lockThreshold = new Date(Date.now() - PENDING_PAYMENT_TTL_MS);
  const rows = await db
    .select({ id: stores.id })
    .from(stores)
    .where(
      and(
        eq(stores.slug, slug),
        ne(stores.status, STORE_STATUS.CANCELED),
        or(
          ne(stores.status, STORE_STATUS.PENDING_PAYMENT),
          gt(stores.createdAt, lockThreshold)
        )
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Store name availability checker (public, PRD F-1).
 * Input a raw store name → { available, slug, reason? }.
 * Display-only: no resource is created here.
 */
export const checkSlugAction = actionClient
  .inputSchema(checkSlugSchema)
  .action(async ({ parsedInput }): Promise<CheckSlugResult> => {
    const slug = slugify(parsedInput.storeName);

    const validation = validateSlug(slug);
    if (!validation.valid) {
      return { available: false, slug, reason: validation.reason };
    }

    try {
      if (await isSlugTaken(slug)) {
        return { available: false, slug, reason: 'taken' };
      }
      return { available: true, slug };
    } catch (error) {
      console.error('check slug error:', error);
      // Fail closed: report unavailable rather than promising a slug
      // we could not verify.
      return { available: false, slug, reason: 'taken' };
    }
  });
