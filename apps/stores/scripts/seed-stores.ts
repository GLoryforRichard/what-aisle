/**
 * Seed script for the multi-tenant `whataisle` database (PRD F-8).
 *
 * 1. Ensures every tenant-scoped index:
 *      stores          { slug: 1 }                        unique
 *      products        { store_id: 1, canonical_name: 1 } unique
 *      shelf_evidence  { store_id: 1, timestamp: -1 }
 *      search_history  { store_id: 1, ts: -1 }
 *      op_events       { store_id: 1, ts: -1 }
 * 2. Creates two fake LIVE stores ('store-a', 'store-b') from the founder
 *    template, for the tenant-isolation test checklist (docs/SAAS-SETUP.md).
 *
 * Idempotent: re-running never duplicates stores or clobbers edits
 * (stores are inserted with $setOnInsert only).
 *
 * Run from apps/stores:
 *   npm run seed:stores          (requires MONGODB_URI in .env.local or env)
 */

import fs from 'node:fs';
import path from 'node:path';
import { MongoClient, Db } from 'mongodb';
import { SHELF_TEMPLATE, FLOORPLAN_TEMPLATE } from '../lib/templates/default-store';
import { hashPasscode } from '../lib/admin-session';
import type { Store } from '../lib/types';

/** Staff passcode for BOTH fake stores (dev/test only — never a real store). */
const DEV_PASSCODE = '135790';

// Minimal .env.local loader (no dotenv dependency): only fills vars that are
// not already set in the environment.
function loadEnvLocal(): void {
  const file = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, rawVal] = m;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawVal.replace(/^['"]|['"]$/g, '');
  }
}

async function ensureIndexes(db: Db): Promise<void> {
  console.log('Ensuring indexes…');

  await db.collection('stores').createIndex({ slug: 1 }, { unique: true, name: 'slug_unique' });

  // Products: the tenant-scoped unique key. If a legacy single-store unique
  // index on canonical_name alone exists (from a wherebear import), it must
  // go first — it would block two stores stocking the same SKU.
  try {
    await db.collection('products').dropIndex('canonical_name_1');
    console.log('  dropped legacy products index canonical_name_1');
  } catch {
    /* index absent — the normal case on a fresh cluster */
  }
  await db.collection('products').createIndex(
    { store_id: 1, canonical_name: 1 },
    { unique: true, name: 'store_canonical_unique' }
  );

  await db.collection('shelf_evidence').createIndex(
    { store_id: 1, timestamp: -1 },
    { name: 'store_ts' }
  );
  await db.collection('search_history').createIndex(
    { store_id: 1, ts: -1 },
    { name: 'store_ts' }
  );
  await db.collection('op_events').createIndex(
    { store_id: 1, ts: -1 },
    { name: 'store_ts' }
  );

  console.log('  indexes ok');
}

function fakeStore(slug: string, name: string, nameZh: string, displayName: string): Store {
  const now = new Date();
  return {
    slug,
    name,
    name_zh: nameZh,
    status: 'live',
    branding: {
      displayName,
      defaultLocale: 'en',
    },
    admin: {
      // Dev-only fixed passcode so the isolation checklist can log in to both
      // fake stores. Real stores get a random 6-digit code from the internal
      // provisioning API (POST /api/internal/stores).
      passcodeHash: hashPasscode(DEV_PASSCODE),
      passcodeUpdatedAt: now,
    },
    shelves: SHELF_TEMPLATE,
    floorplan: FLOORPLAN_TEMPLATE,
    billing: {},
    video: {},
    created_at: now,
    updated_at: now,
  };
}

async function seedStores(db: Db): Promise<void> {
  const fakes: Store[] = [
    fakeStore('store-a', 'Store A Test Market', '测试店A', 'Alpha Market'),
    fakeStore('store-b', 'Store B Test Market', '测试店B', 'Bravo Grocery'),
  ];

  for (const store of fakes) {
    const res = await db.collection('stores').updateOne(
      { slug: store.slug },
      { $setOnInsert: store },
      { upsert: true }
    );
    console.log(
      res.upsertedCount
        ? `  created store '${store.slug}' (${store.branding.displayName}) — staff passcode ${DEV_PASSCODE}`
        : `  store '${store.slug}' already exists — untouched`
    );
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'whataisle';
  if (!uri) {
    console.error('✗ MONGODB_URI not set (env or .env.local).');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    console.log(`Connected to db '${dbName}'.`);
    await ensureIndexes(db);
    console.log('Seeding fake stores for isolation testing…');
    await seedStores(db);
    console.log('✓ done');
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error('✗ seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
