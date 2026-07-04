'use client';

/**
 * Superadmin store list UI (PRD F-12): every store with status badge, product
 * count and manual lifecycle actions (Go Live / Suspend / Reactivate).
 * Actions PATCH /api/superadmin/stores/:slug — the route updates Mongo,
 * busts the tenant cache and syncs the portal ledger fire-and-forget.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { C, FONT, SHADOW } from '@/lib/theme';
import { useTranslation } from '@/lib/i18n';
import LanguageToggle from '@/components/LanguageToggle';
import type { StoreStatus } from '@/lib/types';
import { statusBadgeStyle, superShell, superCard, superBtn } from './ui';

export interface StoreRow {
  slug: string;
  displayName: string;
  status: StoreStatus;
  products: number;
  updatedAt: string | null;
  videoUrl: string | null;
}

/** Manual actions available per current status. */
function actionFor(status: StoreStatus): { target: StoreStatus; labelKey: 'sa_go_live' | 'sa_suspend' | 'sa_reactivate'; confirmKey: 'sa_confirm_go_live' | 'sa_confirm_suspend' | 'sa_confirm_reactivate' } | null {
  switch (status) {
    case 'building': return { target: 'live', labelKey: 'sa_go_live', confirmKey: 'sa_confirm_go_live' };
    case 'live': return { target: 'suspended', labelKey: 'sa_suspend', confirmKey: 'sa_confirm_suspend' };
    case 'suspended': return { target: 'live', labelKey: 'sa_reactivate', confirmKey: 'sa_confirm_reactivate' };
    default: return null;
  }
}

export default function StoreListClient({ rows }: { rows: StoreRow[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAction = async (row: StoreRow) => {
    const action = actionFor(row.status);
    if (!action || pending) return;
    if (!confirm(t(action.confirmKey, row.slug))) return;
    setPending(row.slug);
    setError(null);
    try {
      const res = await fetch(`/api/superadmin/stores/${encodeURIComponent(row.slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: action.target }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`${t('sa_action_failed')}: ${(data as { error?: string }).error ?? res.status}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(`${t('sa_action_failed')}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPending(null);
    }
  };

  const logout = async () => {
    await fetch('/api/superadmin/session', { method: 'DELETE' }).catch(() => {});
    window.location.reload();
  };

  return (
    <div style={superShell}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, letterSpacing: -0.6 }}>
            {t('sa_title')} · {t('sa_stores')}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <LanguageToggle />
          <button onClick={logout} style={superBtn('ghost')}>{t('sa_logout')}</button>
        </div>
      </div>

      {error && (
        <div style={{
          marginBottom: 14, padding: '10px 12px', background: '#fee',
          border: '1px solid #fcc', borderRadius: 10, color: '#933',
          fontSize: 13.5, fontWeight: 600,
        }}>
          {error}
        </div>
      )}

      <div style={{ ...superCard, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: `2px solid ${C.border}` }}>
              {[t('sa_col_store'), t('sa_col_status'), t('sa_col_products'), t('sa_col_updated'), t('sa_col_video'), t('sa_col_actions')].map(h => (
                <th key={h} style={{ padding: '12px 14px', fontSize: 12.5, fontWeight: 800, color: C.textMuted, whiteSpace: 'nowrap' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '22px 14px', color: C.textMuted }}>{t('sa_no_stores')}</td>
              </tr>
            )}
            {rows.map(row => {
              const action = actionFor(row.status);
              return (
                <tr key={row.slug} style={{ borderBottom: `1px solid ${C.bgMuted}` }}>
                  <td style={{ padding: '12px 14px' }}>
                    <a href={`/superadmin/${row.slug}`} style={{ color: C.text, fontWeight: 800, textDecoration: 'none' }}>
                      {row.slug}
                    </a>
                    <div style={{ fontSize: 12.5, color: C.textMuted }}>{row.displayName}</div>
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    <span style={statusBadgeStyle(row.status)}>{row.status}</span>
                  </td>
                  <td style={{ padding: '12px 14px', fontVariantNumeric: 'tabular-nums' }}>{row.products}</td>
                  <td style={{ padding: '12px 14px', fontSize: 12.5, color: C.textMuted, whiteSpace: 'nowrap' }}>
                    {row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '—'}
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    {row.videoUrl ? (
                      <a href={row.videoUrl} target="_blank" rel="noreferrer" style={{ color: C.primaryDark, fontWeight: 700 }}>
                        {t('sa_col_video')} ↗
                      </a>
                    ) : (
                      <span style={{ color: C.textSoft }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                    {action && (
                      <button
                        onClick={() => runAction(row)}
                        disabled={pending !== null}
                        style={{
                          ...superBtn(action.target === 'suspended' ? 'danger' : 'primary'),
                          opacity: pending && pending !== row.slug ? 0.5 : 1,
                        }}
                      >
                        {pending === row.slug ? '…' : t(action.labelKey)}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
