# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # next dev — local server on http://localhost:3000 (spawns MCP subprocess)
npm run build    # next build — also runs the TypeScript compile; use this to verify before deploy
npm start        # next start — production server (PM2 runs this on the VM)
npx tsc --noEmit # type-check only, no build artifacts
```

There is **no test runner and no linter configured** (no `test`/`lint` scripts, no eslint/jest/vitest config). "Verify before commit" means `npm run build` passes with no TypeScript errors. Deployment is **not** Vercel — see `@AGENTS.md` / `docs/DEPLOYMENT.md` (SSH into the GCP VM and rebuild).

## Architecture

Wherebear turns shelf photos into a multilingual, searchable aisle index. Two user flows, both streamed to the UI as **Server-Sent Events** so each step (and its MongoDB call) is visible live.

### Flow 1 — Snap-to-memory (write path)
1. `POST /api/vision` → `detectAndIdentifyProducts` in `lib/gemini.ts`: **two-stage** Gemini vision — Stage 1 detects SKU bounding boxes, `sharp` crops them, Stage 2 batch-identifies each crop. Returns products + 240px thumbnail data URLs.
2. Client edits the list, picks an aisle, then `POST /api/shelf-evidence` → `saveShelfDirect` in `lib/shelf-save.ts`: one indexed `find` + one `bulkWrite` upsert into `products` (~300–500 ms critical path), then `enhanceShelfBackground` expands Chinese aliases via one Gemini call **after the SSE closes** and refreshes `search_text` (which Atlas auto-embeds).
   - ⚠️ **`lib/agents/agent-a.ts` + `tools-a.ts` are the SUPERSEDED LLM-loop version of this flow.** The live write path is `lib/shelf-save.ts`. Don't edit agent-a expecting it to affect saving.

### Flow 2 — Find-the-aisle (search path)
`POST /api/search` → `runAgentBAdk` in `lib/agents/adk/run-search.ts`: a **Google ADK `LlmAgent`** (`@google/adk`) drives Gemini function-calling over three app FunctionTools (`understand_intent` / `vector_search` / `suggest_by_category` — `lib/agents/adk/tools.ts`) and the **MongoDB MCP server mounted as an ADK `MCPToolset`** (`lib/agents/adk/search-agent.ts`). The adapter translates ADK events back into the existing `AgentEvent` shape and reuses `synthesizeFinish` (`lib/agents/tools-b.ts`) for the keep/guess/discard bucketing + bilingual answer, so the SSE contract and UI are unchanged. Every search is logged to `search_history` for the `/searchlog` feedback UI.

- The legacy hand-rolled pipeline (`runAgentB` in `lib/agents/agent-b.ts`) is kept behind `SEARCH_ENGINE=legacy` as a one-line rollback for demos; the ADK path is the default and the canonical one for compliance ("built with Google Cloud Agent Builder / ADK").
- **Critical gotcha**: ADK's `Runner.runEphemeral({ newMessage })` requires `newMessage.role === 'user'` — without it Gemini drops the content and the agent never sees the query (replies "what are you looking for?"). See the comment in `run-search.ts`.

### Data layer — two access paths to the same MongoDB Atlas
- **Direct driver** (`lib/mongodb.ts` `getDb()`): hot paths — `saveShelfDirect`, `/api/health`, `/api/activity`, candidate enrichment. Fast, no subprocess.
- **MCP layer** (`lib/mcp/mongo-mcp.ts`, `mongo-ops.ts`): wraps `mongodb-mcp-server` spawned as a **stdio child process**, with direct-SDK fallback. The search agent's `vector_search` and `log_search` go through here (so the UI's **MCP** pill is honest), and **the ADK search agent additionally mounts the MCP server as an `MCPToolset`** (`lib/agents/adk/search-agent.ts`) so the agent can call MongoDB MCP tools directly — that's the hackathon's "ADK agent ↔ partner MCP server" story, observable at runtime via the agent panel.
- **Vector search uses Atlas `autoEmbed`** (`voyage-4-large`) on `products.search_text` — embeddings are managed by Atlas, never computed in our code. The index is named `vector_index`.

### Vision / LLM config (`lib/gemini.ts`)
- Model `gemini-3.5-flash`, Vertex AI, **`location = 'global'` hardcoded** — Gemini 3.x 404s on `us-central1` even though the VM's env sets that region.
- `generateContentWithRetry`: exponential backoff (1→2→4→8s, 5 attempts) on 429/503/500.
- Thinking is disabled (`thinkingBudget: 0`) on vision + search calls for latency.

## Gotchas

- **Customized Next.js 16** — APIs differ from training data. Read `node_modules/next/dist/docs/` before changing route/config conventions (also stated in `@AGENTS.md`).
- **MCP is a child process** → the app cannot run on Vercel/serverless; it needs a long-lived Node host (the VM, or `next dev`).
- **Thumbnails are stored inline** in `products` as 240px JPEG data URLs (~25 KB each, capped 200 KB). At 10k+ products this pushes against the **Atlas M0 512 MB** ceiling — check `db.stats()` before assuming headroom.
- Components are **inline-styled** with tokens from `lib/theme.ts`; there's no CSS module / styled-components layer.
