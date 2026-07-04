/**
 * Store lifecycle statuses (PRD 3.2 state machine)
 *
 * pending_payment ──(checkout.session.completed)──▶ awaiting_video
 * awaiting_video ──(video uploaded)──▶ building
 * building ──(founder clicks Go Live)──▶ live
 * live ──(payment failed > 7 days / subscription deleted / manual)──▶ suspended
 * suspended ──(invoice.paid)──▶ live
 * any ──(charge.refunded / manual cancel)──▶ canceled (terminal)
 */
export const STORE_STATUS = {
  PENDING_PAYMENT: 'pending_payment',
  AWAITING_VIDEO: 'awaiting_video',
  BUILDING: 'building',
  LIVE: 'live',
  SUSPENDED: 'suspended',
  CANCELED: 'canceled',
} as const;

export type StoreStatus = (typeof STORE_STATUS)[keyof typeof STORE_STATUS];

export const STORE_STATUSES: StoreStatus[] = Object.values(STORE_STATUS);

/**
 * How long a pending_payment row locks its slug before it is
 * considered stale and can be released (PRD 3.2).
 */
export const PENDING_PAYMENT_TTL_MS = 24 * 60 * 60 * 1000;
