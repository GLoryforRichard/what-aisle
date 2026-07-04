import { boolean, integer, pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { user } from "./auth.schema";
import type { PaymentScene, PaymentStatus, PaymentType, PlanInterval } from "@/payment/types";
import type { StoreStatus, SuspensionReason } from "@/lib/store-status";

export const payment = pgTable("payment", {
	id: text("id").primaryKey(),
	priceId: text('price_id').notNull(),
	type: text('type').notNull().$type<PaymentType>(),
	scene: text('scene').$type<PaymentScene>(), // payment scene: 'lifetime', 'credit', 'subscription'
	interval: text('interval').$type<PlanInterval>(),
	userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
	customerId: text('customer_id').notNull(),
	subscriptionId: text('subscription_id'),
	sessionId: text('session_id'),
	invoiceId: text('invoice_id').unique(), // unique constraint for avoiding duplicate processing
	status: text('status').notNull().$type<PaymentStatus>(),
	paid: boolean('paid').notNull().default(false), // indicates whether payment is completed (set in invoice.paid event)
	periodStart: timestamp('period_start'),
	periodEnd: timestamp('period_end'),
	cancelAtPeriodEnd: boolean('cancel_at_period_end'),
	trialStart: timestamp('trial_start'),
	trialEnd: timestamp('trial_end'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
	paymentTypeIdx: index("payment_type_idx").on(table.type),
	paymentSceneIdx: index("payment_scene_idx").on(table.scene),
	paymentPriceIdIdx: index("payment_price_id_idx").on(table.priceId),
	paymentUserIdIdx: index("payment_user_id_idx").on(table.userId),
	paymentCustomerIdIdx: index("payment_customer_id_idx").on(table.customerId),
	paymentStatusIdx: index("payment_status_idx").on(table.status),
	paymentPaidIdx: index("payment_paid_idx").on(table.paid),
	paymentSubscriptionIdIdx: index("payment_subscription_id_idx").on(table.subscriptionId),
	paymentSessionIdIdx: index("payment_session_id_idx").on(table.sessionId),
	paymentInvoiceIdIdx: index("payment_invoice_id_idx").on(table.invoiceId),
}));

/**
 * What-Aisle stores (PRD 3.2 / F-3 / F-4)
 *
 * The portal (Postgres) is the source of truth for billing-driven store
 * status. A row is inserted with status 'pending_payment' when checkout
 * starts — the unique constraint on slug is the race guard against
 * concurrent claims of the same subdomain.
 */
export const stores = pgTable("stores", {
	id: text("id").primaryKey(),
	userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
	slug: text('slug').notNull().unique(), // subdomain: {slug}.whataisle.com, immutable once live
	name: text('name').notNull(), // display name of the supermarket
	status: text('status').notNull().default('pending_payment').$type<StoreStatus>(),
	stripeCustomerId: text('stripe_customer_id'),
	subscriptionId: text('subscription_id'), // Stripe subscription ($99/mo)
	setupPaymentId: text('setup_payment_id'), // Stripe invoice covering the $688 setup fee (first invoice of the subscription)
	checkoutSessionId: text('checkout_session_id'), // Stripe Checkout session currently allowed to provision this row; superseded sessions are expired and must not provision
	suspensionReason: text('suspension_reason').$type<SuspensionReason>(), // why the store is suspended: 'dunning' | 'sub_deleted' | 'manual'; only 'dunning' may be auto-restored by invoice.paid
	videoR2Key: text('video_r2_key'), // R2 object key of the uploaded layout video (task #6)
	videoExternalUrl: text('video_external_url'), // escape hatch: external drive link instead of upload (task #6)
	paymentFailedAt: timestamp('payment_failed_at'), // first invoice.payment_failed timestamp; suspended after 7 days
	liveAt: timestamp('live_at'),
	suspendedAt: timestamp('suspended_at'),
	canceledAt: timestamp('canceled_at'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
	storesUserIdIdx: index("stores_user_id_idx").on(table.userId),
	storesStatusIdx: index("stores_status_idx").on(table.status),
	storesSubscriptionIdIdx: index("stores_subscription_id_idx").on(table.subscriptionId),
	storesStripeCustomerIdIdx: index("stores_stripe_customer_id_idx").on(table.stripeCustomerId),
}));

export const userCredit = pgTable("user_credit", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: 'cascade' }),
	currentCredits: integer("current_credits").notNull().default(0),
	lastRefreshAt: timestamp("last_refresh_at"), // deprecated
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
	userCreditUserIdIdx: index("user_credit_user_id_idx").on(table.userId),
}));

export const creditTransaction = pgTable("credit_transaction", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: 'cascade' }),
	type: text("type").notNull(),
	description: text("description"),
	amount: integer("amount").notNull(),
	remainingAmount: integer("remaining_amount"),
	paymentId: text("payment_id"), // field name is paymentId, but actually it's invoiceId
	expirationDate: timestamp("expiration_date"),
	expirationDateProcessedAt: timestamp("expiration_date_processed_at"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
	creditTransactionUserIdIdx: index("credit_transaction_user_id_idx").on(table.userId),
	creditTransactionTypeIdx: index("credit_transaction_type_idx").on(table.type),
}));
