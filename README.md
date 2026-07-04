# What-Aisle

把超市"商品在哪个货架"查询做成 SaaS：超市付费后获得专属子域名（`店名.what-aisle.com`），顾客免登录用 AI 搜索找货，店员拍照更新商品。

## 仓库结构（monorepo，运行时双进程）

| 目录 | 说明 | 端口 |
|---|---|---|
| `apps/stores/` | 店铺应用（源自 wherebear，多租户化）：顾客搜索 + 店铺管理 + superadmin 建店台，服务 `*.what-aisle.com` | 3001 |
| `apps/portal/` | 门户（源自 mksaas-template）：营销页、注册、Stripe 收费、店主后台，服务 `what-aisle.com` | 3002 |
| `PRD.md` | 产品需求文档（v1.0） | |

## 技术栈速览

- **stores**：Next.js 16 + MongoDB Atlas（向量搜索）+ Gemini（Vertex AI）+ Google ADK
- **portal**：Next.js 16 + Drizzle + PostgreSQL（Neon）+ Better Auth + Stripe + Resend + R2
- **部署**：GCP VM + Caddy（泛域名证书）+ PM2，详见 PRD 6.5

## 开发

```bash
cd apps/stores && npm install && npm run dev   # 店铺应用，DEV_STORE_SLUG 模拟子域名
cd apps/portal && npm install && npm run dev   # 门户
```
