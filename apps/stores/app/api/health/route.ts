import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * Liveness probe. Intentionally GLOBAL (works on any host, no tenant needed)
 * but returns only aggregate totals — never any per-store data or store list.
 */
export async function GET() {
  try {
    const db = await getDb();

    const counts: Record<string, number> = {};
    for (const name of ['stores', 'products', 'shelf_evidence', 'search_history']) {
      counts[name] = await db.collection(name).countDocuments();
    }

    return NextResponse.json({
      ok: true,
      db: db.databaseName,
      counts,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
