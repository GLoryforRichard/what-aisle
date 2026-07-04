# What-Aisle 部署 Runbook（DEPLOY.md）

> 目标：把 What-Aisle SaaS 从零部署到**一台全新 GCP VM**，两个 Node 应用同机运行，Caddy 泛域名反代。
> 权威来源：`PRD.md` §6.5 + `README.md`；**所有环境变量与步骤均从真实源码派生**（`process.env.*` 实际引用、`env.example`、`docs/SAAS-SETUP.md`、`docs/DEPLOYMENT.md`、migrations、webhook/store-lifecycle 源码）。
>
> **标记约定**：`【需要用户】` = 需要人工决策或账户操作（注册/登录控制台/点按钮/复制密钥），Claude 无法代做。
> 命令全部英文可直接复制；说明用中文。
>
> **重要边界**：生产 `wherebear.help` 是**完全独立、不受影响**的另一套部署（另一个 GCP 项目 `acoustic-cargo-498500-q3`、另一个 Atlas 集群、另一个 VM `wherebear-vm`）。本 runbook 全程**不触碰它**。

---

## 架构速览（来自 PRD §6.1 / 6.5，已与源码核对）

```
Cloudflare DNS（NS 迁入，仅解析不代理 / DNS-only）
   A  what-aisle.com    → VM_IP
   A  *.what-aisle.com   → VM_IP
                │
   ┌────────────▼─────────────────────────────┐
   │ GCP VM: whataisle-vm (e2-standard-2, 8GB) │
   │ region northamerica-northeast2, Ubuntu 22 │
   │                                            │
   │ Caddy（xcaddy 定制，含 caddy-dns/cloudflare）│
   │   what-aisle.com, www → :3002  Portal      │  ← pnpm, Postgres/Neon
   │   superadmin.…  basic_auth → :3001 Stores  │  ← npm,  MongoDB Atlas
   │   *.what-aisle.com → :3001  Stores         │
   │   每个 vhost：/api/internal/* 公网 403      │
   │                                            │
   │ PM2: wa-portal(:3002), wa-stores(:3001)    │
   └──────┬──────────────────────┬──────────────┘
          │ 127.0.0.1 内部 API   │ (共享 bearer secret)
     Neon Postgres          MongoDB Atlas M0（新集群，库 whataisle）
     Stripe / Resend / R2   Vertex AI Gemini（VM ADC）
```

- **Portal**（`apps/portal`，源自 mksaas）：营销页 + 注册 + Stripe 收费 + 店主后台，服务 `what-aisle.com`，**端口 3002**，包管理器 **pnpm**。
- **Stores**（`apps/stores`，源自 wherebear 多租户版）：顾客搜索 + 店铺管理 + superadmin 建店台，服务 `*.what-aisle.com` 与 `superadmin.what-aisle.com`，**端口 3001**，包管理器 **npm**。
- 两应用通过 **127.0.0.1 回环 + 共享 `INTERNAL_API_SECRET`（Bearer）** 互调；`/api/internal/*` 在 Caddy 每个公网 vhost 一律 403。

> **代码 vs PRD 差异**（见文末《差异清单》）：`apps/portal/env.example` 里 cron 示例误写 `:3000`；实际 Portal 跑在 `:3002`。本 runbook 已按代码/PRD 的 **3002** 修正。

---

## A. 前置检查清单（Prerequisites）

开始前请确认你**已拥有或将创建**以下账户/资产。逐项打勾。

- [ ] `【需要用户】` **GCP 项目 + 结算/免费积分**（新项目，专供 What-Aisle；不要复用 wherebear 的 `acoustic-cargo-498500-q3`，PRD §6.2-#8 明确用新 VM）。
- [ ] `【需要用户】` **域名 `what-aisle.com`**（PRD 说已注册）——需要能在注册商处**改 NS 指向 Cloudflare**。
- [ ] `【需要用户】` **Cloudflare 账户**（把域名 NS 迁入，用于 DNS 解析 + DNS-01 泛域名证书）。
- [ ] `【需要用户】` **MongoDB Atlas 账户**（创建**全新集群**，独立于 wherebear 生产集群）。
- [ ] `【需要用户】` **Neon 账户**（Postgres，Portal 用）。
- [ ] `【需要用户】` **Stripe 账户**（已有；需在其中创建 2 个 Price + 1 个 Webhook 端点）。
- [ ] `【需要用户】` **Cloudflare R2**（一个 bucket，存店主布局视频）。
- [ ] `【需要用户】` **Resend 账户**（API key + 验证发信域名）。
- [ ] `【需要用户】` **Google Cloud 项目**用于 Vertex AI / Gemini（可与上面 GCP 项目同一个；VM 用附加 SA 走 ADC）。
- [ ] 本机已装 `gcloud` CLI 并 `gcloud auth login`（用**新项目**对应的账户）。

---

## 环境变量总表（从源码派生，权威）

> **required** = 缺失则该功能 fail-closed / 报错；**optional** = 可留空。
> 生成随机密钥：`openssl rand -base64 32`。
> 每个应用一份 `.env.local`（`.gitignore` 已忽略 `.env*`，**绝不提交**）。

### 表 1 — Portal（`apps/portal/.env.local`）

来源：`env.example` + 实际 `process.env` 引用（`src/lib/stores-api.ts`、`r2-presign.ts`、`store-lifecycle.ts`、`config/website.tsx`、`payment/provider/stripe.ts`、`app/api/cron/store-maintenance`、`app/api/internal/store-status`）。

| 变量 | 示例 / 占位 | 从哪拿 | 必需? |
|---|---|---|---|
| `NEXT_PUBLIC_BASE_URL` | `https://what-aisle.com` | 你的生产域名（**不是 localhost**） | **required** |
| `DATABASE_URL` | `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require` | Neon 项目连接串 | **required** |
| `BETTER_AUTH_SECRET` | `<openssl rand -base64 32>` | 自生成 | **required** |
| `STRIPE_SECRET_KEY` | `sk_live_...`（测试期 `sk_test_...`） | Stripe Dashboard → Developers → API keys | **required** |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Stripe → Webhooks → 你的端点 → Signing secret | **required** |
| `NEXT_PUBLIC_PAYMENT_PROVIDER` | `stripe` | 固定 `stripe` | **required** |
| `NEXT_PUBLIC_STRIPE_PRICE_WHATAISLE_MONTHLY` | `price_...` | Stripe → 你创建的 **$99/月 recurring** Price ID | **required** |
| `NEXT_PUBLIC_STRIPE_PRICE_WHATAISLE_SETUP` | `price_...` | Stripe → 你创建的 **$688 一次性** Price ID | **required** |
| `INTERNAL_API_SECRET` | `<openssl rand -base64 32>` | 自生成，**两应用必须完全相同** | **required** |
| `STORES_INTERNAL_URL` | `http://127.0.0.1:3001` | 固定回环地址（Stores 端口） | required（有默认值 `http://127.0.0.1:3001`，显式写更稳） |
| `NEXT_PUBLIC_STORE_BASE_DOMAIN` | `what-aisle.com` | 固定域名（子域名卡片拼接用） | required（默认 `what-aisle.com`） |
| `STORAGE_REGION` | `auto` | R2 固定 `auto` | **required**（R2 预签名） |
| `STORAGE_BUCKET_NAME` | `whataisle-videos` | 你的 R2 bucket 名 | **required** |
| `STORAGE_ACCESS_KEY_ID` | `<R2 S3 token access key>` | Cloudflare R2 → Manage API Tokens | **required** |
| `STORAGE_SECRET_ACCESS_KEY` | `<R2 S3 token secret>` | 同上 | **required** |
| `STORAGE_ENDPOINT` | `https://<accountid>.r2.cloudflarestorage.com` | R2 → bucket → S3 API endpoint | **required** |
| `STORAGE_PUBLIC_URL` | `https://videos.what-aisle.com` 或 `https://pub-xxx.r2.dev` | R2 公共访问 URL（可选，用于回读链接） | optional |
| `CRON_JOBS_USERNAME` | `wa-cron` | 自定义（cron basic auth 用户名） | **required**（store-maintenance cron） |
| `CRON_JOBS_PASSWORD` | `<openssl rand -base64 24>` | 自生成 | **required** |
| `RESEND_API_KEY` | `re_...` | Resend Dashboard → API Keys | **required**（发邮件） |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | `...apps.googleusercontent.com` / `...` | Google Cloud → APIs & Services → Credentials（Better Auth Google 登录） | optional（无则仅邮箱登录） |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | — | GitHub Developers | optional（PRD F-2 明确对超市老板隐藏 GitHub 登录，可留空） |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | — | Cloudflare Turnstile | optional（验证码，仅 demo 模式启用） |
| `DISCORD_WEBHOOK_URL` / `FEISHU_WEBHOOK_URL` | — | 各自平台 | optional（建店告警增强，PRD 3.1-⑤ 标为可选） |
| `NEXT_PUBLIC_DEMO_WEBSITE` | `false` | 生产固定 `false` | required（默认 false） |

> 说明：mksaas 自带的 Pro/Lifetime/Credits 系列 Price 变量（`NEXT_PUBLIC_STRIPE_PRICE_PRO_*`、`_CREDITS_*`、`_LIFETIME`）在 `config/website.tsx` 里被引用；PRD F-6 要求隐藏 credits/积分 UI。这些**对 What-Aisle 主链路非必需**，可留空占位；只有 `WHATAISLE_MONTHLY` / `WHATAISLE_SETUP` 是 What-Aisle 结账真正读取的。

**Portal 必需项计数：18 个 required**（`NEXT_PUBLIC_BASE_URL`、`DATABASE_URL`、`BETTER_AUTH_SECRET`、`STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、`NEXT_PUBLIC_PAYMENT_PROVIDER`、`WHATAISLE_MONTHLY`、`WHATAISLE_SETUP`、`INTERNAL_API_SECRET`、`STORES_INTERNAL_URL`、`NEXT_PUBLIC_STORE_BASE_DOMAIN`、`STORAGE_REGION`、`STORAGE_BUCKET_NAME`、`STORAGE_ACCESS_KEY_ID`、`STORAGE_SECRET_ACCESS_KEY`、`STORAGE_ENDPOINT`、`CRON_JOBS_USERNAME`、`CRON_JOBS_PASSWORD`、`RESEND_API_KEY`、`NEXT_PUBLIC_DEMO_WEBSITE`——严格数 20，其中 `STORES_INTERNAL_URL`/`NEXT_PUBLIC_STORE_BASE_DOMAIN`/`NEXT_PUBLIC_DEMO_WEBSITE` 有代码默认值，核心强依赖 **17 个**）。

### 表 2 — Stores（`apps/stores/.env.local`）

来源：实际 `process.env` 引用（`lib/mongodb.ts`、`lib/gemini.ts`、`lib/internal-auth.ts`、`lib/signed-token.ts`、`lib/superadmin-session.ts`、`app/api/superadmin/*`、`app/superadmin/page.tsx`、`proxy.ts`、`app/api/search/route.ts`）+ `docs/SAAS-SETUP.md` §4。

| 变量 | 示例 / 占位 | 从哪拿 | 必需? |
|---|---|---|---|
| `MONGODB_URI` | `mongodb+srv://user:pass@whataisle.xxxx.mongodb.net/?retryWrites=true&w=majority` | **新** Atlas 集群连接串 | **required** |
| `MONGODB_DB` | `whataisle` | 固定 `whataisle`（代码默认也是它） | **required** |
| `GOOGLE_CLOUD_PROJECT` | `your-whataisle-gcp-project` | GCP 项目 ID（Vertex，VM 走附加 SA 的 ADC） | **required**（Vertex 路径） |
| `INTERNAL_API_SECRET` | `<与 Portal 完全相同>` | 与 Portal 同一个值 | **required** |
| `STORE_ADMIN_COOKIE_SECRET` | `<openssl rand -base64 32>`（**≥16 字符**） | 自生成；`lib/signed-token.ts` 强制 ≥16，否则拒签 cookie | **required**（店员/superadmin 会话签名） |
| `SUPERADMIN_TOKEN` | `<openssl rand -base64 32>` | 自生成；`app/api/superadmin/session` 时间安全比对 | **required**（建店台登录） |
| `PORTAL_INTERNAL_URL` | `http://127.0.0.1:3002` | 固定回环（Portal 端口）；反向调 `store-status` 用 | required（代码默认 `http://127.0.0.1:3002`） |
| `R2_PUBLIC_BASE_URL` | `https://videos.what-aisle.com` 或 `https://pub-xxx.r2.dev` | R2 公共 URL；superadmin 拼视频回看链接（`app/superadmin/page.tsx`） | optional（无则 superadmin 视频链接为空，但不影响建店） |
| `DEV_STORE_SLUG` | `store-a` | **仅本地开发**：Host 为裸 localhost/IP 时的租户回退 | optional（**生产不设**） |
| `SEARCH_ENGINE` | `legacy` | 可选回滚开关；不设=默认 ADK 路径 | optional |
| `GEMINI_API_KEY` | `AIza...` | **仅逃生门**：设了则走 AI Studio 而非 Vertex（`lib/gemini.ts`） | optional（生产用 Vertex ADC，**不设**） |
| `GEMINI_MODEL` | `gemini-3.5-flash` | 覆盖默认模型（仅 AI Studio 路径需要） | optional（默认 `gemini-3.5-flash`） |

> **Vertex vs AI Studio**（源码事实，`lib/gemini.ts` + `lib/agents/adk/search-agent.ts`）：若 `GEMINI_API_KEY` **已设**→走 AI Studio Developer API；**未设**→走 Vertex（读 `GOOGLE_CLOUD_PROJECT`，location 硬编码 `'global'`）。生产按 PRD 走 **Vertex + VM ADC**，所以**不要设 `GEMINI_API_KEY`**。
> `GOOGLE_CLOUD_LOCATION` 在 wherebear 生产 `.env` 里有，但代码里 location 硬编码 `'global'`，**该变量对模型调用无效**，可不设。

**Stores 必需项计数：6 个 required**（`MONGODB_URI`、`MONGODB_DB`、`GOOGLE_CLOUD_PROJECT`、`INTERNAL_API_SECRET`、`STORE_ADMIN_COOKIE_SECRET`、`SUPERADMIN_TOKEN`；`PORTAL_INTERNAL_URL` 有默认值算准必需）。

> **关键一致性**：`INTERNAL_API_SECRET` 在两应用里**必须逐字节相同**——否则回环互调 401，付了钱建不成店。

---

## B. 外部服务配置（全部 `【需要用户】`）

### B.1 Cloudflare（DNS + 泛域名证书 token）

1. `【需要用户】` 在 Cloudflare 添加站点 `what-aisle.com`，按提示到**域名注册商**把 NS 改为 Cloudflare 给的两个 NS，等待生效（`dig NS what-aisle.com` 出现 Cloudflare NS 即成）。
2. `【需要用户】` 待 VM 有静态 IP 后（见 §C），在 Cloudflare DNS 添加（**Proxy status = DNS only / 灰云**，泛域名证书走 DNS-01，不能开橙云代理）：
   - `A  @    → VM_IP`（`what-aisle.com`）
   - `A  *    → VM_IP`（`*.what-aisle.com`，覆盖所有店铺子域 + `superadmin`）
   - （可选）`A  www → VM_IP`
3. `【需要用户】` 创建 **scoped API Token**（My Profile → API Tokens → Create Token → Custom）：
   - 权限：**Zone → DNS → Edit**
   - Zone Resources：Include → Specific zone → `what-aisle.com`
   - 复制 token → 即 **`CF_API_TOKEN`**（Caddy DNS-01 用，见 §D）。

### B.2 Neon（Postgres）+ 迁移

1. `【需要用户】` neon.tech 创建 project（region 就近，如 `aws-us-east`），复制连接串 → **`DATABASE_URL`**（带 `?sslmode=require`）。
2. 在 VM 上（或本机对着 Neon）跑迁移：

```bash
cd apps/portal
# 确保 apps/portal/.env.local 里 DATABASE_URL 已填 Neon
pnpm db:migrate     # = drizzle-kit migrate，应用 src/db/migrations/*.sql
```

`src/db/migrations/` 当前存在的迁移文件（会全部按序应用）：

```
0000_fine_sir_ram.sql            0006_ambitious_annihilus.sql
0001_woozy_jigsaw.sql            0007_empty_captain_universe.sql
0002_left_grandmaster.sql        0008_curious_patch.sql
0003_loving_risque.sql           0009_mushy_marten_broadcloak.sql   ← 建 stores 表
0004_clever_molly_hayes.sql      0010_boring_shriek.sql             ← 加 checkout_session_id + suspension_reason
0005_thankful_wolf_cub.sql
```

- **0009** 创建 `stores` 表（`slug` UNIQUE、`status` 默认 `pending_payment`、`stripe_customer_id`、`subscription_id`、`setup_payment_id`、`video_r2_key`、`video_external_url`、`payment_failed_at`/`live_at`/`suspended_at`/`canceled_at`，及 4 个索引）。
- **0010** 追加 `checkout_session_id`（会话关联，防 superseded checkout 误建店）+ `suspension_reason`（区分 dunning / sub_deleted）。
- 验证：`pnpm db:studio` 打开能看到 `stores` 表且含上述两列。

### B.3 MongoDB Atlas（新集群 + 两个 Search 索引）

> **新集群，独立于 wherebear 生产**（PRD §6.2-#8、§6.6）。库名固定 `whataisle`。

1. `【需要用户】` Atlas 创建**新** M0 集群（如命名 `whataisle`），创建数据库用户，记连接串 → **`MONGODB_URI`**。
2. `【需要用户】` Network Access：加**VM 的静态 IP**（见 §C；生产收紧到 VM IP，不用 `0.0.0.0/0`）。
3. 建常规集合与索引（一次性）：

```bash
cd apps/stores
# 需要 MONGODB_URI（env 或 .env.local）
npm run seed:stores     # = tsx scripts/seed-stores.ts
```

`seed:stores` 会确保以下集合与常规索引（并顺带建两家假店 store-a / store-b 供隔离测试）：

| 集合 | 索引 | 说明 |
|---|---|---|
| `stores` | `{ slug: 1 }` | **unique** |
| `products` | `{ store_id: 1, canonical_name: 1 }` | **unique**（替换单店版 canonical_name 唯一索引，存在则自动 drop） |
| `shelf_evidence` | `{ store_id: 1, timestamp: -1 }` | |
| `search_history` | `{ store_id: 1, ts: -1 }` | |
| `op_events` | `{ store_id: 1, ts: -1 }` | 按店 AI 成本台账 |

4. `【需要用户】` 在 Atlas UI → **Search & Vector Search** 手动建**两个** Search 索引（`seed` 脚本不建这两个；Atlas Search 索引须在 UI/Admin API 建）：

**(a) Vector Search 索引，名 `vector_index`，集合 `whataisle.products`**（auto-embedding）：

```json
{
  "fields": [
    { "type": "text", "path": "search_text", "model": "voyage-4-large" },
    { "type": "filter", "path": "store_id" }
  ]
}
```

> `{"type":"filter","path":"store_id"}` **必填**——查询侧 `lib/agents/tools-b.ts` 的 `execVectorSearch` 永远带 `filter: { store_id: <slug> }`；缺了这个 filter 字段，每个租户查询都会报错（fail-closed，故意的）。

**(b) Search（词法）索引，名 `text_index`，集合 `whataisle.products`**，**显式映射（不要 dynamic）**：

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

> `store_id` 必须映射为 **`token`**——查询侧 `execTextSearch` 用 `compound.filter: [{ equals: { path:"store_id", value:"<slug>" } }]`，`equals` 只对 `token` 型精确生效。用 dynamic/analyzed 会让 `store-a` 模糊匹配到 `store-ab`（跨租户泄漏）。这是 PRD §9.2 spike 的保守解。

> M0 每集群限 **3 个 Search 索引**；共享集合方案全租户共用这 **2 个**，留 1 个余量。

### B.4 Stripe（2 个 Price + Webhook）

1. `【需要用户】` Products → 创建两个价格（**test 与 live 各建一套**，先用 test 跑通再切 live）：
   - **$99/月 recurring**（monthly subscription）→ 记 Price ID → `NEXT_PUBLIC_STRIPE_PRICE_WHATAISLE_MONTHLY`
   - **$688 一次性**（one-time）→ 记 Price ID → `NEXT_PUBLIC_STRIPE_PRICE_WHATAISLE_SETUP`
     （代码把 setup fee 作为 subscription checkout 的额外 line item，PRD F-3）
2. `【需要用户】` Developers → Webhooks → Add endpoint：
   - URL：`https://what-aisle.com/api/webhooks/stripe`
   - **订阅事件集**（与源码 `payment/provider/stripe.ts` + `lib/store-lifecycle.ts` 实际处理的一致）：
     - `checkout.session.completed` → 建店 → `awaiting_video`
     - `checkout.session.expired` → 释放 `pending_payment` 行（+ 每日 cron 兜底）
     - `invoice.paid` → 欠费恢复 `live`
     - `invoice.payment_failed` → 启动 7 天 dunning 计时
     - `customer.subscription.deleted` → 立即 `suspended`（reason=sub_deleted）
     - `charge.refunded` → `canceled`（终态）
     - 模版链路还会消费：`customer.subscription.created`、`customer.subscription.updated`（订阅记录维护）——一并勾选。
   - 复制该端点的 **Signing secret** → `STRIPE_WEBHOOK_SECRET`。
3. **税务**（源码已就绪，PRD §8.5）：结账代码 `payment/provider/stripe.ts` 已对 subscription checkout 设 `tax_id_collection = { enabled: true }`（收集企业税号，B2B / reverse-charge）；`automatic_tax` 保持关闭（monitoring-only）。
   - `【需要用户】` 在 Stripe → Tax 开启 **阈值监控（monitoring）**（免费追踪各税区注册义务，未达阈值不代收）。首个大概率义务是加拿大 GST/HST（约 25 家店规模才触及）。

### B.5 Cloudflare R2（bucket + 生命周期）

1. `【需要用户】` R2 → 创建 bucket（如 `whataisle-videos`）→ 填 `STORAGE_BUCKET_NAME`。
2. `【需要用户】` Manage API Tokens → 建 **S3 API token**（Object Read & Write）→ 得 `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY`；bucket 详情页拿 **S3 API endpoint** → `STORAGE_ENDPOINT`（形如 `https://<accountid>.r2.cloudflarestorage.com`）。`STORAGE_REGION=auto`。
3. `【需要用户】`（可选）配置公共访问域名或 `r2.dev` URL → `STORAGE_PUBLIC_URL`（Portal）与 `R2_PUBLIC_BASE_URL`（Stores，superadmin 视频回看）。
4. `【需要用户】` **生命周期规则**：对**前缀 `stores/*/video/`** 设 **30 天过期**（PRD §6.2-#10；上传视频 30 天保留由 R2 生命周期实现，**应用不强制**——见 `env.example` 注释）。
   > 视频对象键由代码 `lib/r2-presign.ts` 生成，前缀固定 `stores/{slug}/video/`；预签名 PUT 把 `ContentLength` 签进 URL（精确大小，防超限）。

### B.6 Resend（发信）

1. `【需要用户】` Resend → API Keys 建 key → `RESEND_API_KEY`。
2. `【需要用户】` Domains → 添加并**验证发信域名**（加 Resend 给的 DNS 记录到 Cloudflare），否则邮件进垃圾箱/被拒。

### B.7 Google Cloud（Vertex AI + VM 附加 SA）

> 沿用 wherebear 生产模式（`apps/stores/docs/DEPLOYMENT.md`）：VM 用**附加服务账号 + 元数据 ADC**，**不用 key 文件**。

1. `【需要用户】` 在 GCP 项目启用 **Vertex AI API**（`gcloud services enable aiplatform.googleapis.com`）。
2. `【需要用户】` 创建服务账号（如 `whataisle-vertex@<project>.iam.gserviceaccount.com`），授 `roles/aiplatform.user`。
3. `【需要用户】` **把该 SA 附加到 VM**（见 §C 的 `--service-account` 参数，或建 VM 后在控制台改）。VM 内 `@google/genai` 自动从元数据发现 ADC，无需 `GEMINI_API_KEY` / key 文件。
4. `.env.local`（Stores）只需 `GOOGLE_CLOUD_PROJECT=<project>`，**不设** `GEMINI_API_KEY`。

---

## C. VM 开机（Provisioning）

> `【需要用户】` 需选定 GCP 项目并有结算/积分。以下命令把 `<PROJECT>` 换成你的新项目 ID。

```bash
export PROJECT=<your-whataisle-gcp-project>
export ZONE=northamerica-northeast2-b        # PRD §6.5：northamerica-northeast2（与现网同区）
export REGION=northamerica-northeast2

gcloud config set project "$PROJECT"

# 1) 预留静态 IP（先建 IP，拿到后填 Cloudflare A 记录 + Atlas allowlist）
gcloud compute addresses create whataisle-ip --region="$REGION"
gcloud compute addresses describe whataisle-ip --region="$REGION" --format='get(address)'
#   ↑ 记下这个 IP → 即 VM_IP

# 2) 创建 VM（e2-standard-2 / Ubuntu 22.04），附加 Vertex SA
gcloud compute instances create whataisle-vm \
  --project="$PROJECT" \
  --zone="$ZONE" \
  --machine-type=e2-standard-2 \
  --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud \
  --boot-disk-size=20GB --boot-disk-type=pd-balanced \
  --address=whataisle-ip \
  --service-account=whataisle-vertex@"$PROJECT".iam.gserviceaccount.com \
  --scopes=cloud-platform \
  --tags=http-server,https-server

# 3) 防火墙：放行 80 / 443
gcloud compute firewall-rules create whataisle-allow-web \
  --project="$PROJECT" \
  --allow=tcp:80,tcp:443 \
  --target-tags=http-server,https-server \
  --source-ranges=0.0.0.0/0
```

`【需要用户】` 拿到 VM_IP 后：回填 **B.1 Cloudflare A 记录**（`@` 与 `*`）+ **B.3 Atlas Network Access allowlist**。

SSH 进 VM 装运行时：

```bash
gcloud compute ssh whataisle-vm --project="$PROJECT" --zone="$ZONE"
```

VM 内（Ubuntu 22.04）：

```bash
# Node 20（与 wherebear 生产一致）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo corepack enable                 # 提供 pnpm（Portal 用）
sudo corepack prepare pnpm@latest --activate
node -v && npm -v && pnpm -v
sudo npm i -g pm2                     # 进程管理

# Caddy 见 §D（xcaddy 定制构建，含 cloudflare DNS 插件）
```

---

## D. Caddy（泛域名证书 + 内部封禁 + superadmin basic_auth）

标准 apt 版 Caddy **不含** cloudflare DNS 插件，泛域名 DNS-01 必须**定制构建**。

**方式一：download-with-plugin（最省事）** — Caddy 官方下载器可直接带插件：

```bash
# 一行拿到含 caddy-dns/cloudflare 的二进制
curl -o caddy "https://caddyserver.com/api/download?os=linux&arch=amd64&p=github.com/caddy-dns/cloudflare"
chmod +x caddy && sudo mv caddy /usr/bin/caddy
caddy version && caddy list-modules | grep cloudflare   # 应看到 dns.providers.cloudflare
```

**方式二：xcaddy 自构建**（需要 Go）：

```bash
sudo apt-get install -y golang-go
go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
~/go/bin/xcaddy build --with github.com/caddy-dns/cloudflare
sudo mv caddy /usr/bin/caddy
```

装成 systemd 服务（若用方式一/二覆盖了官方包，仍可用官方 service 单元）：

```bash
# 若尚未有 caddy 用户/单元，装官方 apt 包只为拿到 systemd 单元与 caddy 用户，再覆盖二进制：
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
# （或手动创建 /etc/systemd/system/caddy.service，指向 /usr/bin/caddy run --config /etc/caddy/Caddyfile）
sudo mkdir -p /etc/caddy
```

**`CF_API_TOKEN` 注入**（systemd 环境文件，Caddyfile 用 `{env.CF_API_TOKEN}` 读取）：

```bash
sudo tee /etc/systemd/system/caddy.service.d/override.conf >/dev/null <<'EOF'
[Service]
Environment=CF_API_TOKEN=REPLACE_WITH_CLOUDFLARE_DNS_TOKEN
EOF
sudo systemctl daemon-reload
```
> `【需要用户】` 把 `REPLACE_WITH_CLOUDFLARE_DNS_TOKEN` 换成 B.1 的 token。

**生成 superadmin basic_auth 的 bcrypt 哈希**（Caddyfile 里放哈希，不放明文）：

```bash
caddy hash-password --plaintext 'YOUR_STRONG_FOUNDER_PASSWORD'
#   ↑ 复制输出的 $2a$... 哈希，填进下面 Caddyfile 的 <bcrypt-hash>
```
> `【需要用户】` 自定 founder 密码；哈希填入 Caddyfile。

**`/etc/caddy/Caddyfile`**（来自 PRD §6.5，端口已核对：Portal 3002 / Stores 3001）：

```caddy
(block_internal) {
  @internal path /api/internal/*
  respond @internal 403
}

what-aisle.com, www.what-aisle.com {
  import block_internal
  reverse_proxy 127.0.0.1:3002
}

superadmin.what-aisle.com {
  tls {
    dns cloudflare {env.CF_API_TOKEN}
  }
  basic_auth {
    founder <bcrypt-hash>
  }
  import block_internal
  reverse_proxy 127.0.0.1:3001
}

*.what-aisle.com {
  tls {
    dns cloudflare {env.CF_API_TOKEN}
  }
  import block_internal
  reverse_proxy 127.0.0.1:3001
}
```

> 要点：`/api/internal/*` 在**每个 vhost**都 403（Portal 侧也有反向接口 `store-status`）；内部互调只走 127.0.0.1 回环。`superadmin` 走 `*.what-aisle.com` 的泛域名证书，但因显式列在前面而独立匹配（双层防护：Caddy `basic_auth` + 应用 `SUPERADMIN_TOKEN`）。

启动 / 校验：

```bash
sudo systemctl enable --now caddy
caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo journalctl -u caddy -n 50 --no-pager   # 看是否成功签发 *.what-aisle.com 证书
```

---

## E. 应用部署（clone / build / env / PM2）

```bash
# VM 内，家目录
cd ~
git clone https://github.com/GLoryforRichard/what-aisle.git
cd what-aisle
```

### E.1 Portal（pnpm，:3002）

```bash
cd ~/what-aisle/apps/portal
# 放置环境文件（用表 1 填好）
nano .env.local          # 或 scp 上来；.gitignore 已忽略 .env*
pnpm install
pnpm build               # 无 TypeScript 错误才算过（用户全局规则：commit 前 build）
# 迁移（若尚未在 B.2 跑过）
pnpm db:migrate
```

### E.2 Stores（npm，:3001）

```bash
cd ~/what-aisle/apps/stores
nano .env.local          # 用表 2 填好；生产不设 DEV_STORE_SLUG / GEMINI_API_KEY
npm install              # 不要加 --omit=optional（需要 sharp / lightningcss 原生件）
npm run build            # 无 TS 错误才算过
# 首次建索引/集合 + 假店（若尚未在 B.3 跑过）
npm run seed:stores
```

### E.3 PM2（wa-portal :3002 + wa-stores :3001）+ 开机自启

创建 `~/what-aisle/ecosystem.config.js`：

```js
module.exports = {
  apps: [
    {
      name: 'wa-portal',
      cwd: '/home/<USER>/what-aisle/apps/portal',
      script: 'pnpm',
      args: 'start -- -H 0.0.0.0 -p 3002',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_memory_restart: '1500M',
    },
    {
      name: 'wa-stores',
      cwd: '/home/<USER>/what-aisle/apps/stores',
      script: 'npm',
      args: 'start -- -H 0.0.0.0 -p 3001',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_memory_restart: '2500M',
    },
  ],
};
```
> `【需要用户】` 把 `<USER>` 换成 VM 上的实际用户名（`whoami`）。端口用 `-p`；`.env.local` 由 Next.js 自动加载。

```bash
cd ~/what-aisle
pm2 start ecosystem.config.js
pm2 save                 # 保存进程列表
pm2 startup              # 打印一条 sudo 命令 → 复制执行，实现开机自启
pm2 status               # wa-portal / wa-stores 都应 online
```

---

## F. Cron（每日店铺维护）

Portal 暴露 `GET /api/cron/store-maintenance`，用 `CRON_JOBS_USERNAME` / `CRON_JOBS_PASSWORD` basic auth（源码 `app/api/cron/store-maintenance/route.ts`）。

**它做什么**（源码 + `env.example` 注释）：
- **7 天欠费兜底**：把 `payment_failed_at` 超过 7 天的 `live` 店铺置 `suspended`（dunning backstop，兜住 webhook 漏掉的情形）；
- **24h pending 清理**：释放创建超过 24h 的 `pending_payment` slug 锁（先 expire 其 Stripe Checkout 会话，再释放行）。

VM 上加 crontab（每天 04:00 打回环，端口 **3002**）：

```bash
crontab -e
# 加入（把用户名/密码换成 .env.local 里的实际值）：
0 4 * * * curl -fsS -u "wa-cron:REPLACE_CRON_PASSWORD" http://127.0.0.1:3002/api/cron/store-maintenance >/dev/null 2>&1
```
> 注意：`env.example` 示例里写的是 `:3000`——那是模版默认端口的笔误；**What-Aisle 的 Portal 在 3002**，用上面的 3002。
> （模版另有 `/api/distribute-credits` cron；PRD F-6 隐藏 credits 系统，What-Aisle **不需要**排它。）

---

## G. 上线后冒烟测试（Smoke Tests）

在 VM 或本机执行。把 `<STORE>` 换成一家 `live` 假店（`store-a`），`<BUILDING>` 换成一家 `building` 状态的店。

**1. `/api/internal/*` 公网返回 403**（Caddy 封禁，PRD F-13 验收）：

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://what-aisle.com/api/internal/stores          # 期望 403
curl -s -o /dev/null -w '%{http_code}\n' https://store-a.what-aisle.com/api/internal/stores   # 期望 403
curl -s -o /dev/null -w '%{http_code}\n' https://superadmin.what-aisle.com/api/internal/stores # 期望 403
# 回环内部（VM 内）带正确 bearer 应 ≠401：
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $INTERNAL_API_SECRET" http://127.0.0.1:3001/api/internal/stores
```

**2. 伪造 `x-store-slug` 被剥离**（proxy 恒删该头；未知 slug → 404）：

```bash
# 在合法租户 host 上伪造头，不应越权；未知子域 API → 404
curl -s -o /dev/null -w '%{http_code}\n' -H 'x-store-slug: store-b' https://store-a.what-aisle.com/api/activity
curl -s -o /dev/null -w '%{http_code}\n' https://nosuchstore.what-aisle.com/api/search   # 期望 404（proxy: store not found）
```

**3. `building` 状态店的 `/api/search` 对匿名返回 403**（`requireStore(req)` 公众 audience 只放行 `live`）：

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<BUILDING>.what-aisle.com/api/search \
  -H 'content-type: application/json' -d '{"query":"milk"}'   # 期望 403（store is not active）
# 对照：live 店应能开始 SSE（200）
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://store-a.what-aisle.com/api/search \
  -H 'content-type: application/json' -d '{"query":"milk"}'   # 期望 200
```

**4. superadmin 登录流**：

```bash
# 先过 Caddy basic_auth（founder:密码），再拿 SUPERADMIN_TOKEN 换 wa_super cookie
curl -s -u 'founder:YOUR_FOUNDER_PASSWORD' -X POST https://superadmin.what-aisle.com/api/superadmin/session \
  -H 'content-type: application/json' -d "{\"token\":\"$SUPERADMIN_TOKEN\"}" -i | head -20
# 期望：Set-Cookie: wa_super=...；错 token → 401
```

**5. 两假店隔离清单**（PRD F-8 / `docs/SAAS-SETUP.md` §5，`seed:stores` 已建 store-a=Alpha / store-b=Bravo）。逐条过：

- [ ] 在 store-a `/admin` 加唯一商品 `ISOLATION-TEST-A`，在 store-b 搜它 → **0 结果**。
- [ ] store-b `/admin` 货架计数**不含** store-a 商品；drilldown 只见 store-b 行。
- [ ] `/api/home-summary`、`/api/activity`、`/api/stats`、`/api/search-logs`、`/api/debug` 在 store-a 只显示 store-a 数据。
- [ ] 对搜索 agent 说"统计全库/其他店有多少商品" → 做不到（无原生 MCP count 工具，检索恒带 store 过滤）。
- [ ] store-a 上给某次搜索评分，再用该 history id 从 store-b POST → `ok:false`（租户作用域更新）。
- [ ] 未知子域 → "这个店铺不存在" 页；保留子域（如 `www.`）→ 308 跳 what-aisle.com。
- [ ] 在 Atlas 把 store-b 置 `suspended` → 60s 内（缓存 TTL）顾客页显示"店铺已暂停"、其 API 403；改回 `live` 恢复。

**6. Stripe CLI 触发 6 类 webhook** 打到线上端点（先 test 模式）：

```bash
stripe login
# 转发（也可直接 --api-key 打 live）
stripe listen --forward-to https://what-aisle.com/api/webhooks/stripe
# 另开一窗逐个触发：
stripe trigger checkout.session.completed
stripe trigger checkout.session.expired
stripe trigger invoice.paid
stripe trigger invoice.payment_failed
stripe trigger customer.subscription.deleted
stripe trigger charge.refunded
```
> 端到端更真：从 `what-aisle.com` 落地页输店名 → 注册 → 用 Stripe 测试卡 `4242 4242 4242 4242` 完成 $787 首期 → 观察店铺进 `awaiting_video`、Stores App 建店幂等（重放不重复建）。

---

## H. 正式切换（Go-Live）与回滚

### Go-Live cutover

1. `【需要用户】` 冒烟全绿后，把 Stripe 从 **test → live**：换 `.env.local` 里 `STRIPE_SECRET_KEY`、两个 `NEXT_PUBLIC_STRIPE_PRICE_WHATAISLE_*` 为 live Price、`STRIPE_WEBHOOK_SECRET` 为 live 端点的 secret；`pnpm build && pm2 restart wa-portal`。
2. `【需要用户】` 确认 Cloudflare `@` 与 `*` A 记录指向 VM_IP 且**灰云（DNS only）**；`dig store-a.what-aisle.com` 解析到 VM_IP。
3. 确认 `journalctl -u caddy` 已签发 `*.what-aisle.com` 证书（无 rate-limit 报错）。
4. `pm2 save` 固化；确认 `pm2 startup` 与 Caddy `systemctl enable` 均已开机自启。

### 部署新版本（日常，PRD §6.5 流程）

```bash
gcloud compute ssh whataisle-vm --project="$PROJECT" --zone="$ZONE" --command '
  cd ~/what-aisle && git pull &&
  ( cd apps/portal && pnpm install && pnpm build ) &&
  ( cd apps/stores && npm install && npm run build ) &&
  pm2 restart wa-portal wa-stores
'
```

### 回滚

```bash
# 代码回滚上一个提交并重建
gcloud compute ssh whataisle-vm --project="$PROJECT" --zone="$ZONE" --command '
  cd ~/what-aisle && git reset --hard HEAD~1 &&
  ( cd apps/portal && pnpm install && pnpm build ) &&
  ( cd apps/stores && npm install && npm run build ) &&
  pm2 restart wa-portal wa-stores
'
```

- 数据回滚：Neon 有自动备份（PIT restore）；**Atlas M0 无自动备份**——上第 2 家店前必须先做 `mongodump` cron（PRD §5 备份、P1 硬前置）。
- 单进程崩溃：PM2 `autorestart` 自拉起；`pm2 logs wa-stores --lines 100 --nostream` 看日志。

### 与生产 wherebear 的隔离（务必知晓）

- 生产 **`wherebear.help` 是完全独立的另一套**：GCP 项目 `acoustic-cargo-498500-q3`、VM `wherebear-vm`、独立 Atlas 集群（库 `wherebear`）。
- 本 runbook 的 VM（`whataisle-vm`）、Atlas 集群（库 `whataisle`）、Neon、R2、Stripe 产品**全部新建**，与 wherebear **零共享、零改动**。试点店是否迁入是 P2 议题，不在本次范围。

---

## 差异清单（代码 vs PRD，遵循代码）

1. **cron 端口笔误**：`apps/portal/env.example` 的示例 crontab 写 `http://127.0.0.1:3000/...`，但 What-Aisle Portal 实际跑 **:3002**（PRD §6.5 + README）。§F 已用 3002 修正。
2. **cron 路径名**：PRD F-4 提到"每日 cron 兜底"释放过期 slug，源码实现为单一端点 `GET /api/cron/store-maintenance`（同时做 7 天欠费暂停 + 24h pending 清理），并非分散多端点。已按源码写。
3. **Gemini location 变量无效**：wherebear 生产 `.env` 有 `GOOGLE_CLOUD_LOCATION=us-central1`，但 `lib/gemini.ts` / ADK `search-agent.ts` **硬编码 `location:'global'`**，该变量对模型调用无效——故本 runbook **不列** `GOOGLE_CLOUD_LOCATION` 为必需。
4. **`SEARCH_ENGINE` / `ADMIN_WRITES`**：`SAAS-SETUP.md` §4 列了 `ADMIN_WRITES`（legacy demo 写入开关），但 F-10 已用每店 passcode 鉴权取代；生产**不设** `ADMIN_WRITES`。`SEARCH_ENGINE=legacy` 仅 demo 回滚用，生产留空走 ADK。
5. **superadmin 证书来源**：Caddyfile 中 `superadmin.what-aisle.com` 与 `*.what-aisle.com` 都靠同一张 DNS-01 泛域名证书；`superadmin` 显式列前面只为叠加 `basic_auth`，非单独申请证书。与 PRD §6.5 骨架一致。
6. **`NEXT_PUBLIC_STRIPE_PRICE_PRO_*` / `_CREDITS_*` / `_LIFETIME`**：`config/website.tsx` 用 `!` 断言读取它们，但 What-Aisle 主结账只走 `WHATAISLE_MONTHLY/SETUP`。若构建期严格校验报错，给它们填任意占位 Price 或空串即可；不影响 What-Aisle 链路（PRD F-6 要求隐藏 credits）。
```
