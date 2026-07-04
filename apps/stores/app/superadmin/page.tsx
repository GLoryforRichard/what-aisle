/**
 * Superadmin store list (PRD F-12) — server component.
 *
 * Auth: hasSuperSession() at the top of the PAGE (not just a layout — App
 * Router renders pages and layouts in parallel, so page-level data must be
 * gated here). Unauthenticated → token entry form.
 */

import { hasSuperSession } from '@/lib/superadmin-session';
import { getDb } from '@/lib/mongodb';
import { Store, STORES_COLLECTION } from '@/lib/types';
import SuperLogin from './login-form';
import StoreListClient, { StoreRow } from './store-list-client';

export const dynamic = 'force-dynamic';

/** R2 walkthrough video → clickable URL when we can build one. */
function videoUrl(video: Store['video'] | undefined): string | null {
  const v = (video ?? {}) as { r2Key?: string; url?: string };
  if (v.url && /^https?:\/\//.test(v.url)) return v.url;
  if (v.r2Key) {
    if (/^https?:\/\//.test(v.r2Key)) return v.r2Key;
    const base = process.env.R2_PUBLIC_BASE_URL?.trim();
    if (base) return `${base.replace(/\/+$/, '')}/${v.r2Key}`;
  }
  return null;
}

export default async function SuperadminPage() {
  if (!(await hasSuperSession())) return <SuperLogin />;

  const db = await getDb();
  const [stores, productCounts] = await Promise.all([
    db.collection<Store>(STORES_COLLECTION)
      .find({}, {
        projection: {
          slug: 1, name: 1, status: 1, 'branding.displayName': 1,
          video: 1, updated_at: 1, created_at: 1,
        },
      })
      .sort({ created_at: -1 })
      .toArray(),
    db.collection('products')
      .aggregate<{ _id: string; count: number }>([
        { $group: { _id: '$store_id', count: { $sum: 1 } } },
      ])
      .toArray(),
  ]);

  const counts = new Map(productCounts.map(c => [c._id, c.count]));
  const rows: StoreRow[] = stores.map(s => ({
    slug: s.slug,
    displayName: s.branding?.displayName || s.name,
    status: s.status,
    products: counts.get(s.slug) ?? 0,
    updatedAt: s.updated_at ? new Date(s.updated_at).toISOString() : null,
    videoUrl: videoUrl(s.video),
  }));

  return <StoreListClient rows={rows} />;
}
