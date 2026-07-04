import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * Liveness probe. Intentionally GLOBAL (works on any host, no tenant needed)
 * and intentionally content-free: it reports only whether the app can reach
 * the database — no counts, no names, nothing cross-tenant.
 */
export async function GET() {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    return NextResponse.json({ ok: true, db: 'up' });
  } catch {
    return NextResponse.json({ ok: false, db: 'down' }, { status: 503 });
  }
}
