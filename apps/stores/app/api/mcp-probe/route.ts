import { NextRequest, NextResponse } from 'next/server';
import { mcpAggregate } from '@/lib/mcp/mongo-ops';
import { requireStore } from '@/lib/store-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Diagnostic route, but it returns product docs → tenant-scoped like the rest.
  const gate = await requireStore(req);
  if (!gate.ok) return gate.response;
  process.env.MCP_DEBUG = '1';
  try {
    const result = await mcpAggregate({
      collection: 'products',
      pipeline: [
        {
          $vectorSearch: {
            index: 'vector_index',
            path: 'search_text',
            query: '年糕',
            numCandidates: 50,
            limit: 3,
            filter: { store_id: gate.store.slug },
          },
        },
        {
          $project: {
            _id: { $toString: '$_id' },
            canonical_name: 1,
            latest_aisle: 1,
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ],
    });
    return NextResponse.json({ ok: true, count: result.data.length, via: result.via, results: result.data });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
