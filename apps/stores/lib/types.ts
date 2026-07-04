import { ObjectId } from 'mongodb';
import type { ShelfLocation, Floorplan } from './shelves';

export interface ShelfEvidence {
  _id?: ObjectId;
  /** Tenant id — the store slug. Every document is scoped to one store. */
  store_id: string;
  photo_url: string;
  aisle: string;
  products_detected: string[];
  raw_ocr_text?: string;
  timestamp: Date;
}

export interface Product {
  _id?: ObjectId;
  /** Tenant id — the store slug. Unique index is {store_id, canonical_name}. */
  store_id: string;
  canonical_name: string;
  aliases: string[];
  search_text: string;
  category?: string;
  latest_aisle: string;
  evidence_count: number;
  created_at: Date;
  updated_at: Date;
}

/** @deprecated legacy `search_logs` shape — new reads/writes use `search_history` (lib/ops.ts). */
export interface SearchLog {
  _id?: ObjectId;
  store_id?: string;
  query: string;
  resolved_intent?: string;
  results_found: number;
  no_result_terms?: string[];
  timestamp: Date;
}

// ─────────────────────────────────────────────────────────────
// Stores collection (multi-tenant core, PRD F-8)
// ─────────────────────────────────────────────────────────────

export const STORES_COLLECTION = 'stores';

/** Store lifecycle — see PRD §3.2 状态机. */
export type StoreStatus =
  | 'pending_payment'
  | 'awaiting_video'
  | 'building'
  | 'live'
  | 'suspended'
  | 'canceled';

export interface StoreBranding {
  /** Name rendered in the header wordmark + <title>. */
  displayName: string;
  logoUrl?: string;
  themeColor?: string;
  defaultLocale: 'en' | 'zh';
}

export interface StoreAdminAuth {
  /** bcrypt hash of the per-store staff passcode. Empty until task #3 lands. */
  passcodeHash: string;
  passcodeUpdatedAt: Date;
}

export interface StoreBilling {
  /** Better-Auth user id in the portal's Postgres. */
  portalUserId?: string;
  stripeCustomerId?: string;
  subscriptionId?: string;
  setupPaidAt?: Date;
}

export interface StoreVideo {
  /** R2 object key of the store-layout walkthrough video. */
  r2Key?: string;
  uploadedAt?: Date;
}

export interface Store {
  _id?: ObjectId;
  /** Subdomain + tenant id. Unique, immutable after creation. */
  slug: string;
  name: string;
  name_zh?: string;
  status: StoreStatus;
  branding: StoreBranding;
  admin: StoreAdminAuth;
  shelves: ShelfLocation[];
  floorplan: Floorplan;
  billing: StoreBilling;
  video: StoreVideo;
  created_at: Date;
  updated_at: Date;
}
