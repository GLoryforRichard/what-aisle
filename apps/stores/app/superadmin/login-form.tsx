'use client';

/**
 * Superadmin token entry (PRD F-12). Rendered by every /superadmin page when
 * the `wa_super` cookie is absent/invalid. POSTs the token to
 * /api/superadmin/session; on success the cookie is set and we reload so the
 * server component re-renders with access.
 */

import { useState } from 'react';
import { C, FONT, SHADOW } from '@/lib/theme';
import { useTranslation } from '@/lib/i18n';
import LanguageToggle from '@/components/LanguageToggle';

export default function SuperLogin() {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !token.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/superadmin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      setError(res.status === 429 ? t('sa_login_rate_limited') : t('sa_login_error'));
    } catch {
      setError(t('err_generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: '100dvh', background: C.bg, fontFamily: FONT,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '40px 24px',
    }}>
      <form onSubmit={submit} style={{
        width: '100%', maxWidth: 360, background: C.white,
        border: `1px solid ${C.border}`, borderRadius: 16, boxShadow: SHADOW,
        padding: '26px 24px', display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.text, letterSpacing: -0.3 }}>
            {t('sa_login_title')}
          </div>
          <LanguageToggle />
        </div>
        <div style={{ fontSize: 13.5, color: C.textMuted }}>{t('sa_login_hint')}</div>
        <input
          type="password"
          value={token}
          onChange={e => { setToken(e.target.value); setError(null); }}
          autoFocus
          autoComplete="off"
          style={{
            padding: '10px 12px', fontSize: 15, fontFamily: FONT,
            border: `1px solid ${C.border}`, borderRadius: 10, background: C.bg,
            color: C.text, outline: 'none',
          }}
        />
        {error && (
          <div style={{ fontSize: 13, fontWeight: 700, color: '#c33' }}>{error}</div>
        )}
        <button
          type="submit"
          disabled={busy || !token.trim()}
          style={{
            padding: '10px 14px', fontSize: 15, fontWeight: 800, fontFamily: FONT,
            background: C.primary, color: '#fff', border: `1px solid ${C.border}`,
            borderRadius: 10, cursor: busy ? 'default' : 'pointer',
            opacity: busy || !token.trim() ? 0.6 : 1, boxShadow: SHADOW,
          }}
        >
          {t('sa_login_submit')}
        </button>
      </form>
    </div>
  );
}
