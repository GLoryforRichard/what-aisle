import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireStore } from '@/lib/store-context';
import { requireStoreAdmin } from '@/lib/admin-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Raw DB inspector for the CURRENT store only — every read is tenant-scoped.
 *  (Searches come from `search_history`; legacy `search_logs` is retired.) */
export async function GET(req: NextRequest) {
  const gate = await requireStore(req, { audience: 'staff' });
  if (!gate.ok) return gate.response;
  const admin = requireStoreAdmin(req, gate.store);
  if (!admin.ok) return admin.response;
  const storeId = gate.store.slug;
  try {
    const db = await getDb();

    const [shelfEvidence, products, searchHistory, counts] = await Promise.all([
      db.collection('shelf_evidence').find({ store_id: storeId }).sort({ timestamp: -1 }).limit(50).toArray(),
      db.collection('products').find({ store_id: storeId }).sort({ updated_at: -1 }).limit(200).toArray(),
      db.collection('search_history').find({ store_id: storeId }).sort({ ts: -1 }).limit(50).toArray(),
      Promise.all([
        db.collection('shelf_evidence').countDocuments({ store_id: storeId }),
        db.collection('products').countDocuments({ store_id: storeId }),
        db.collection('search_history').countDocuments({ store_id: storeId }),
      ]),
    ]);

    return NextResponse.json({
      ok: true,
      store: storeId,
      counts: {
        shelf_evidence: counts[0],
        products: counts[1],
        search_history: counts[2],
      },
      shelf_evidence: shelfEvidence,
      products,
      search_history: searchHistory,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
