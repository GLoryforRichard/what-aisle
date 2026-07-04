import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireStore } from '@/lib/store-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ActivityItem {
  type: 'snap' | 'find';
  title: string;
  subtitle?: string;
  timestamp: string;
}

export async function GET(req: NextRequest) {
  const gate = await requireStore(req);
  if (!gate.ok) return gate.response;
  const storeId = gate.store.slug;
  try {
    const db = await getDb();
    // Searches read from `search_history` (the deterministic per-search log)
    // — the legacy `search_logs` collection is no longer consulted.
    const [snaps, finds] = await Promise.all([
      db.collection('shelf_evidence')
        .find({ store_id: storeId })
        .sort({ timestamp: -1 })
        .limit(20)
        .toArray(),
      db.collection('search_history')
        .find({ store_id: storeId })
        .sort({ ts: -1 })
        .limit(20)
        .toArray(),
    ]);

    const items: ActivityItem[] = [];

    for (const s of snaps) {
      items.push({
        type: 'snap',
        title: `Snapped ${s.aisle}`,
        subtitle: `${(s.products_detected || []).length} products`,
        timestamp: new Date(s.timestamp).toISOString(),
      });
    }

    for (const f of finds) {
      items.push({
        type: 'find',
        title: f.found
          ? `Found "${f.query}"`
          : `No result for "${f.query}"`,
        subtitle: (f.product as string | null) || undefined,
        timestamp: new Date(f.ts).toISOString(),
      });
    }

    items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return NextResponse.json({ ok: true, items: items.slice(0, 30) });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
