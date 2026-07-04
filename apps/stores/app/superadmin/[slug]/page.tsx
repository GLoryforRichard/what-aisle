/**
 * Superadmin store detail (PRD F-12): taxonomy editor, floorplan editor,
 * passcode reset, readonly status + billing. Server component — auth gate
 * at the top of the page (layouts render in parallel, they can't gate data).
 */

import { notFound } from 'next/navigation';
import { hasSuperSession } from '@/lib/superadmin-session';
import { getDb } from '@/lib/mongodb';
import { validateSlug } from '@/lib/slug';
import { Store, STORES_COLLECTION } from '@/lib/types';
import SuperLogin from '../login-form';
import StoreDetailClient, { StoreDetailDto } from './store-detail-client';

export const dynamic = 'force-dynamic';

function iso(d: Date | undefined | null): string | null {
  return d ? new Date(d).toISOString() : null;
}

export default async function SuperadminStorePage(
  { params }: { params: Promise<{ slug: string }> }
) {
  if (!(await hasSuperSession())) return <SuperLogin />;

  const { slug: raw } = await params;
  const v = validateSlug(raw ?? '');
  if (!v.ok) notFound();

  const db = await getDb();
  const store = await db.collection<Store>(STORES_COLLECTION).findOne({ slug: v.slug });
  if (!store) notFound();

  // DTO: plain JSON, and NEVER ship the bcrypt hash to the client.
  const video = (store.video ?? {}) as { r2Key?: string; url?: string; uploadedAt?: Date };
  const dto: StoreDetailDto = {
    slug: store.slug,
    name: store.name,
    status: store.status,
    displayName: store.branding?.displayName || store.name,
    defaultLocale: store.branding?.defaultLocale ?? 'en',
    shelves: store.shelves ?? [],
    floorplan: store.floorplan ?? { viewBox: { w: 100, h: 100 }, rects: [], labels: [] },
    billing: {
      portalUserId: store.billing?.portalUserId ?? null,
      stripeCustomerId: store.billing?.stripeCustomerId ?? null,
      subscriptionId: store.billing?.subscriptionId ?? null,
      setupPaidAt: iso(store.billing?.setupPaidAt),
    },
    video: {
      r2Key: video.r2Key ?? null,
      url: video.url && /^https?:\/\//.test(video.url) ? video.url : null,
      uploadedAt: iso(video.uploadedAt),
    },
    createdAt: iso(store.created_at),
    updatedAt: iso(store.updated_at),
    passcodeUpdatedAt: iso(store.admin?.passcodeUpdatedAt),
  };

  return <StoreDetailClient store={dto} />;
}
