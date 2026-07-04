/**
 * Server-boot warm-up. The first search after a (re)start used to pay ~4 s to
 * build the ADK agent, spawn the MongoDB MCP subprocess (twice — ADK toolset +
 * app client), list its tools, and open the Mongo connection pool. Judges'
 * very first search is exactly the one that shouldn't be slow, so do all of it
 * in the background right after boot instead.
 *
 * Fire-and-forget on purpose: `register` must not delay server readiness, and
 * a warm-up failure must never take the app down (everything here also lazy-
 * initializes on first use, exactly as before).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  setTimeout(async () => {
    try {
      const [agentMod, mcpMod, dbMod] = await Promise.all([
        import('@/lib/agents/adk/search-agent'),
        import('@/lib/mcp/mongo-mcp'),
        import('@/lib/mongodb'),
      ]);
      agentMod.getSearchAgent();
      await Promise.allSettled([
        mcpMod.listMongoMcpTools(),
        dbMod.getDb(),
      ]);
      // One throwaway end-to-end search: warms the Vertex connections (app
      // genai client + ADK's internal one) so the first REAL search runs at
      // steady-state speed. Bypasses the API route → nothing is logged to
      // search_history. Runs under a synthetic tenant that matches no store,
      // so retrieval is exercised but returns zero cross-store data.
      const [runMod, tenantMod] = await Promise.all([
        import('@/lib/agents/adk/run-search'),
        import('@/lib/tenant-context'),
      ]);
      await tenantMod.runWithTenant('__warmup__', async () => {
        for await (const ev of runMod.runAgentBAdk({ query: 'warmup ping' })) {
          if (ev.type === 'done' || ev.type === 'error') break;
        }
      });
      console.log('[warmup] search agent + MCP + Mongo + Vertex ready');
    } catch (err) {
      console.warn('[warmup] non-fatal:', err instanceof Error ? err.message : err);
    }
  }, 1500);
}
