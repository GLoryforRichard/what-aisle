import 'server-only';

import { getDb } from '@/db';
import { stores, user } from '@/db/schema';
import { sendEmail } from '@/mail';
import { getUrlWithLocale } from '@/lib/urls';
import {
  STORE_STATUS,
  SUSPENSION_REASON,
  type StoreStatus,
} from '@/lib/store-status';
import { createStore, updateStore } from '@/lib/stores-api';
import { Routes } from '@/routes';
import { randomUUID } from 'crypto';
import { and, eq, isNull, ne, or } from 'drizzle-orm';
import type { Locale } from 'next-intl';
import { Stripe } from 'stripe';

/**
 * Store lifecycle transitions driven by Stripe webhooks (PRD 3.2 / F-4).
 *
 * pending_payment ─(checkout.session.completed)→ awaiting_video
 * pending_payment ─(checkout.session.expired)→ row released
 * live ─(invoice.payment_failed > 7 days)→ suspended (dunning)
 * suspended (dunning) ─(invoice.paid)→ live
 * any ─(customer.subscription.deleted)→ suspended (sub_deleted)
 * any ─(charge.refunded)→ canceled
 *
 * Every handler is idempotent (safe on Stripe event replay). The DB
 * transition of onStoreCheckoutCompleted THROWS on failure so the
 * webhook route returns 5xx and Stripe redelivers — a paid customer
 * must never be silently dropped. All other handlers never throw.
 * Slow side effects (Stores App provisioning, emails) run out-of-band
 * so the webhook response never waits on them (long-running Node
 * server, un-awaited promises survive the request).
 */

/** Dunning grace period: suspended after 7 days of failed payments */
export const PAYMENT_FAILED_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** Subscription statuses that count as "alive" for auto-restore */
const ALIVE_SUBSCRIPTION_STATUSES: Stripe.Subscription.Status[] = [
  'active',
  'trialing',
  'past_due',
];

let stripeClient: Stripe | null = null;

/**
 * Lazy Stripe client for lookups the webhook payloads cannot answer
 * (charge → invoice resolution, subscription liveness checks).
 */
function getStripeClient(): Stripe {
  if (!stripeClient) {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set');
    }
    stripeClient = new Stripe(apiKey);
  }
  return stripeClient;
}

/**
 * Notify the founder about an operational issue or event.
 * Uses the notification webhook (Discord/Feishu) directly with a plain
 * message, since the template's NotificationProvider only exposes
 * payment/credits-specific methods.
 */
export async function notifyFounder(message: string): Promise<void> {
  console.error(`[store-lifecycle] FOUNDER ALERT: ${message}`);
  try {
    const discordUrl = process.env.DISCORD_WEBHOOK_URL;
    const feishuUrl = process.env.FEISHU_WEBHOOK_URL;
    if (discordUrl) {
      const { sendWebhookMessage } = await import('@/notification/utils');
      await sendWebhookMessage(discordUrl, { content: message });
    } else if (feishuUrl) {
      const { sendWebhookMessage } = await import('@/notification/utils');
      await sendWebhookMessage(feishuUrl, {
        msg_type: 'text',
        content: { text: message },
      });
    }
    // TODO: if neither webhook is configured, the console.error above is
    // the only signal — configure DISCORD_WEBHOOK_URL in production.
  } catch (error) {
    console.error('[store-lifecycle] notifyFounder failed:', error);
  }
}

/**
 * Push a status change to the Stores App; alert the founder when the
 * internal API stays unreachable (the client already retries 3x).
 * Never rejects — safe to fire-and-forget from webhook handlers so the
 * Stripe response never waits on the Stores App (~33s worst case).
 */
export async function pushStatusToStoresApp(
  slug: string,
  status: StoreStatus
): Promise<void> {
  try {
    await updateStore(slug, { status });
  } catch (error) {
    console.error(
      `[store-lifecycle] failed to push status '${status}' for store '${slug}':`,
      error
    );
    await notifyFounder(
      `⚠️ What-Aisle: failed to push status '${status}' to Stores App for '${slug}'. Manual sync needed.`
    );
  }
}

async function findStoreBySubscriptionId(subscriptionId: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(stores)
    .where(eq(stores.subscriptionId, subscriptionId))
    .limit(1);
  return rows[0] ?? null;
}

/** Extract the subscription id from an invoice across Stripe API shapes */
function extractInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const inv = invoice as any;
  if (typeof inv.subscription === 'string') return inv.subscription;
  if (inv.subscription?.id) return inv.subscription.id;
  if (typeof inv.parent?.subscription_details?.subscription === 'string') {
    return inv.parent.subscription_details.subscription;
  }
  for (const line of invoice.lines?.data ?? []) {
    const l = line as any;
    if (typeof l.subscription === 'string') return l.subscription;
    if (l.subscription?.id) return l.subscription.id;
    if (typeof l.parent?.subscription_item_details?.subscription === 'string') {
      return l.parent.subscription_item_details.subscription;
    }
  }
  return null;
}

/** Context handed from the DB transition to the out-of-band side effects */
interface StoreProvisioningContext {
  session: Stripe.Checkout.Session;
  slug: string;
  storeName: string;
  storeUserId: string | undefined;
  locale: Locale;
  customerId: string | null;
  subscriptionId: string | null;
}

/**
 * checkout.session.completed with metadata.storeSlug:
 * pending_payment → awaiting_video, record Stripe ids, then provision
 * the store in the Stores App and email the video-shooting
 * instructions OUT-OF-BAND.
 *
 * The DB transition rethrows on failure so the webhook route returns
 * 5xx and Stripe redelivers (every sub-step is idempotent, replay is
 * safe). The slow side effects run in a fire-and-forget promise so the
 * webhook responds fast and never waits on the Stores App.
 */
export async function onStoreCheckoutCompleted(
  session: Stripe.Checkout.Session
): Promise<void> {
  const slug = session.metadata?.storeSlug;
  if (!slug) return; // not a store checkout

  let context: StoreProvisioningContext | null;
  try {
    context = await transitionStoreCheckoutCompleted(session, slug);
  } catch (error) {
    console.error(
      `[store-lifecycle] onStoreCheckoutCompleted DB transition failed for '${slug}':`,
      error
    );
    await notifyFounder(
      `🚨 What-Aisle: DB transition failed for paid checkout '${slug}' (session ${session.id}). Webhook will 5xx so Stripe redelivers.`
    );
    // Rethrow: the webhook must NOT ack 200, otherwise Stripe never
    // retries and the paid customer gets no store and no signal.
    throw error;
  }
  if (!context) return; // replay / mismatch — already logged & alerted

  console.log(
    `[store-lifecycle] store '${slug}' → awaiting_video (session ${session.id})`
  );

  // Post-transition side effects: fire-and-forget (long-running Node
  // server, the un-awaited promise survives the webhook response).
  void runStoreProvisioningSideEffects(context).catch(async (error) => {
    console.error(
      `[store-lifecycle] provisioning side effects failed for '${slug}':`,
      error
    );
    await notifyFounder(
      `🚨 What-Aisle: post-payment side effects failed for '${slug}' (session ${session.id}). Check Stores App provisioning + instruction email manually.`
    );
  });
}

/**
 * The idempotent DB part of checkout.session.completed.
 * Returns the provisioning context when this event actually moved the
 * row forward, null when there is nothing (more) to do.
 * THROWS on DB failure — the caller escalates to a webhook 5xx.
 */
async function transitionStoreCheckoutCompleted(
  session: Stripe.Checkout.Session,
  slug: string
): Promise<StoreProvisioningContext | null> {
  const storeName = session.metadata?.storeName || slug;
  const userId = session.metadata?.userId;
  const locale = (session.metadata?.locale || 'en') as Locale;
  const customerId =
    typeof session.customer === 'string'
      ? session.customer
      : (session.customer?.id ?? null);
  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : (session.subscription?.id ?? null);
  // First invoice of the subscription carries the $688 setup fee
  const setupInvoiceId =
    typeof session.invoice === 'string'
      ? session.invoice
      : (session.invoice?.id ?? null);

  const db = await getDb();
  const now = new Date();

  // Idempotent transition: only a pending_payment row locked by THIS
  // checkout session moves forward (null covers rows created before
  // the session-correlation column existed).
  const transitioned = await db
    .update(stores)
    .set({
      status: STORE_STATUS.AWAITING_VIDEO,
      stripeCustomerId: customerId,
      subscriptionId,
      setupPaymentId: setupInvoiceId,
      updatedAt: now,
    })
    .where(
      and(
        eq(stores.slug, slug),
        eq(stores.status, STORE_STATUS.PENDING_PAYMENT),
        or(
          eq(stores.checkoutSessionId, session.id),
          isNull(stores.checkoutSessionId)
        )
      )
    )
    .returning({ id: stores.id, userId: stores.userId });

  let storeUserId: string | undefined = transitioned[0]?.userId;

  if (transitioned.length === 0) {
    const existing = await db
      .select({
        id: stores.id,
        status: stores.status,
        checkoutSessionId: stores.checkoutSessionId,
      })
      .from(stores)
      .where(eq(stores.slug, slug))
      .limit(1);

    if (existing.length > 0) {
      const row = existing[0];

      if (row.status === STORE_STATUS.PENDING_PAYMENT) {
        // The row is locked by a DIFFERENT (newer) checkout session:
        // this payment belongs to a superseded session. Do NOT
        // provision — manual refund path (PRD 8.4).
        console.error(
          `[store-lifecycle] session mismatch for '${slug}': paid session ${session.id} != row session ${row.checkoutSessionId}`
        );
        await notifyFounder(
          `🚨 What-Aisle: payment received for '${slug}' via superseded checkout session ${session.id}, but the row is locked by session ${row.checkoutSessionId}. NOT provisioning — manual refund needed (PRD 8.4).`
        );
        return null;
      }

      // Row already moved past pending_payment → event replay, nothing to do.
      console.log(
        `[store-lifecycle] store '${slug}' already provisioned (status: ${row.status}), skipping`
      );
      return null;
    }

    // Edge case: the pending row was released (24h expiry) before the
    // payment landed. Recreate it so the paying customer gets their store.
    if (!userId) {
      console.error(
        `[store-lifecycle] no store row and no userId in metadata for slug '${slug}'`
      );
      await notifyFounder(
        `⚠️ What-Aisle: payment received for '${slug}' but no store row and no userId in metadata. Manual fix needed. Session: ${session.id}`
      );
      return null;
    }
    await db.insert(stores).values({
      id: randomUUID(),
      userId,
      slug,
      name: storeName,
      status: STORE_STATUS.AWAITING_VIDEO,
      stripeCustomerId: customerId,
      subscriptionId,
      setupPaymentId: setupInvoiceId,
      checkoutSessionId: session.id,
      createdAt: now,
      updatedAt: now,
    });
    storeUserId = userId;
  }

  return {
    session,
    slug,
    storeName,
    storeUserId: storeUserId ?? userId,
    locale,
    customerId,
    subscriptionId,
  };
}

/**
 * Slow, non-transactional side effects of a completed store checkout.
 * Runs out-of-band (fire-and-forget) — the Stores App retries (3×10s)
 * and the email must never delay the Stripe webhook response.
 */
async function runStoreProvisioningSideEffects(
  context: StoreProvisioningContext
): Promise<void> {
  const { session, slug, storeName, storeUserId, locale } = context;

  // Provision the store in the Stores App (client retries 3x internally)
  try {
    await createStore({
      slug,
      name: storeName,
      portalUserId: storeUserId ?? '',
      stripeCustomerId: context.customerId,
      subscriptionId: context.subscriptionId,
    });
  } catch (error) {
    console.error(`[store-lifecycle] createStore failed for '${slug}':`, error);
    await notifyFounder(
      `🚨 What-Aisle: payment received for '${slug}' but Stores App provisioning FAILED after retries. Create it manually.`
    );
  }

  // Send the "upload your store video" instruction email
  try {
    const email = await resolveCustomerEmail(session, storeUserId);
    if (email) {
      const dashboardUrl = getUrlWithLocale(Routes.Dashboard, locale);
      const result = await sendEmail({
        to: email,
        template: 'storeVideoInstructions',
        context: { storeName, slug, dashboardUrl },
        locale,
      });
      if (!result.success) {
        console.error(
          `[store-lifecycle] instruction email failed for '${slug}':`,
          result.error
        );
      }
    } else {
      console.error(
        `[store-lifecycle] no email found for store '${slug}' owner`
      );
    }
  } catch (error) {
    console.error(
      `[store-lifecycle] instruction email error for '${slug}':`,
      error
    );
  }

  // Heads-up for the founder: a new store was sold
  await notifyFounder(
    `🎉 What-Aisle: new store paid! '${storeName}' → https://${slug}.what-aisle.com (awaiting video)`
  );
}

async function resolveCustomerEmail(
  session: Stripe.Checkout.Session,
  userId?: string
): Promise<string | null> {
  if (session.customer_details?.email) return session.customer_details.email;
  if (!userId) return null;
  const db = await getDb();
  const rows = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return rows[0]?.email ?? null;
}

/**
 * checkout.session.expired: release the pending_payment row so the
 * slug can be claimed again — but ONLY when the row is still locked by
 * the session that expired. An OLD session's expiry must not delete
 * the NEW owner's lock (they carry the same slug in metadata).
 */
export async function onStoreCheckoutExpired(
  session: Stripe.Checkout.Session
): Promise<void> {
  const slug = session.metadata?.storeSlug;
  if (!slug) return;

  try {
    const db = await getDb();
    const deleted = await db
      .delete(stores)
      .where(
        and(
          eq(stores.slug, slug),
          eq(stores.status, STORE_STATUS.PENDING_PAYMENT),
          eq(stores.checkoutSessionId, session.id)
        )
      )
      .returning({ id: stores.id });
    if (deleted.length > 0) {
      console.log(
        `[store-lifecycle] released pending slug '${slug}' (checkout expired)`
      );
    }
  } catch (error) {
    console.error(
      `[store-lifecycle] onStoreCheckoutExpired error for '${slug}':`,
      error
    );
  }
}

/**
 * invoice.payment_failed: start (or continue) the 7-day dunning timer.
 * After 7 days past the first failure → suspended + push + alert founder.
 * (P0 = timer + suspension + founder alert; dunning emails are P1.)
 */
export async function onStoreInvoicePaymentFailed(
  invoice: Stripe.Invoice
): Promise<void> {
  try {
    const subscriptionId = extractInvoiceSubscriptionId(invoice);
    if (!subscriptionId) return;

    const store = await findStoreBySubscriptionId(subscriptionId);
    if (!store) return; // not a store subscription

    const db = await getDb();
    const now = new Date();

    if (!store.paymentFailedAt) {
      await db
        .update(stores)
        .set({ paymentFailedAt: now, updatedAt: now })
        .where(and(eq(stores.id, store.id), isNull(stores.paymentFailedAt)));
      console.log(
        `[store-lifecycle] store '${store.slug}' first payment failure recorded`
      );
      await notifyFounder(
        `⚠️ What-Aisle: payment failed for store '${store.slug}'. 7-day grace period started.`
      );
      return;
    }

    const graceExpired =
      now.getTime() - store.paymentFailedAt.getTime() > PAYMENT_FAILED_GRACE_MS;
    if (graceExpired && store.status === STORE_STATUS.LIVE) {
      const updated = await db
        .update(stores)
        .set({
          status: STORE_STATUS.SUSPENDED,
          suspensionReason: SUSPENSION_REASON.DUNNING,
          suspendedAt: now,
          updatedAt: now,
        })
        .where(
          and(eq(stores.id, store.id), eq(stores.status, STORE_STATUS.LIVE))
        )
        .returning({ id: stores.id });
      if (updated.length > 0) {
        console.log(
          `[store-lifecycle] store '${store.slug}' suspended (payment failed > 7 days)`
        );
        // Fire-and-forget: never make the Stripe webhook wait on the
        // Stores App (pushStatusToStoresApp never rejects).
        void pushStatusToStoresApp(store.slug, STORE_STATUS.SUSPENDED);
        await notifyFounder(
          `🛑 What-Aisle: store '${store.slug}' SUSPENDED after 7 days of failed payments.`
        );
      }
    }
  } catch (error) {
    console.error(
      '[store-lifecycle] onStoreInvoicePaymentFailed error:',
      error
    );
  }
}

/**
 * invoice.paid: clear the dunning timer; if the store was suspended
 * FOR DUNNING, bring it back to live and push to the Stores App.
 *
 * Only suspensionReason === 'dunning' auto-restores: an out-of-order
 * final invoice.paid must not resurrect a sub-deleted store, and
 * founder manual suspensions must never be reversed by billing events.
 * Before restoring we also verify the subscription is still alive at
 * Stripe (active/trialing/past_due).
 */
export async function onStoreInvoicePaid(
  invoice: Stripe.Invoice
): Promise<void> {
  try {
    const subscriptionId = extractInvoiceSubscriptionId(invoice);
    if (!subscriptionId) return;

    const store = await findStoreBySubscriptionId(subscriptionId);
    if (!store) return;

    const db = await getDb();
    const now = new Date();

    if (store.paymentFailedAt) {
      await db
        .update(stores)
        .set({ paymentFailedAt: null, updatedAt: now })
        .where(eq(stores.id, store.id));
    }

    if (store.status === STORE_STATUS.SUSPENDED) {
      if (store.suspensionReason !== SUSPENSION_REASON.DUNNING) {
        console.log(
          `[store-lifecycle] store '${store.slug}' suspended for '${store.suspensionReason ?? 'unknown'}', not auto-restoring on invoice.paid`
        );
        return;
      }

      // Verify the subscription is still alive before restoring — an
      // out-of-order final invoice.paid can arrive after deletion.
      try {
        const subscription =
          await getStripeClient().subscriptions.retrieve(subscriptionId);
        if (!ALIVE_SUBSCRIPTION_STATUSES.includes(subscription.status)) {
          console.log(
            `[store-lifecycle] store '${store.slug}' subscription is '${subscription.status}', not auto-restoring on invoice.paid`
          );
          return;
        }
      } catch (error) {
        console.error(
          `[store-lifecycle] failed to verify subscription '${subscriptionId}' for store '${store.slug}', not restoring:`,
          error
        );
        return;
      }

      const updated = await db
        .update(stores)
        .set({
          status: STORE_STATUS.LIVE,
          suspensionReason: null,
          suspendedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(stores.id, store.id),
            eq(stores.status, STORE_STATUS.SUSPENDED),
            eq(stores.suspensionReason, SUSPENSION_REASON.DUNNING)
          )
        )
        .returning({ id: stores.id });
      if (updated.length > 0) {
        console.log(
          `[store-lifecycle] store '${store.slug}' restored to live (invoice paid)`
        );
        // Fire-and-forget: never make the Stripe webhook wait on the
        // Stores App (pushStatusToStoresApp never rejects).
        void pushStatusToStoresApp(store.slug, STORE_STATUS.LIVE);
        await notifyFounder(
          `✅ What-Aisle: store '${store.slug}' payment recovered, back to live.`
        );
      }
    }
  } catch (error) {
    console.error('[store-lifecycle] onStoreInvoicePaid error:', error);
  }
}

/**
 * customer.subscription.deleted: suspend immediately (data kept 90 days,
 * PRD 3.2). Terminal cleanup is a P1 cron.
 */
export async function onStoreSubscriptionDeleted(
  subscription: Stripe.Subscription
): Promise<void> {
  try {
    const store = await findStoreBySubscriptionId(subscription.id);
    if (!store) return;
    if (
      store.status === STORE_STATUS.SUSPENDED ||
      store.status === STORE_STATUS.CANCELED
    ) {
      return; // already there — event replay
    }

    const db = await getDb();
    const now = new Date();
    const updated = await db
      .update(stores)
      .set({
        status: STORE_STATUS.SUSPENDED,
        suspensionReason: SUSPENSION_REASON.SUB_DELETED,
        suspendedAt: now,
        updatedAt: now,
      })
      .where(and(eq(stores.id, store.id), eq(stores.status, store.status)))
      .returning({ id: stores.id });
    if (updated.length > 0) {
      console.log(
        `[store-lifecycle] store '${store.slug}' suspended (subscription deleted)`
      );
      // Fire-and-forget: never make the Stripe webhook wait on the
      // Stores App (pushStatusToStoresApp never rejects).
      void pushStatusToStoresApp(store.slug, STORE_STATUS.SUSPENDED);
      await notifyFounder(
        `🛑 What-Aisle: subscription canceled for store '${store.slug}', suspended.`
      );
    }
  } catch (error) {
    console.error('[store-lifecycle] onStoreSubscriptionDeleted error:', error);
  }
}

/**
 * charge.refunded (full refund) → canceled (terminal state, PRD 8.4).
 *
 * The store is resolved via the charge's INVOICE (invoice →
 * subscription id → stores.subscriptionId, falling back to invoice id
 * === stores.setupPaymentId), never by "first store of the customer" —
 * one customer can own several stores. The stripeCustomerId fallback
 * only applies when that customer has EXACTLY ONE non-canceled store.
 */
export async function onStoreChargeRefunded(
  charge: Stripe.Charge
): Promise<void> {
  try {
    if (!charge.refunded) return; // only fully-refunded charges cancel a store

    const db = await getDb();
    const chargeAny = charge as any;
    const invoiceId: string | null =
      typeof chargeAny.invoice === 'string'
        ? chargeAny.invoice
        : (chargeAny.invoice?.id ?? null);

    let store: typeof stores.$inferSelect | null = null;

    // 1) Resolve via the charge's invoice → subscription id
    if (invoiceId) {
      try {
        const invoice = await getStripeClient().invoices.retrieve(invoiceId);
        const subscriptionId = extractInvoiceSubscriptionId(invoice);
        if (subscriptionId) {
          store = await findStoreBySubscriptionId(subscriptionId);
        }
      } catch (error) {
        console.error(
          `[store-lifecycle] failed to retrieve invoice '${invoiceId}' for refunded charge '${charge.id}':`,
          error
        );
      }

      // 2) Fallback: the invoice is the setup-fee invoice we recorded
      if (!store) {
        const bySetup = await db
          .select()
          .from(stores)
          .where(eq(stores.setupPaymentId, invoiceId))
          .limit(1);
        store = bySetup[0] ?? null;
      }
    }

    // 3) Last resort: by customer, but ONLY when that customer has
    //    exactly one non-canceled store — otherwise we cannot know
    //    which store the refund belongs to.
    if (!store) {
      const customerId =
        typeof charge.customer === 'string'
          ? charge.customer
          : (charge.customer?.id ?? null);
      if (!customerId) return;

      const rows = await db
        .select()
        .from(stores)
        .where(
          and(
            eq(stores.stripeCustomerId, customerId),
            ne(stores.status, STORE_STATUS.CANCELED)
          )
        )
        .limit(2);
      if (rows.length === 0) return; // not a store customer
      if (rows.length > 1) {
        await notifyFounder(
          `⚠️ What-Aisle: refunded charge '${charge.id}' (invoice: ${invoiceId ?? 'none'}) could not be matched to a single store — customer ${customerId} has multiple non-canceled stores. NOT canceling anything, manual review needed.`
        );
        return;
      }
      store = rows[0];
    }

    if (store.status === STORE_STATUS.CANCELED) return; // replay — already terminal

    const now = new Date();
    const updated = await db
      .update(stores)
      .set({
        status: STORE_STATUS.CANCELED,
        canceledAt: now,
        updatedAt: now,
      })
      .where(
        and(eq(stores.id, store.id), ne(stores.status, STORE_STATUS.CANCELED))
      )
      .returning({ id: stores.id });
    if (updated.length > 0) {
      console.log(
        `[store-lifecycle] store '${store.slug}' canceled (charge refunded)`
      );
      // Fire-and-forget: never make the Stripe webhook wait on the
      // Stores App (pushStatusToStoresApp never rejects).
      void pushStatusToStoresApp(store.slug, STORE_STATUS.CANCELED);
      await notifyFounder(
        `↩️ What-Aisle: refund issued, store '${store.slug}' canceled.`
      );
    }
  } catch (error) {
    console.error('[store-lifecycle] onStoreChargeRefunded error:', error);
  }
}
