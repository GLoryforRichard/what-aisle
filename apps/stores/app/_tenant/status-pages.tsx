/**
 * Tenant status pages (PRD F-7) — shown instead of the app when a subdomain
 * has no store, or the store isn't in a status the visitor may see.
 *
 * Server components rendered before any client i18n exists, so each page is
 * statically bilingual (中文 + English) instead of using lib/i18n.ts.
 * Visual language mirrors lib/theme.ts (cream bg, hard black borders,
 * offset shadow).
 */

import { C, FONT, SHADOW } from '@/lib/theme';

const PORTAL_URL = 'https://whataisle.com';

function StatusShell({
  emoji,
  titleZh,
  titleEn,
  bodyZh,
  bodyEn,
  cta,
}: {
  emoji: string;
  titleZh: string;
  titleEn: string;
  bodyZh: string;
  bodyEn: string;
  cta?: { href: string; labelZh: string; labelEn: string };
}) {
  return (
    <div style={{
      minHeight: '100dvh', background: C.bg, color: C.text, fontFamily: FONT,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        maxWidth: 420, width: '100%', background: C.white,
        border: `2px solid ${C.border}`, borderRadius: 20, boxShadow: SHADOW,
        padding: '32px 28px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 44, lineHeight: 1 }}>{emoji}</div>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.5, margin: '16px 0 0' }}>
          {titleZh}
        </h1>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.textMuted, marginTop: 4 }}>
          {titleEn}
        </div>
        <p style={{ fontSize: 14.5, color: C.textMuted, lineHeight: 1.6, margin: '14px 0 0', fontWeight: 500 }}>
          {bodyZh}
          <br />
          {bodyEn}
        </p>
        {cta && (
          <a href={cta.href} style={{
            display: 'inline-block', marginTop: 20, padding: '13px 22px',
            background: C.primary, color: C.text, border: `2px solid ${C.border}`,
            borderRadius: 14, fontSize: 15, fontWeight: 800, textDecoration: 'none',
            boxShadow: SHADOW,
          }}>
            {cta.labelZh} · {cta.labelEn}
          </a>
        )}
        <div style={{ marginTop: 22, fontSize: 12, color: C.textSoft, fontWeight: 600 }}>
          Powered by What-Aisle
        </div>
      </div>
    </div>
  );
}

/** Unknown slug / no store document. */
export function TenantNotFound() {
  return (
    <StatusShell
      emoji="🧭"
      titleZh="这个店铺不存在"
      titleEn="This store doesn't exist"
      bodyZh="想让你的超市拥有这样的找货页面？去 whataisle.com 开通。"
      bodyEn="Want a page like this for your own store? Set one up at whataisle.com."
      cta={{ href: PORTAL_URL, labelZh: '去开通', labelEn: 'Open your store' }}
    />
  );
}

/** awaiting_video / building — paid but not live yet. */
export function TenantPending() {
  return (
    <StatusShell
      emoji="🚧"
      titleZh="即将开业"
      titleEn="Coming soon"
      bodyZh="这家店铺正在搭建中，很快就能在这里找到商品位置。"
      bodyEn="This store is being set up — item search will be available here soon."
    />
  );
}

/** suspended — billing lapse or manual suspension; data retained 90 days. */
export function TenantSuspended() {
  return (
    <StatusShell
      emoji="⏸️"
      titleZh="店铺已暂停"
      titleEn="This store is paused"
      bodyZh="该店铺服务暂时不可用，请稍后再来。"
      bodyEn="Service for this store is temporarily unavailable. Please check back later."
    />
  );
}

/** canceled — terminal state; same "open your own" nudge as not-found. */
export function TenantClosed() {
  return (
    <StatusShell
      emoji="🚪"
      titleZh="店铺已关闭"
      titleEn="This store has closed"
      bodyZh="想让你的超市拥有这样的找货页面？去 whataisle.com 开通。"
      bodyEn="Want a page like this for your own store? Set one up at whataisle.com."
      cta={{ href: PORTAL_URL, labelZh: '去开通', labelEn: 'Open your store' }}
    />
  );
}
