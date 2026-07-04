# What-Aisle 产品需求文档（PRD）

| | |
|---|---|
| 产品名 | **What-Aisle**（what-aisle.com，域名已注册） |
| 版本 | v1.0（MVP 定义稿） |
| 日期 | 2026-07-03 |
| 作者 | Richard（创始人）× Claude |
| 状态 | 待评审 |

---

## 1. 产品概述

### 1.1 一句话定义

**把已验证的单店应用 Wherebear 改造成多租户 SaaS：任何超市付费后自动获得专属子域名（`店名.what-aisle.com`），顾客打开即可用 AI 搜索"某个商品在哪个货架"。**

### 1.2 背景

- **Wherebear**（wherebear.help）是黑客松产出的单店"找货"应用，已在一家真实超市**稳定运行 2 个月**，收录 13,000+ 商品，日常完美满足需求。核心能力：
  - 顾客免登录、多语言搜索商品 → 返回货架编号 + 平面图高亮（Gemini + MongoDB Atlas 向量搜索）；
  - 店员拍货架照片 → AI 自动识别商品并入库（Gemini 视觉两段式识别）。
- 这套能力对所有中小超市（尤其 ethnic 超市：商品名多语言、员工流动大、顾客问路成本高）是通用刚需，但 Wherebear 目前**单店硬编码**，无法复制。
- 已具备的商业化资产：**mksaas-template**（含 Stripe 支付、Better Auth、R2 存储、中英 i18n 的 Next.js SaaS 模版）、**Stripe 账户**（曾完成真实收款）、**GCP 免费积分**（Wherebear 已在 GCP VM 上运行，部署模式成熟）。

### 1.3 产品目标

| 目标 | 说明 |
|---|---|
| G1 | 超市从「进入官网」到「专属子域名上线」全流程线上化，创始人仅需人工介入一次（建店） |
| G2 | 复用 Wherebear 全部已验证功能（搜索、拍照入库、平面图），按店隔离，互不可见 |
| G3 | 单人可运营：开一家店的边际人工成本 ≤ 半天（看视频建货架表+平面图） |
| G4 | 基础设施月成本在 10 家店以内 ≤ $130（GCP 积分期内 ≈ $0，VM 与 Gemini 均为 GCP 服务、由积分覆盖） |

### 1.4 成功指标

- **北极星指标：付费在营门店数**（status = live 且订阅正常）
- 辅助指标：
  - 转化漏斗：落地页访问 → 店名查询 → 发起结账 → 支付成功 → 上传视频 → 上线（各环节转化率）
  - 单店顾客周搜索次数（衡量店内真实使用，< 20 次/周视为流失风险）
  - 付费到上线的中位时长（目标 ≤ 7 天）
  - 月流失率（订阅取消/欠费暂停）

### 1.5 非目标（本期不做）

- ❌ 店主自助建货架表/平面图（首次建店由创始人人工完成，见 1.3-G3）
- ❌ 自定义域名（`find.ethnicmarket.com` 之类，P2）
- ❌ 多店连锁账号体系（一个账号管多家店，P2）
- ❌ 商品库存/价格管理（只管"在哪"，不管"有没有/多少钱"）
- ❌ 原生 App（移动 Web 已够用，Wherebear 两个月实践验证）

---

## 2. 用户与角色

| 角色 | 是谁 | 用什么入口 | 核心诉求 |
|---|---|---|---|
| **创始人/运营者**（Richard） | 平台方，也是建店服务的执行者 | `superadmin.what-aisle.com`（建店台）+ Stripe/Atlas 控制台 | 低成本开店、状态一目了然、不被运维拖死 |
| **店主**（Buyer） | 中小超市老板，决策与付费者，技术能力弱 | `what-aisle.com` 门户（注册/付费/上传视频/看进度） | 花钱省心：付完钱按提示传个视频，等着上线 |
| **店员**（Operator） | 收银员/理货员，可能不会英语 | `店名.what-aisle.com/admin`（每店独立 passcode） | 拍照上架要快，密码简单（贴在收银台便签上那种） |
| **顾客**（End User） | 到店购物者，免登录 | `店名.what-aisle.com` | 输入/说出商品名 → 3 秒内知道在哪排货架 |

> 关键关系：**店主在门户有账号（邮箱注册），店员和顾客在子域名上没有账号**——店员用每店 passcode，顾客完全免登录。这是 Wherebear 验证过的最低摩擦模式。

---

## 3. 端到端用户流程

### 3.1 主流程（Happy Path）

```
① 访问 what-aisle.com 落地页
      │  看到产品演示（可放试点店真实截图/录屏）
② 输入超市名字 → 实时预览 "ethnic.what-aisle.com"
      │  仅展示 + 可用性检查（重名/保留字提示换一个），此时不创建任何资源
③ 注册账号（邮箱或 Google OAuth）→ 进入结账
      │  Stripe Checkout：$688 开店服务费（一次性）+ $99/月订阅，一张账单
④ 支付成功 → 店铺进入「待上传视频」状态
      │  自动发邮件：拍摄指引（绕店走一圈，货架通道逐排拍清楚）
⑤ 店主在门户后台上传店内布局视频（≤2GB，直传 R2，带进度条）
      │  状态 →「建设中」，同时邮件通知创始人（Discord/飞书 webhook 为可选增强）
⑥ 创始人看视频，在 superadmin 建店台人工创建：
      │  货架分类表（taxonomy）+ 平面图（SVG 矩形坐标）
⑦ 创始人点「Go Live」→ 状态 →「已上线」
      │  自动发邮件给店主：子域名链接 + 店铺管理 passcode + 使用指引
⑧ 日常使用：
      顾客 → ethnic.what-aisle.com 搜索找货（= Wherebear 顾客体验）
      店员 → ethnic.what-aisle.com/admin 拍货架照片更新商品（= Wherebear 管理体验）
```

### 3.2 状态机（店铺生命周期）

```
pending_payment ──(Stripe checkout.session.completed)──▶ awaiting_video
awaiting_video ──(视频上传成功)──▶ building
building ──(创始人点 Go Live)──▶ live
live ──(欠费 invoice.payment_failed，宽限 7 天)──▶ suspended
live ──(订阅取消 / superadmin 人工 Suspend，立即)──▶ suspended
suspended ──(invoice.paid 恢复)──▶ live
任意状态 ──(退款 charge.refunded / 主动注销)──▶ canceled（终态）
```

- `pending_payment` 在发起 Checkout 时创建（Postgres 内 slug 唯一约束防抢注），**24 小时未支付自动清理，释放 slug**（承接方见 F-4）。
- `suspended`（欠费超期/订阅取消/主动暂停）时子域名显示"店铺已暂停"页，**数据保留 90 天**，期间恢复付款即复原；90 天未恢复 → 自动转 `canceled` 并清除数据（P1 cron 承接）。退款等直接进入 `canceled` 的，同样 90 天后清除。

### 3.3 各状态的触达（邮件，Resend 发送）

| 触发 | 收件人 | 内容 |
|---|---|---|
| 支付成功 | 店主 | 收据 + 视频拍摄指引 + 后台链接 |
| 视频上传成功 | 创始人 | 新店待建（店名/slug/视频链接） |
| Go Live | 店主 | 子域名 + 管理 passcode + 店员使用指引（打印友好） |
| 扣款失败 | 店主 | 催缴（第 1/4/7 天三封，第 7 天后暂停）——**邮件自动化为 P1**，P0 仅计时+暂停+告警创始人 |
| 恢复付款 | 店主 | 已恢复上线 |

---

## 4. 功能需求

> 优先级标记：**P0** = 首家付费店上线必须有；P1 = 上线后 1 个月内；P2 = 之后。

### 4.1 门户（Portal，基于 mksaas-template，服务 what-aisle.com）

#### F-1 落地页 + 店名检查器 【P0】

- 落地页：产品价值主张 + 演示（截图/视频）+ 定价卡（$688 + $99/mo）+ 店名输入框（首屏主 CTA）。
- 店名检查器组件：
  - 输入店名 → 客户端实时 slugify → 预览 `xxx.what-aisle.com`（**仅展示，不创建**）；
  - debounce 调用可用性检查（server action）：正则 `^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$`（3–30 位）+ 保留字表 + Postgres 查重；
  - 不可用时给出原因与建议（"已被占用，试试 ethnic-market"）。
- 复用：mksaas 落地页组件体系、`actionClient`（`mksaas-template/src/lib/safe-action.ts`）。
- **验收**：输入中文/大写/带空格店名能正确 slugify；保留字（www/admin/api…）被拒；已占用 slug 被拒；预览与最终子域名一致。

#### F-2 注册/登录 【P0】

- 复用 mksaas Better Auth：邮箱+密码（需邮箱验证）、Google OAuth。GitHub OAuth 对超市老板无意义，隐藏。
- **验收**：注册→验证邮件→登录全流程可用；忘记密码可重置。

#### F-3 混合结账（$688 一次性 + $99/月，一个 Checkout） 【P0】

- Stripe Checkout `mode: 'subscription'`，`line_items` = [$99/mo 订阅 price] + [$688 一次性 price]（标准 setup-fee 模式，一次性项计入首期发票）——**已核实 Stripe 支持，且现有 `createCheckout`（`mksaas-template/src/payment/provider/stripe.ts`）仅支持单 line_item，需改造**。
- Checkout metadata 携带 `storeSlug`、`storeName`（同时写入 session 与 subscription metadata，webhook 两条路径都能取到）。
- 结账前在 Postgres 落 `pending_payment` 行锁定 slug。
- 支付成功页轮询开通状态（复用 mksaas `/payment` 轮询页模式）。
- **验收**：一次结账产生 $787 首期发票（$688+$99）+ 之后每月 $99 自动续订；Stripe Dashboard 可见订阅与 setup fee 分列；取消/重复支付不产生脏数据。

#### F-4 Stripe Webhook → 开通链路 【P0】

- 扩展现有 `/api/webhooks/stripe`：
  - `checkout.session.completed`（含 storeSlug metadata）→ Postgres 店铺行 → `awaiting_video`，调用 Stores App 内部 API 建店，发指引邮件；
  - `checkout.session.expired`（辅以每日 cron 兜底）→ 清理超 24h 的 `pending_payment` 行，**释放 slug**；
  - `invoice.payment_failed` → 催缴计时；连续失败 7 天 → `suspended` 并推送 Stores App（P0 仅做计时+暂停+创始人告警，三封催缴邮件自动化 P1 补齐）；
  - `invoice.paid`（欠费恢复）→ `live` 并推送；
  - `customer.subscription.deleted` → `suspended`（立即，无宽限；数据保留语义见 3.2）；
  - `charge.refunded`（全额退款）→ `canceled`（终态；90 天后清数据，清理 cron 列入 P1）。
- 内部 API 调用失败：重试 3 次 + webhook 告警通知创始人；**P1** 加每日对账 cron（Postgres ↔ Mongo 状态比对）。
- **验收**：用 Stripe CLI 逐一触发上述 6 类事件，状态机流转正确、幂等（重放事件不重复建店）；过期未支付的 slug 可被重新占用。

#### F-5 店主后台（Onboarding 仪表盘） 【P0】

- 路由：`(protected)/dashboard/store`，单店视图（一个账号一家店，多店 P2）。
- **状态进度条**：已付款 → 待上传视频 → 建设中 → 已上线 / 已暂停。
- **视频上传**：
  - 现有 `/api/storage/upload` 限 4MB（`src/lib/constants.ts:5`）且仅图片 MIME 白名单（`src/app/api/storage/upload/route.ts:33`），**不可用**；
  - 新建预签名 PUT 直传 R2：服务端签 URL（`@aws-sdk/s3-request-presigner`），客户端 XHR 直传显示进度，上限 2GB，仅视频 MIME；
  - 上传成功回调 → 状态 `building` → 邮件通知创始人；
  - 逃生门：提供"粘贴网盘链接"备选输入（大文件+店主手机网络不可靠）。
- **子域名卡片**（上线后显示）：`https://{slug}.what-aisle.com` 链接、店铺管理 passcode（支持一键重置，经内部 API）、店员指引 PDF 下载。
- **订阅管理**：复用 mksaas Stripe Customer Portal（改卡、看发票、取消）。
- **验收**：500MB 视频在普通家宽可传完且进度准确；断网重试不产生半截文件被误判；passcode 重置后旧码立即失效。

#### F-6 门户裁剪 【P0】

- 隐藏（不删代码）：credits 积分系统、AI tagline 示例、blog/docs 导航。
- i18n：面向北美店主，默认英文，保留中文（mksaas 自带 en/zh）。
- **验收**：导航无残留模版功能；`npm run build` 无错误。

### 4.2 店铺应用（Stores App，基于 wherebear 多租户化，服务 *.what-aisle.com）

#### F-7 子域名路由与店铺上下文 【P0】

- 新建 `proxy.ts`（Next.js 16 的 middleware 约定，参照 `mksaas-template/src/proxy.ts` 写法）：
  - 解析 Host → 提取 slug → 注入 `x-store-slug` 请求头（不做路由重写，现有 `app/` 结构不动）；
  - 保留字子域：`superadmin` 放行到建店台，其余（www/api/admin/mail…）308 跳转主站；
  - 非法 slug → 404 页。
- `lib/store-context.ts`：`getStoreBySlug()` 进程内缓存（TTL 60s，内部 API 写入时主动失效）；`requireStore()` 供 API 路由、`getStoreOrNull()` 供页面。
- 状态页：未知 slug →「店铺不存在，去 what-aisle.com 开通」；`awaiting_video`/`building` →「即将开业」（但 `/admin` 与 superadmin 可访问，供建店预览）；`suspended` →「店铺已暂停」；`canceled` →「店铺已关闭」（同未知 slug 引导开通）。
- 本地开发：支持 `slug.localhost:3001` 或 `DEV_STORE_SLUG` 环境变量。
- **验收**：两家假店 A/B 各自子域名互不串数据；未知子域名 404；suspended 店顾客页不可用但数据未删。

#### F-8 数据模型多租户化 【P0】

- 新建 `stores` 集合（新 Atlas 集群，库名 `whataisle`），字段：`slug`（唯一索引，不可变）、`name/name_zh`、`status`、`branding`（displayName/logoUrl/themeColor/defaultLocale）、`admin.passcodeHash`（bcrypt）、`shelves[]`（结构 = 现 `wherebear/lib/shelves.ts` 的 ShelfLocation）、`floorplan`（viewBox + rects[]，结构 = 现 `StoreMap.tsx` 的 SHELF_RECTS）、`billing`（portalUserId/stripeCustomerId/subscriptionId）、`video.r2Key`。
- 现有集合**共享 + `store_id` 字段**（= slug）隔离，不搞每店一库（**Atlas M0 限 3 个 Search 索引**，共享集合方案全租户共用 2 个索引；每店一库第二家店即超限）：
  - `products`：唯一索引改为 `{store_id, canonical_name}`；写路径改 `wherebear/lib/shelf-save.ts`（bulkWrite filter + `$setOnInsert` + 后台 alias 扩充二次写）与 `/api/admin/products*`；
  - `shelf_evidence`：`{store_id, timestamp}` 索引；
  - `search_history`：`{store_id, ts}` 索引，改 `wherebear/lib/ops.ts`；
  - `op_events`（用量/成本台账，`lib/ops.ts` 的 `logOp()`，search/vision/voice/identify/shelf-evidence 五条 API 路由都在写，`lib/cost.ts` 记录 Gemini/Voyage token）：同样加 `store_id`——这是后续**按店计量 AI 成本**的现成数据源；
  - 遗留 `search_logs`（仍被 `/api/activity`、`/api/debug`、`/api/health` 读取）：标记 legacy，读取方切到 `search_history` 并带 store_id 过滤。
- **向量搜索租户过滤**：新集群 `vector_index` 定义加 `{type:"filter", path:"store_id"}`；查询侧 `wherebear/lib/agents/tools-b.ts` 的 `$vectorSearch` 加 `filter:{store_id}`。`text_index` 显式映射 `store_id` 为 `token` 类型 + `equals` 过滤（不依赖 dynamic mapping 的模糊语义）。
- **store_id 注入路径（安全关键）**：ADK agent 是单例、工具参数由 LLM 生成——**绝不让 LLM 传 store_id**。用 Node `AsyncLocalStorage`（新建 `lib/tenant-context.ts`）在 `/api/search` 入口包裹，executor 内读取；短调用链（shelf-save、ops）走显式参数。
- **收紧 MCP 工具面**：`search-agent.ts` 的 MCPToolset allow-list 现状已收窄到仅 `['count']`（find/aggregate/list-collections 均未暴露），但 `count` 仍可带任意 filter **跨租户计数** → 移除它或替换为强制带 store_id 的应用层工具；检索一律走应用层 FunctionTool。
- **验收**：店 A 搜店 B 独有商品 0 结果；店 A 管理端看不到店 B 货架；对 agent 说"统计全库/其他店有多少商品"无法越权（`count` 已移除或强制注入 store_id）。

#### F-9 货架表与平面图数据驱动化 【P0】

- `lib/shelves.ts` 静态数组 → 从 `store.shelves` 读取（该文件被 7 处 import：`vision/route.ts`、`shelf-save.ts`、`tools-b.ts`、`ShelfAdmin.tsx`、`SnapScreen.tsx`、`StoreMapModal.tsx`、`agent-a.ts`，全部改造）。
- `StoreMap.tsx` 的 `SHELF_RECTS` + `CENTER_RECTS` **两个**像素坐标数组（高亮查找与渲染均取两者并集，另有硬编码默认 viewBox）→ 合并为 `store.floorplan.rects[]` props 驱动。
- 品牌：页面标题/logo/主题色从 `store.branding` 读取（Wherebear 熊 logo 变为默认占位）。
- **验收**：两家假店配不同货架表与平面图，各自页面渲染正确；搜索结果的货架编号与平面图高亮一致。

#### F-10 店铺管理端鉴权 【P0】

- **删除硬编码 passcode "2627"**（`wherebear/app/admin/page.tsx`，当前纯客户端校验，等于裸奔）。
- 方案：每店 6 位 passcode（bcrypt 存 `stores.admin.passcodeHash`）→ `POST /api/admin/session` 校验 → 签 HttpOnly HMAC cookie（30 天，作用域=当前子域，**跨店隔离天然成立**）；IP+slug 限流 5 次/分。
- `wherebear/lib/admin-guard.ts` 重写为 `requireStoreAdmin()`，覆盖所有写接口（`/api/shelf-evidence`、`/api/admin/products*`、`/api/vision`）与管理页面（`/admin`、`/dashboard`、`/searchlog`）。
- 选 passcode 而非门户 JWT 的理由：店员没有门户账号，passcode 可写在收银台便签上，符合小超市现实；门户负责重置即可控。
- **验收**：无 cookie 访问任何写接口 401；店 A 的 cookie 在店 B 子域无效；passcode 错 5 次被限流。

#### F-11 顾客搜索与店员拍照入库（存量能力按店隔离） 【P0】

- 顾客搜索、SSE 流式返回、双语回答、平面图高亮 —— 逻辑不变，仅数据按 `store_id` 隔离。
- 店员拍货架 → Gemini 识别 → 编辑确认 → 入库 —— 逻辑不变，落库带 `store_id`；移除 demo 硬编码（`SnapScreen.tsx` 的 `SAMPLE_SHELF='B10'`、首页 demo passcode 文案）。
- **验收**：与 wherebear.help 现网同等体验（搜索 P50 ≤ 5s，拍照入库 ≤ 30s/张）。

### 4.3 F-12 创始人建店台（superadmin，位于 Stores App） 【P0】

- 入口：`superadmin.what-aisle.com`，双层防护：Caddy vhost 级 `basic_auth` + 应用内 `SUPERADMIN_TOKEN`。
- 功能（MVP 最简可行）：
  1. **店铺列表**：全部店 + 状态 + 视频链接（R2）+ 状态流转按钮（Go Live / Suspend，触发反向同步门户 Postgres + 触达邮件）；
  2. **货架表编辑器**：JSON 编辑器（schema 校验：code 唯一、categories 为数组）+ 实时预览（复用 ShelfAdmin 下拉渲染）；从现 `lib/shelves.ts` 复制模板起步；
  3. **平面图编辑器**：rects JSON 编辑器 + 实时 `<StoreMap rects={...}/>` SVG 预览（F-9 props 化后免费获得）；可视化拖拽 P1；
  4. **passcode 重置**。
- **验收**：从看视频到店铺 live，全程只用建店台即可完成（不手写 DB）。

### 4.4 F-13 双应用集成（内部 API） 【P0】

- 方式：**内部 HTTP API + 共享密钥**（`Authorization: Bearer $INTERNAL_API_SECRET`，同机 127.0.0.1 回环互调；Caddy 在公网 vhost 对 `/api/internal/*` 一律 403）。否决共享数据库：门户保持纯 Postgres，Stores App 独占 Mongo schema 并顺手失效自身缓存。
- 职责边界：**门户/Postgres 是计费与状态的 source of truth；Stores App/Mongo 是运营配置（货架/平面图）的 source of truth**。计费驱动的状态变更由门户推送；建店台的人工流转（Go Live / Suspend）经 `store-status` 接口回传门户落账。
- 接口：
  - `POST /api/internal/stores`（建店，返回初始 passcode 明文一次）
  - `PATCH /api/internal/stores/:slug`（状态推送/passcode 重置/branding 更新）
  - `GET /api/internal/stores/:slug`（slug 占用兜底检查）
  - 反向：Stores App → 门户 `POST /api/internal/store-status`（Go Live/Suspend 同步）
- **验收**：公网直接请求 `/api/internal/*` 返回 403；密钥错误 401；建店幂等（重复调用不重复建）。

---

## 5. 非功能需求

| 类别 | 要求 |
|---|---|
| **租户隔离** | 任何查询/写入必须带 store 约束；数据访问收敛到少数 executor 文件 + `withStore()` 辅助函数约定；上线前用两家假店跑隔离测试清单（见 F-8/F-10 验收） |
| **性能** | 顾客搜索 P50 ≤ 5s / P95 ≤ 12s（与现网持平）；店铺页首屏 ≤ 2s；store 上下文缓存命中时路由开销 ≤ 5ms |
| **可用性** | 单 VM 单点可接受（MVP）；PM2 崩溃自拉起 + 开机自启；uptime 监控（UptimeRobot 免费档）P1 |
| **备份** | Postgres：Neon 自动备份；MongoDB：M0 无自动备份 → mongodump cron 到 GCS（P1，上第 2 家店前必须有） |
| **安全** | 全站 HTTPS（Caddy 自动）；内部 API 不出回环；passcode bcrypt；superadmin 双层防护；Stripe webhook 签名校验（模版已有）；视频 R2 桶不公开列目录 |
| **合规/隐私** | 顾客搜索不采集 PII（免登录）；搜索日志仅存 query 文本；店主数据删除请求 30 天内履行（canceled 后 90 天自动清） |
| **i18n** | 顾客端沿用 wherebear 手写 en/zh；门户沿用 next-intl en/zh；每店可设默认语言（branding.defaultLocale） |

---

## 6. 技术方案

### 6.1 架构总览

```
                      Cloudflare DNS（NS 迁入，仅解析不代理）
                A  what-aisle.com      → VM_IP
                A  *.what-aisle.com    → VM_IP
                            │
              ┌─────────────▼──────────────┐
              │  GCP VM: whataisle-vm      │
              │  e2-standard-2 (8GB)       │
              │                            │
              │  Caddy（定制构建，含       │
              │  caddy-dns/cloudflare）    │
              │  ├ what-aisle.com          │──▶ :3002 Portal（mksaas 改造）
              │  ├ *.what-aisle.com        │──▶ :3001 Stores App（wherebear 多租户版）
              │  ├ superadmin.… basic_auth │──▶ :3001 /superadmin
              │  └ 所有 vhost：            │
              │    /api/internal/* 公网403 │
              │                            │
              │  PM2: wa-portal, wa-stores │
              └────┬───────────────┬───────┘
                   │               │            127.0.0.1 内部 API（共享密钥）
             Neon Postgres    MongoDB Atlas M0（新集群，库 whataisle）
             （门户：用户/     （stores/products/shelf_evidence/
              订阅/店铺状态）    search_history，向量+全文索引×2）
                   │               │
              Stripe/Resend    Vertex AI Gemini（VM ADC）
              Cloudflare R2（布局视频 + P1 商品缩略图）
```

### 6.2 关键技术决定与理由

| # | 决定 | 理由（已核实） |
|---|---|---|
| 1 | 双应用不合并 | 两边样式体系（内联主题 vs Tailwind）、i18n（手写 vs next-intl）、Next 小版本均不同；合并改造量大、风险高，且 wherebear 两个月稳定性是最大资产 |
| 2 | 共享集合 + store_id，非每店一库 | Atlas M0 每集群限 3 个 Search 索引，共享方案全租户共用 vector_index + text_index 共 2 个 |
| 3 | 向量搜索租户过滤用 Atlas filter 字段 | Atlas Vector Search 支持索引内 `type:"filter"` 预过滤，auto-embedding 索引同样支持 |
| 4 | AsyncLocalStorage 注入 store_id | ADK agent 是懒加载单例、工具参数由 LLM 生成，靠 LLM 传租户 ID = 安全漏洞 |
| 5 | 泛域名证书（DNS-01）而非 on-demand TLS | 一张 `*.what-aisle.com` 证书覆盖所有店；on-demand 有首访握手延迟 + Let's Encrypt 速率限制。需 Caddy 定制构建（xcaddy --with github.com/caddy-dns/cloudflare）|
| 6 | 内部 HTTP API 而非共享 DB | 各自独占 schema 所有权；Stores App 写入时顺手失效自身缓存；回环调用无公网暴露 |
| 7 | Neon 而非 Supabase/本地 Postgres | Supabase 免费层闲置 7 天暂停项目（生产不可接受）；本地 Postgres 抢 VM 内存且备份自担；Neon 0.5GB 足够（门户数据个位数 MB），冷启动亚秒级可接受 |
| 8 | 新 VM 而非复用 wherebear-vm | 现网 e2-medium 4GB 已有 OOM 历史（Next + 每搜索一个 MCP 子进程）；不拿付费客户冒险；credits 覆盖新 VM 成本 |
| 9 | Stripe 一个 Checkout 混合计费 | `mode:'subscription'` 支持 line_items 混入一次性 price（标准 setup-fee 模式） |
| 10 | 视频预签名直传 R2 | 模版上传接口限 4MB 仅图片；R2 单 PUT 上限 ~5GiB，2GB 视频单 PUT 足够；免费层 10GB，30 天生命周期自动删 |

### 6.3 "自动开通子域名"的实现本质

**运维上零操作。** 泛解析 DNS + 泛域名证书天然覆盖任意 slug；「上线」= `stores.status` 翻成 `live` 这一行数据库变更（proxy 缓存 60s 内生效）。PRD 对外话术可承诺"建店完成后即时生效"。

### 6.4 改造涉及的关键文件清单

> 仓库：**`github.com/GLoryforRichard/what-aisle`**（monorepo，main 分支）。路径映射：`wherebear/` → **`apps/stores/`**，`mksaas/` → **`apps/portal/`**；下表沿用原名标注。生产 wherebear 原仓库保持不动。

| 文件 | 改造 |
|---|---|
| `wherebear/proxy.ts`（新建） | Host → slug 解析、保留字、头注入 |
| `wherebear/lib/store-context.ts`（新建） | store 加载 + 60s 缓存 + 状态页分发 |
| `wherebear/lib/tenant-context.ts`（新建） | AsyncLocalStorage 租户上下文 |
| `wherebear/lib/agents/tools-b.ts` | `$vectorSearch`/`$search` 注入 store 过滤 |
| `wherebear/lib/agents/adk/search-agent.ts` | 移除/改造 MCP `count` 工具（现 allow-list 仅剩它，可跨租户计数） |
| `wherebear/lib/shelf-save.ts`、`lib/ops.ts` | 写路径带 store_id |
| `wherebear/lib/shelves.ts` → 数据驱动 | 7 处 import 全改（vision/shelf-save/tools-b/ShelfAdmin/SnapScreen/StoreMapModal/agent-a） |
| `wherebear/components/StoreMap.tsx` | SHELF_RECTS + CENTER_RECTS → `floorplan.rects` props |
| `wherebear/components/SnapScreen.tsx`、`app/page.tsx`、`app/layout.tsx` | 移除 demo 硬编码（SAMPLE_SHELF='B10'、demo passcode 文案）与单店品牌（F-9/F-11） |
| `wherebear/app/admin/page.tsx`、`lib/admin-guard.ts` | 删 "2627"，改服务端 passcode+cookie 鉴权 |
| `wherebear/app/superadmin/*`（新建） | 建店台 |
| `wherebear/app/api/internal/*`（新建） | 内部 API |
| `mksaas/src/payment/provider/stripe.ts` | createCheckout 支持 extraLineItems（setup fee） |
| `mksaas/src/config/website.tsx` | whataisle 套餐（$99/mo + $688 setupFeePriceId）；F-6 裁剪（隐藏 credits/blog/docs 导航） |
| `mksaas/src/db/schema.ts` | 新增 stores 表（Drizzle） |
| `mksaas/src/app/api/webhooks/stripe`（扩展） | 开通/暂停/恢复链路 |
| `mksaas/src/components/whataisle/store-name-checker.tsx`（新建） | 店名检查器 |
| `mksaas/(protected)/dashboard/store/*`（新建） | Onboarding 仪表盘 + 预签名视频上传 |

### 6.5 环境与部署

- **VM**：`whataisle-vm`，e2-standard-2（2 vCPU/8GB），northamerica-northeast2（与现网同区），Ubuntu 22.04，静态 IP。
- **进程**：PM2 `wa-stores`（:3001）、`wa-portal`（:3002，standalone 构建）。
- **部署流**：沿用 wherebear 成熟模式——git push → SSH → `git pull && npm i && npm run build && pm2 restart`（P1 可加 GitHub Actions）。
- **Caddyfile 骨架**：

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
  tls { dns cloudflare {env.CF_API_TOKEN} }
  basic_auth { founder <bcrypt-hash> }
  import block_internal
  reverse_proxy 127.0.0.1:3001
}
*.what-aisle.com {
  tls { dns cloudflare {env.CF_API_TOKEN} }
  import block_internal
  reverse_proxy 127.0.0.1:3001
}
```

> 注意：`/api/internal/*` 在**每个 vhost** 都封禁（门户侧也有反向接口 `store-status`），内部互调只走 127.0.0.1 回环。

- **环境变量**：Stores App —— `MONGODB_URI`（新集群）/`MONGODB_DB=whataisle`/`GOOGLE_CLOUD_PROJECT`（Vertex 走 VM ADC）/`INTERNAL_API_SECRET`/`STORE_ADMIN_COOKIE_SECRET`/`SUPERADMIN_TOKEN`；Portal —— `DATABASE_URL`（Neon）/`BETTER_AUTH_SECRET`/`STRIPE_*`/`RESEND_API_KEY`/`STORAGE_*`（R2）/`INTERNAL_API_SECRET`。

### 6.6 容量规划（硬约束，影响排期）

- 实测：单店 13k 商品、缩略图内嵌 ~25KB/条 → **单店 ≈ 325MB，逼近 M0 512MB 上限**。
- 推论：
  - **P0 的新 M0 集群只能承载第 1 家店**；
  - **P1 必须完成缩略图外移 R2**（products 存 `thumbnail_url`，文档缩至 ~2KB → 单店 ~30MB → M0 理论可容 ~17 店，**保守按 12–13 店规划**，预留索引与其他集合空间）——这是上第 2 家店的**前置条件，不是优化项**；
  - 用量接近 400MB（约第 13 家店）时升 **Atlas Flex（~$8–30/mo，5GB）**，可容百店级。
- 现网 wherebear.help 保持独立集群不动，试点店是否迁入 P2 再定。

---

## 7. MVP 范围与分期

### P0 —— 第一家付费店上线（预计 21–22 个专注工作日，单人 + AI 编码工具）

| 工作项 | 估算 |
|---|---|
| wherebear 多租户化（stores 集合/proxy/store-context/三集合 store_id/新集群双索引/ALS 注入/MCP 收紧） | 5 天 |
| 货架表 + 平面图数据驱动化（7 处 import + props 化） | 2 天 |
| 店铺管理端服务端鉴权（passcode + cookie） | 1.5 天 |
| superadmin 建店台（列表/JSON 编辑器/预览/状态流转） | 2.5 天 |
| 门户裁剪 + 落地页 + 店名检查器 | 2 天 |
| 混合 Checkout + webhook + 内部 API 开通链路 | 2.5 天 |
| Onboarding 仪表盘 + R2 预签名视频直传 | 2 天 |
| 部署（VM/定制 Caddy/Cloudflare DNS/PM2/Neon/Stripe 生产配置） | 1.5–2 天 |
| 全链路演练（假店从付款到上线跑通）+ 修复 | 2 天 |

**P0 完成的定义（DoD）**：一家真实（或假）超市完成 ①付款 ②传视频 ③人工建店 ④子域名 live ⑤顾客搜到商品 ⑥店员拍照入库，且两店隔离测试清单全绿。

### P1（上线后 ~10–14 天）

缩略图外移 R2 + 存量迁移脚本（**上第 2 家店前置**）｜平面图可视化拖拽编辑器｜催缴/宽限自动化邮件（三封）｜canceled 后 90 天数据清理 cron｜Postgres↔Mongo 每日对账 cron｜店铺品牌主题（logo/色）｜按店 AI 用量告警/配额（基于 op_events）｜监控告警（uptime + PM2 日志外送）｜mongodump 备份 cron｜分片视频上传。

### P2

试点店（wherebear.help）迁入｜店主自助改货架表｜店铺数据周报（搜索热词/无结果词 → 选品洞察，可成增值卖点）｜自定义域名（CNAME + on-demand TLS）｜slug 改名｜一账号多店｜Atlas Flex 迁移｜多区域部署（非北美客户占比上升时）。

---

## 8. 成本与收入模型

### 8.1 月度基础设施成本（10 家店规模）

| 项目 | 成本 | 说明 |
|---|---|---|
| GCP VM e2-standard-2 | ~$50/mo | **积分期内 $0**；积分耗尽后计费 |
| Neon Postgres | $0 | 免费层 0.5GB，门户数据个位数 MB |
| MongoDB Atlas | $0 → $8–30/mo | M0 免费（缩略图外移后保守容 ~12–13 店）→ Flex |
| Cloudflare R2 | $0 | 免费层 10GB；视频 30 天生命周期删除 |
| Resend | $0 | 免费层 3,000 封/月，远超所需 |
| Gemini（Vertex） | 估 $1–5/店/月 | GCP 服务，**积分期同样由积分覆盖**；每搜索 1–2 次 flash 调用 + 拍照 2 段视觉调用；需实测校准 + 用量告警（P1 每店月配额） |
| **合计** | **积分期 ≈ $0；积分后 ≈ $60–130/mo（10 家店）** | |

### 8.2 单店经济模型

- 收入：$688 开店费（一次性）+ $99/mo；
- Stripe 手续费（2.9%+$0.30）：首期 $787 → ~$23.1；此后每月 $99 → ~$3.2；
- 变动成本：Gemini $1–5/店/月 + 人工建店 ≤ 0.5 天/店（一次性，$688 覆盖）；
- **毛利：≈ $91–95/店/月（>90%）**。积分期内固定基础设施 ≈ $0，**首家店即正现金流**；积分耗尽后按最坏情况 $130/mo 计，2 家店月毛利即可覆盖；10 家店 MRR $990。

### 8.3 定价页话术建议

$688 一次性 = "白手套开店服务"（我们看你的视频、为你建好全店货架地图）；$99/mo = 软件订阅（AI 搜索、店员拍照更新、子域名托管）。突出"你只需要拍一段视频"。

### 8.4 退款政策（已定 2026-07-03）

- **$688 开店费**：在**开始录入商品（该店首次调用 AI 识别 API）之前**可全额退款；一旦开始录入商品即不可退。
  - 判定标准（可程序化）：该店 `products` 集合无记录 且 `op_events` 无该店 vision/identify 调用 → 可退。
  - 退款窗口覆盖的状态：`awaiting_video`、`building`（尚未录入商品时）；`pending_payment` 未扣款无需退。
- **$99/月订阅**：随时可取消（Stripe Customer Portal 自助），当期已扣不退，取消后不再续扣。
- 操作方式（MVP）：Stripe Dashboard 人工退款 → `charge.refunded` webhook 自动将店铺置为 `canceled`（链路见 F-4，无需额外开发）。
- 对外话术：「在我们开始为你录入商品之前，随时可全额退款。」

### 8.5 税务与销售地域策略（已定方向 2026-07-04）

- **客户地域：全球**（获客渠道：邮件销售 + 电话销售 + SEO 并行），定价统一 **USD**。
- 关键事实：客户是企业（超市）→ 交易性质为 **B2B**，多数税区对 B2B 有反向征收（reverse charge）/免征机制，卖方代收义务远低于 B2C。
- MVP 配置策略（工程侧，正式注册/申报请咨询会计师）：
  1. Stripe Checkout 开启 **`tax_id_collection`**（收集企业税号，作为 B2B 判定与反向征收依据，尤其 EU VAT 号）；
  2. 开启 **Stripe Tax 阈值监控（monitoring）**：免费追踪各税区的注册义务阈值，未达阈值/未注册前**不代收税**；
  3. 首个注册义务大概率是**加拿大 GST/HST**：连续 4 个季度营收超 CAD $30,000（small supplier 门槛）时注册——约 25 家店规模才触及；
  4. 美国各州 economic nexus 阈值普遍 $100k/年或 200 笔交易——远期问题；EU 对 B2C 数字服务无起征点，但 B2B 提供 VAT 号即反向征收，MVP 只接受企业客户即可规避；
  5. Stripe Tax 提示达到任一税区阈值 → 注册该税区并开启代收。
- 全球客户的工程影响：单 VM（Toronto）先行，非北美店铺搜索延迟增加 ~0.3–0.5s，可接受；多区域部署列入 P2 观察项。

---

## 9. 风险与开放问题

### 9.1 风险（按严重度排序）

| # | 风险 | 缓解 |
|---|---|---|
| 1 | **跨租户数据泄漏**（漏一个 store_id filter 即串店） | 数据访问收敛到少数 executor 文件；`withStore()` 约定；MCP 工具面收紧；上线前双假店隔离测试清单；每次改动跑该清单 |
| 2 | **Atlas M0 容量**（单店 325MB） | 缩略图外移 R2 列为 P1 硬性前置（上第 2 家店之前完成） |
| 3 | Gemini 成本无租户计量 | `op_events` 台账（`lib/cost.ts` 已记录 token 用量）加 store_id 后即可按店出账；P1 加用量告警/配额 |
| 4 | 单进程多租户互相影响（一店高峰拖累全体） | e2-standard-2 缓解；长期进程池/队列（P2） |
| 5 | Next.js 16 为定制版本（"NOT the Next.js you know"） | proxy.ts 等约定以 `node_modules/next/dist/docs/` 为准，不凭记忆写 |
| 6 | 大视频上传失败率（店主手机网络） | 进度条 + 断点提示 + 网盘链接逃生门；P1 分片上传 |
| 7 | slug 抢注/商标词 | 保留字表 + building 状态天然是人工审核点 |
| 8 | 双 repo 各一份 slug 校验代码漂移 | 变更需同步两处；后续抽公共包 |
| 9 | webhook → 内部 API 链路故障导致付了钱没建店 | 重试 3 次 + 告警 + P1 每日对账 cron |
| 10 | 人工建店成为规模瓶颈 | MVP 接受（也是护城河/服务溢价）；P2 探索视频 AI 辅助建图 |

### 9.2 待验证（开发前 spike）

- [ ] Atlas 动态映射下 `$search` 对 `store_id` 的过滤语义（保险做法：显式 token mapping + equals）
- [ ] Atlas auto-embedding 免费层 token 配额（控制台核实）
- [ ] Neon 冷启动是否影响 Stripe webhook 时限（需 <10s，预计无碍）
- [ ] Caddy 定制构建在 Ubuntu 22.04 的 systemd 集成

### 9.3 待产品定义（不阻塞 P0 开发，上线前定）

- [x] **退款政策**：已定——开始录入商品（首次调用 AI 识别 API）前可全额退款，详见 8.4
- [x] **税务**：已定方向——全球 B2B 销售，Stripe Tax 阈值监控 + 税号收集，达阈值再注册代收，详见 8.5
- [x] 订阅暂停语义：已定——`suspended` 数据保留 90 天（保 slug），期间恢复即复原；90 天未恢复自动转 `canceled` 清数据（见 3.2）
- [x] 服务条款/隐私政策：MVP 直接用 mksaas 模版页（替换产品名/联系方式即可），后续再定制

---

## 附录 A：术语表

| 术语 | 含义 |
|---|---|
| Portal / 门户 | mksaas 改造的营销+账号+收费应用，what-aisle.com |
| Stores App / 店铺应用 | wherebear 多租户化后的应用，*.what-aisle.com |
| slug | 店铺子域名标识（如 `ethnic`），创建后不可变 |
| 建店 / Provisioning | 从付费到 live 的开通过程，含创始人人工建货架表+平面图 |
| taxonomy / 货架表 | 一家店的货架编号+描述+分类关键词清单 |
| superadmin / 建店台 | 创始人内部运营工具 |
