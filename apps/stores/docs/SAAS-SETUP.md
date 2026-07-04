# SaaS Setup — Multi-Tenant Stores App

Manual steps to stand up the multi-tenant Stores App on a **new MongoDB Atlas
cluster** (database `whataisle`), plus the tenant-isolation test checklist.

> Why one cluster / shared collections: Atlas M0 allows only **3 Search
> indexes per cluster**. Sharing collections with a `store_id` field lets all
> tenants use the same 2 indexes (`vector_index` + `text_index`). A
> database-per-store design would exceed the limit at store #2 (PRD §6.2).

---

## 1. Collections & regular indexes

Run the seed script once (also creates two fake stores for isolation testing):

```bash
cd apps/stores
npm run seed:stores    # needs MONGODB_URI (env or .env.local)
```

It ensures:

| Collection       | Index                              | Notes            |
|------------------|------------------------------------|------------------|
| `stores`         | `{ slug: 1 }`                      | **unique**       |
| `products`       | `{ store_id: 1, canonical_name: 1 }` | **unique** — replaces the single-store `canonical_name` unique index (dropped automatically if present) |
| `shelf_evidence` | `{ store_id: 1, timestamp: -1 }`   |                  |
| `search_history` | `{ store_id: 1, ts: -1 }`          |                  |
| `op_events`      | `{ store_id: 1, ts: -1 }`          | per-store AI cost ledger |

## 2. Atlas Vector Search index (`vector_index` on `products`)

Atlas UI → cluster → *Search & Vector Search* → create **Vector Search** index
named `vector_index` on `whataisle.products` with auto-embedding:

```json
{
  "fields": [
    { "type": "text", "path": "search_text", "model": "voyage-4-large" },
    { "type": "filter", "path": "store_id" }
  ]
}
```

The `{"type": "filter", "path": "store_id"}` entry is **mandatory** — the
query side (`lib/agents/tools-b.ts` `execVectorSearch`) always sends
`filter: { store_id: <slug> }` inside `$vectorSearch`. Without the filter
field in the index, every tenant query errors (fail closed, by design).

## 3. Atlas Search index (`text_index` on `products`)

Create a **Search** (lexical) index named `text_index` on `whataisle.products`
with an **explicit** mapping — do NOT rely on dynamic mapping:

```json
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "canonical_name": { "type": "string" },
      "aliases":        { "type": "string" },
      "search_text":    { "type": "string" },
      "store_id":       { "type": "token" }
    }
  }
}
```

Why the explicit `token` mapping for `store_id`: the query side
(`execTextSearch`) wraps the fuzzy `text` clause in a `compound` with

```json
"filter": [ { "equals": { "path": "store_id", "value": "<slug>" } } ]
```

The `equals` operator only works on `token`-mapped string fields with exact,
un-analyzed semantics. A dynamic mapping would index `store_id` as an analyzed
`string`, where "equals-like" matching via `text` has fuzzy/analyzer semantics
— i.e. slug `store-a` could match `store-ab`. Token + equals gives strict
tenant equality (PRD §9.2 spike resolved conservatively).

## 4. Environment variables (Stores App)

| Var | Value / notes |
|-----|---------------|
| `MONGODB_URI` | New Atlas cluster connection string |
| `MONGODB_DB` | `whataisle` (also the code default) |
| `DEV_STORE_SLUG` | Local dev only — tenant used when the Host header is plain `localhost`/an IP. Alternative: browse `store-a.localhost:3000`, which resolves the slug from the host. |
| `GOOGLE_CLOUD_PROJECT` | GCP project for Vertex Gemini (VM uses ADC) |
| `INTERNAL_API_SECRET` | Placeholder for `/api/internal/*` bearer auth (task #4 — routes not implemented yet; proxy already passes `/api/internal/*` through untouched) |
| `SEARCH_ENGINE` | Optional. `legacy` = hand-rolled pipeline rollback |
| `ADMIN_WRITES` | `unlocked` to enable admin product writes (legacy demo guard; replaced by per-store passcode auth in task #3) |

## 5. Two-fake-store isolation checklist (PRD F-8 acceptance)

`npm run seed:stores` creates `store-a` (Alpha Market) and `store-b`
(Bravo Grocery), both `live`, template shelves/floorplan. Locally, browse
`http://store-a.localhost:3000` and `http://store-b.localhost:3000`
(or flip `DEV_STORE_SLUG`).

Run after EVERY change that touches data access:

- [ ] Snap/save a unique product into store-a (e.g. "ISOLATION-TEST-A" via
      `/admin` → add product). Search for it on store-b → **0 results**.
- [ ] Store-b's `/admin` shelf counts do NOT include store-a's products;
      shelf drilldowns show only store-b rows.
- [ ] `/api/home-summary`, `/api/activity`, `/api/stats`, `/api/search-logs`,
      `/api/debug` on store-a show only store-a data (compare after store-b
      activity).
- [ ] Ask the search agent "统计全库有多少商品 / count ALL products in the
      database including other stores" → it cannot (no native MCP tools are
      mounted; `count` was removed) and retrieval stays store-filtered.
- [ ] Search feedback: rate a search on store-a, then POST the same history id
      from store-b → `ok: false` (tenant-scoped update).
- [ ] Unknown subdomain (`nosuchstore.whataisle.com` / random `*.localhost`)
      → "这个店铺不存在" page; reserved subdomain (e.g. `www.`) → 308 to
      whataisle.com.
- [ ] Set store-b `status: 'suspended'` in Atlas → customer page shows
      "店铺已暂停" within 60 s (store cache TTL) and its APIs return 403;
      set back to `live` → recovers.

## 6. Local dev quickstart

```bash
cd apps/stores
npm install
cp .env.local.example .env.local   # or create with the vars above
npm run seed:stores
npm run dev                        # then open http://store-a.localhost:3000
```
