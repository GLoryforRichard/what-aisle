# Wherebear — Deployment Reference

Last verified: 2026-06-04 · current commit on `main`: `d4b1e82`.

> **⚠️ Migrated 2026-06-04** — moved off the original GCP project `wherebear-496400`
> (account `wonderfulrichard123@gmail.com`) after its billing entered dunning. Production
> now runs on project **`acoustic-cargo-498500-q3`** (account **`melody@hes.edu.kg`**, a
> fresh $300 free trial). The old VM is **stopped** and the old project's **billing is
> unlinked** — no further charges (the old ~$76 balance is frozen, not paid). MongoDB Atlas
> and the app code are unchanged. **Auth changed:** the `hes.edu.kg` org blocks
> service-account *key* creation (`iam.disableServiceAccountKeyCreation`), so the VM uses
> its **attached** SA (metadata ADC) and local dev uses **ADC user login**
> (`gcloud auth application-default login`) instead of a `gcp-key.json` file.

---

## Public surface

| What | Where |
|---|---|
| Live app | <https://wherebear.help> (also `https://www.wherebear.help`) |
| Fallback URL (no domain) | <https://34.130.97.67.nip.io> |
| Source repo | <https://github.com/GLoryforRichard/wherebear> |
| Branch & flow | direct pushes to `main`; no PR workflow set up |
| License | MIT |

---

## Infrastructure

```
            ┌────────────────────────────────────────┐
            │  DNS via NameSilo (TTL 3603)            │
            │  A   wherebear.help  → 34.130.97.67     │
            │  A   www             → 34.130.97.67     │
            └──────────────┬─────────────────────────┘
                           ▼
   ┌──────────────────────────────────────────────────────────┐
   │  GCP Compute Engine VM · project acoustic-cargo-498500-q3 │
   │  name      wherebear-vm                                   │
   │  zone      northamerica-northeast2-b (Toronto)            │
   │  machine   e2-medium · 2 vCPU shared · 4 GB RAM           │
   │  disk      10 GB balanced PD · Ubuntu 22.04 LTS           │
   │  IP        34.130.97.67  (STATIC, reserved as wherebear-ip)│
   │  monthly   ≈ USD 25, paid from the $300 free trial        │
   │                                                           │
   │  ┌──────── Caddy 2 ────────┐  :80 / :443  HTTPS via       │
   │  │ /etc/caddy/Caddyfile     │  Let's Encrypt (auto)       │
   │  │  reverse_proxy :3000     │                             │
   │  └──────────────────────────┘                             │
   │                ▼                                          │
   │  ┌──────── PM2 (process: wherebear) ────────┐             │
   │  │  npm start -- -H 0.0.0.0 -p 3000          │             │
   │  │  cwd: /home/mystery/wherebear             │             │
   │  │  autorestart on crash, survives reboot    │             │
   │  └────────────┬──────────────────────────────┘             │
   │               ▼                                           │
   │   Next.js 16 production server (Node 20.20.2)             │
   │   ├── spawns MongoDB MCP server as child process          │
   │   │   (stdio transport, lib/mcp/client.ts singleton)      │
   │   └── @google/genai SDK using the VM's ATTACHED SA        │
   │       wherebear-vertex@acoustic-cargo-498500-q3           │
   │       (ADC via GCE metadata — no key file)                │
   └──────────────────────────────────────────────────────────┘
                           │
                ┌──────────┴─────────┐
                ▼                    ▼
   ┌──────────────────┐  ┌──────────────────────────┐
   │ MongoDB Atlas    │  │ Google Vertex AI         │
   │ M0 free cluster  │  │ project acoustic-cargo-  │
   │ wherebear-cluster│  │   498500-q3              │
   │ db: wherebear    │  │ location 'global' (code) │
   │                  │  │ model gemini-3.5-flash   │
   │ collections:     │  │ + voyage-4-large autoEmbed│
   │  shelf_evidence  │  │                          │
   │  products        │  │                          │
   │  search_logs     │  │                          │
   │ Vector index     │  │                          │
   │  vector_index    │  │                          │
   │  on products     │  │                          │
   │  .search_text    │  │                          │
   └──────────────────┘  └──────────────────────────┘
```

Current DB state on prod (counts grow as shelves are scanned — re-check with `curl /api/health`):
- `products`: **13,000+** real SKUs
- `shelf_evidence` / `search_logs`: grow with usage

---

## Secrets / environment

Stored on the VM at `/home/mystery/wherebear/.env.local` (gitignored).

```env
MONGODB_URI=mongodb+srv://lby2024xd_db_user:<password>@wherebear-cluster.fm98z4w.mongodb.net/wherebear?retryWrites=true&w=majority&appName=wherebear-cluster
MONGODB_DB=wherebear
GOOGLE_CLOUD_PROJECT=acoustic-cargo-498500-q3
GOOGLE_CLOUD_LOCATION=us-central1
```

**Notes**
- Even though `GOOGLE_CLOUD_LOCATION=us-central1` is set, the code **hardcodes `location='global'`** in `lib/gemini.ts` — Gemini 3.x 404s on regional endpoints, so the env var is effectively ignored for model calls.
- **Prod auth = attached service account.** No `GEMINI_API_KEY` or `GOOGLE_APPLICATION_CREDENTIALS` on the VM — the SDK auto-discovers ADC from the GCE metadata server. The attached SA `wherebear-vertex@acoustic-cargo-498500-q3.iam.gserviceaccount.com` holds `roles/aiplatform.user`. ⚠️ SA **key files cannot be created** under the `hes.edu.kg` org (`iam.disableServiceAccountKeyCreation`), so attached-SA (prod) and ADC (local) are the only auth paths — do not expect a `gcp-key.json` to work.
- **Local dev auth = ADC user login.** One-time on the Mac: `gcloud auth application-default login` (sign in as `melody@hes.edu.kg`) then `gcloud auth application-default set-quota-project acoustic-cargo-498500-q3`. `.env.local` sets `GOOGLE_CLOUD_PROJECT=acoustic-cargo-498500-q3` with **no** `GOOGLE_APPLICATION_CREDENTIALS`. The retired old-project key is parked at `gcp-key.old.json` (unused).
- `lib/gemini.ts` supports an **AI Studio fallback**: set `GEMINI_API_KEY` to route Gemini via the Developer API (free tier, no Cloud billing) instead of Vertex. Unused in prod — Vertex is the hackathon-compliant path — but a fast escape hatch if Cloud access ever breaks again.
- MongoDB Atlas network allowlist is open (`0.0.0.0/0`) for the hackathon; tighten before any production use.

---

## API surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness probe (DB up/down only) |
| GET | `/api/debug` | Raw dump of recent docs across collections |
| POST | `/api/vision` | Multipart image → detected products list (uses shelf-code hint) |
| POST | `/api/shelf-evidence` | JSON `{aisle, products}` → SSE stream of Agent A events; persists to DB |
| POST | `/api/search` | JSON `{query}` → SSE stream of Agent B events; logs to `search_logs` |
| GET | `/api/admin/products` | Per-shelf counts; with `?aisle=A1` returns that shelf's products |
| PATCH | `/api/admin/products/[id]` | Update canonical_name / aliases / category / latest_aisle |
| DELETE | `/api/admin/products/[id]` | Remove one product |
| GET | `/api/activity` | Recent activity feed for the home screen |

Routes (UI):
- `/` — home with bear, two action cards, recent activity, SHELF ADMIN + DB DEBUG buttons
- `/admin` — 22-cell shelf grid, click to view/edit/delete that shelf's products
- `/debug` — raw JSON view of all three collections

---

## Operational commands

All commands run from your Mac and SSH into the VM via `gcloud`. **The active gcloud account must be `melody@hes.edu.kg`** — set it once with `gcloud config set account melody@hes.edu.kg`. Every `gcloud compute` command targets the new project via `--project=acoustic-cargo-498500-q3`.

### Health check
```bash
curl -s https://wherebear.help/api/health | jq
```

### Deploy a new commit
```bash
git push   # local → GitHub

gcloud compute ssh wherebear-vm --project=acoustic-cargo-498500-q3 --zone=northamerica-northeast2-b \
  --command "cd ~/wherebear && git pull && npm install && npm run build && pm2 restart wherebear"
```

### Tail server logs
```bash
gcloud compute ssh wherebear-vm --project=acoustic-cargo-498500-q3 --zone=northamerica-northeast2-b \
  --command "pm2 logs wherebear --lines 50 --nostream"
```

### Restart everything
```bash
gcloud compute ssh wherebear-vm --project=acoustic-cargo-498500-q3 --zone=northamerica-northeast2-b \
  --command "pm2 restart wherebear && sudo systemctl reload caddy"
```

### Stop / start the VM
```bash
gcloud compute instances stop  wherebear-vm --project=acoustic-cargo-498500-q3 --zone=northamerica-northeast2-b
gcloud compute instances start wherebear-vm --project=acoustic-cargo-498500-q3 --zone=northamerica-northeast2-b
# IP is now STATIC (wherebear-ip), so it survives stop/start — DNS stays valid.
```

### Roll back to the previous deploy
```bash
gcloud compute ssh wherebear-vm --project=acoustic-cargo-498500-q3 --zone=northamerica-northeast2-b \
  --command "cd ~/wherebear && git reset --hard HEAD~1 && npm run build && pm2 restart wherebear"
```

---

## What the agents do, end-to-end

**Snap shelf flow** (Agent A, `/api/shelf-evidence`):
1. Worker picks a shelf code (A1–B11) → SnapScreen passes the code to `/api/vision` so Gemini knows what to expect.
2. Capture or upload a photo. `/api/vision` returns detected products in ~3-6 s.
3. Worker edits the list, taps Save to memory.
4. ProgressScreen chunks the list into batches of 10 and opens one SSE stream per chunk to `/api/shelf-evidence`.
5. The live write path is `saveShelfDirect` in `lib/shelf-save.ts` (one indexed `find` + one `bulkWrite`), with `enhanceShelfBackground` expanding Chinese aliases after the SSE closes. (`lib/agents/agent-a.ts` is the superseded LLM-loop version.)
6. ThinkingPanel renders every `tool_call`/`tool_result` event with an MCP or SDK badge.

**Find item flow** (Agent B, `/api/search`):
1. Worker types or picks a query.
2. `/api/search` runs Agent B: `understand_intent` → Atlas `$vectorSearch` → `finish` (bilingual answer), logging to `search_history`.
3. FindScreen renders the thinking panel and the result card.

---

## Known limitations & TODOs

- **Old project `wherebear-496400` is abandoned** (billing unlinked, VM stopped). Its ~$76 balance is unpaid/frozen. Don't re-link its billing unless you intend to settle it.
- DB allowlist is `0.0.0.0/0`. Tighten to the VM's IP (`34.130.97.67`) before any non-demo use.
- Database password was sent in plaintext during the original setup. Rotate before any public showcase.
- Prod external IP is now **static** (`wherebear-ip` = 34.130.97.67), so stop/start no longer breaks DNS. (A reserved static IP is free while attached, ~$0.004/h if the VM is deleted but the address kept.)
- No log retention / monitoring beyond `pm2 logs` on the VM.
- `npm install` on the VM uses optional native binaries (`lightningcss`, `sharp`) — don't pass `--omit=optional` when redeploying.
- Devpost submission is drafted in `docs/DEVPOST_DRAFT.md`; demo video shot list in `docs/DEMO_SCRIPT.md`.

---

## Cost snapshot

| Item | Tier | Monthly |
|---|---|---|
| GCE e2-medium 2vCPU/4GB + 10 GB disk + egress | Standard | ≈ USD 25 |
| Reserved static IP (attached) | — | $0 |
| MongoDB Atlas M0 cluster | Free forever | $0 |
| Voyage AI autoEmbed calls | Bundled in Atlas Search | $0 |
| Vertex AI Gemini 3.5 Flash | Pay-per-token | ≈ $1-3 during demo bursts |
| Domain `wherebear.help` | NameSilo (annual reg) | ≈ $2/mo |
| Caddy / Let's Encrypt | Open source | $0 |
| **Total** | | covered by the $300 free trial on `melody@hes.edu.kg` |
