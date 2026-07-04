'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { C, FONT } from '@/lib/theme';
import Icon from './Icon';
import { useTranslation } from '@/lib/i18n';

/** Per-store passcodes are 6 digits (PRD F-10). */
const PASSCODE_LENGTH = 6;

interface PasscodeGateProps {
  cancelHref?: string;
  children: React.ReactNode;
}

/**
 * iPhone-style passcode gate — REAL auth since task #3: the entered code is
 * POSTed to /api/admin/session, which bcrypt-verifies it against
 * `stores.admin.passcodeHash` and sets a 30-day HttpOnly `wa_admin` cookie.
 * On mount a cheap GET /api/admin/session checks whether that cookie is
 * still valid, so staff don't re-enter the code for 30 days.
 */
export default function PasscodeGate({ cancelHref = '/', children }: PasscodeGateProps) {
  const { t } = useTranslation();
  const [unlocked, setUnlocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [entry, setEntry] = useState('');
  const [error, setError] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  // Existing-session probe (cookie is HttpOnly — only the server can tell).
  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/session', { method: 'GET' })
      .then(r => {
        if (!cancelled && r.ok) setUnlocked(true);
      })
      .catch(() => { /* offline → show the gate */ })
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);

  const submit = useCallback(async (code: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: code }),
      });
      if (res.ok) {
        setUnlocked(true);
        return;
      }
      setMessage(res.status === 429 ? t('passcode_rate_limited') : t('passcode_error'));
      setError(true);
      setTimeout(() => { setEntry(''); setError(false); }, 480);
    } catch {
      setMessage(t('err_generic'));
      setError(true);
      setTimeout(() => { setEntry(''); setError(false); }, 480);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [t]);

  const press = useCallback((d: string) => {
    if (busyRef.current) return;
    setError(false);
    setEntry(prev => {
      if (prev.length >= PASSCODE_LENGTH) return prev;
      const next = prev + d;
      // Defer the check one tick so the last dot paints before we react.
      if (next.length === PASSCODE_LENGTH) setTimeout(() => submit(next), 130);
      return next;
    });
  }, [submit]);

  const del = useCallback(() => {
    if (busyRef.current) return;
    setError(false);
    setEntry(prev => prev.slice(0, -1));
  }, []);

  // Physical keyboard: digits type, Backspace deletes.
  useEffect(() => {
    if (unlocked || !ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') press(e.key);
      else if (e.key === 'Backspace') del();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [unlocked, ready, press, del]);

  if (!ready) return null;            // avoid a flash of the locked UI
  if (unlocked) return <>{children}</>;

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

  return (
    <div style={{
      minHeight: '100dvh', background: C.bg, fontFamily: FONT,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '40px 24px',
    }}>
      <div style={{
        width: 58, height: 58, borderRadius: 29, background: C.primarySofter,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: C.primaryDark, marginBottom: 16,
      }}>
        <Icon name="settings" size={27} />
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: C.text, letterSpacing: -0.3 }}>
        {t('passcode_title')}
      </div>
      <div style={{ fontSize: 14, color: C.textMuted, marginTop: 4 }}>
        {t('passcode_hint')}
      </div>

      {/* Passcode dots */}
      <div style={{
        display: 'flex', gap: 14, margin: '28px 0 10px',
        animation: error ? 'shake 0.42s' : 'none',
        opacity: busy ? 0.55 : 1,
      }}>
        {Array.from({ length: PASSCODE_LENGTH }).map((_, i) => {
          const filled = i < entry.length;
          return (
            <div key={i} style={{
              width: 15, height: 15, borderRadius: 8,
              background: filled ? (error ? '#c33' : C.primary) : 'transparent',
              border: `2px solid ${error ? '#c33' : filled ? C.primary : C.border}`,
              transition: 'background .15s, border-color .15s',
            }} />
          );
        })}
      </div>

      {/* 401 / 429 / network feedback — reserve the line so the layout is stable */}
      <div style={{
        minHeight: 20, marginBottom: 12, fontSize: 13.5, fontWeight: 700,
        color: '#c33', textAlign: 'center',
      }}>
        {message ?? ''}
      </div>

      {/* Keypad */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 72px)', gap: 16, justifyContent: 'center' }}>
        {keys.map((k, i) => {
          if (k === '') return <div key={i} />;
          if (k === 'del') {
            return (
              <button key={i} onClick={del} aria-label="delete" style={keyBtnStyle(true)}>
                ⌫
              </button>
            );
          }
          return (
            <button key={i} onClick={() => press(k)} style={keyBtnStyle(false)}>
              {k}
            </button>
          );
        })}
      </div>

      <a href={cancelHref} style={{
        marginTop: 30, color: C.textSoft, fontSize: 13.5, fontWeight: 600, textDecoration: 'none',
      }}>
        {t('passcode_cancel')}
      </a>
    </div>
  );
}

function keyBtnStyle(isDel: boolean): React.CSSProperties {
  return {
    width: 72, height: 72, borderRadius: 36,
    background: isDel ? 'transparent' : C.white,
    border: `1px solid ${isDel ? 'transparent' : C.border}`,
    fontSize: isDel ? 24 : 28, fontWeight: 600, color: C.text,
    fontFamily: FONT, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: isDel ? 'none' : '0 1px 3px rgba(20,40,20,0.05)',
    WebkitUserSelect: 'none', userSelect: 'none',
  };
}
