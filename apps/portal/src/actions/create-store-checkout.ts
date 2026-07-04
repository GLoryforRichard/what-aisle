'use server';

import { randomUUID } from 'crypto';
import { websiteConfig } from '@/config/website';
import { getDb } from '@/db';
import { stores } from '@/db/schema';
import { userActionClient } from '@/lib/safe-action';
import { slugify, validateSlug } from '@/lib/slug';
import { PENDING_PAYMENT_TTL_MS, STORE_STATUS } from '@/lib/store-status';
import { getUrlWithLocale } from '@/lib/urls';
import { createCheckout, expireCheckout } from '@/payment';
import { PaymentTypes } from '@/payment/types';
import { Routes } from '@/routes';
import { and, eq } from 'drizzle-orm';
import { getLocale } from 'next-intl/server';
import { z } from 'zod';

const createStoreCheckoutSchema = z.object({
  storeName: z.string().min(1).max(100),
});

const SLUG_TAKEN_ERROR =
  'This store name was just taken, please try another one';

/**
 * Checkout sessions must die BEFORE the 24h pending_payment row TTL,
 * otherwise a superseded session could still be paid after the row was
 * taken over. Stripe allows expires_at between 30min and 24h.
 */
const CHECKOUT_SESSION_TTL_MS = 23 * 60 * 60 * 1000;

/**
 * Start the What-Aisle checkout for a store (PRD F-3):
 * 1. slugify + validate the store name
 * 2. insert a `pending_payment` stores row to lock the slug
 *    (the unique constraint on slug is the race guard)
 * 3. create ONE Stripe Checkout: $99/mo subscription + $688 one-time
 *    setup fee, with storeSlug/storeName in the metadata
 */
export const createStoreCheckoutAction = userActionClient
  .inputSchema(createStoreCheckoutSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { storeName } = parsedInput;
    const currentUser = ctx.user;

    const slug = slugify(storeName);
    const validation = validateSlug(slug);
    if (!validation.valid) {
      return {
        success: false,
        error:
          validation.reason === 'reserved'
            ? 'This store name is reserved, please choose another one'
            : 'Please enter a store name with at least 3 letters or numbers',
      };
    }

    const plan = websiteConfig.price.plans.whataisle;
    const price = plan?.prices.find(
      (p) => p.type === PaymentTypes.SUBSCRIPTION && !p.disabled
    );
    if (!plan || !price?.priceId) {
      return {
        success: false,
        error: 'The What-Aisle plan is not configured',
      };
    }

    const db = await getDb();
    const now = new Date();
    let createdFreshRow = false;
    let storeRowId: string;

    try {
      // Lock the slug with a pending_payment row
      const existing = await db
        .select()
        .from(stores)
        .where(eq(stores.slug, slug))
        .limit(1);

      if (existing.length > 0) {
        const row = existing[0];
        const isStalePending =
          row.status === STORE_STATUS.PENDING_PAYMENT &&
          row.createdAt.getTime() < Date.now() - PENDING_PAYMENT_TTL_MS;
        const isOwnPending =
          row.status === STORE_STATUS.PENDING_PAYMENT &&
          row.userId === currentUser.id;
        const isCanceled = row.status === STORE_STATUS.CANCELED;

        if (isStalePending || isCanceled || isOwnPending) {
          // Kill the superseded Checkout session BEFORE creating a new
          // one, so the old link can no longer be paid. Best-effort: the
          // session↔row correlation in the webhook guards provisioning
          // even if this fails.
          if (row.checkoutSessionId) {
            try {
              await expireCheckout(row.checkoutSessionId);
            } catch (error) {
              console.error(
                `failed to expire superseded checkout session ${row.checkoutSessionId} for slug '${slug}':`,
                error
              );
            }
          }

          // Take over the released/own row (keeps the unique constraint
          // as the race guard instead of delete+insert). The updatedAt
          // equality check is the optimistic lock: status alone is a
          // no-op guard for pending→pending takeovers, so two concurrent
          // claimants would otherwise both "win". updatedAt is always
          // set to a fresh `new Date()` here, so exactly one concurrent
          // UPDATE can match the previously-read value.
          const updated = await db
            .update(stores)
            .set({
              userId: currentUser.id,
              name: storeName,
              status: STORE_STATUS.PENDING_PAYMENT,
              stripeCustomerId: null,
              subscriptionId: null,
              setupPaymentId: null,
              checkoutSessionId: null,
              suspensionReason: null,
              paymentFailedAt: null,
              liveAt: null,
              suspendedAt: null,
              canceledAt: null,
              createdAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(stores.id, row.id),
                eq(stores.status, row.status),
                eq(stores.updatedAt, row.updatedAt)
              )
            )
            .returning({ id: stores.id });
          if (updated.length === 0) {
            // Someone else claimed the row in between (the optimistic
            // lock lost) — only the winning writer proceeds.
            return { success: false, error: SLUG_TAKEN_ERROR };
          }
          storeRowId = row.id;
        } else {
          return { success: false, error: SLUG_TAKEN_ERROR };
        }
      } else {
        try {
          storeRowId = randomUUID();
          await db.insert(stores).values({
            id: storeRowId,
            userId: currentUser.id,
            slug,
            name: storeName,
            status: STORE_STATUS.PENDING_PAYMENT,
            createdAt: now,
            updatedAt: now,
          });
          createdFreshRow = true;
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes('unique constraint')
          ) {
            return { success: false, error: SLUG_TAKEN_ERROR };
          }
          throw error;
        }
      }

      // Create the mixed checkout session
      const locale = await getLocale();
      const successUrl = getUrlWithLocale(
        `${Routes.Payment}?session_id={CHECKOUT_SESSION_ID}&callback=${Routes.Dashboard}`,
        locale
      );
      const cancelUrl = getUrlWithLocale(
        `/?store=${encodeURIComponent(storeName)}`,
        locale
      );

      const result = await createCheckout({
        planId: plan.id,
        priceId: price.priceId,
        customerEmail: currentUser.email,
        metadata: {
          userId: currentUser.id,
          userName: currentUser.name,
          storeSlug: slug,
          storeName,
          locale,
        },
        successUrl,
        cancelUrl,
        locale,
        // Sessions die before the 24h pending row TTL, so a superseded
        // session can never outlive the slug lock it belongs to.
        expiresAt: new Date(Date.now() + CHECKOUT_SESSION_TTL_MS),
      });

      // Correlate the session with the row: only THIS session may
      // provision the row (checked in onStoreCheckoutCompleted), and
      // only THIS session's expiry may release it.
      const linked = await db
        .update(stores)
        .set({ checkoutSessionId: result.id, updatedAt: new Date() })
        .where(
          and(
            eq(stores.id, storeRowId),
            eq(stores.status, STORE_STATUS.PENDING_PAYMENT),
            eq(stores.userId, currentUser.id)
          )
        )
        .returning({ id: stores.id });
      if (linked.length === 0) {
        // The row was taken over while we were creating the session —
        // kill the now-orphaned session and give the friendly error.
        try {
          await expireCheckout(result.id);
        } catch (error) {
          console.error(
            `failed to expire orphaned checkout session ${result.id}:`,
            error
          );
        }
        return { success: false, error: SLUG_TAKEN_ERROR };
      }

      return {
        success: true,
        data: { url: result.url, id: result.id, slug },
      };
    } catch (error) {
      console.error('create store checkout error:', error);
      // Best-effort: release the slug we just locked so the visitor can retry
      if (createdFreshRow) {
        try {
          await db
            .delete(stores)
            .where(
              and(
                eq(stores.slug, slug),
                eq(stores.status, STORE_STATUS.PENDING_PAYMENT),
                eq(stores.userId, currentUser.id)
              )
            );
        } catch (cleanupError) {
          console.error('release pending slug error:', cleanupError);
        }
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Something went wrong',
      };
    }
  });
