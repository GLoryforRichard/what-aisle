/**
 * Shared inline-style helpers for the superadmin console (PRD F-12) —
 * C-token based, matching the app's neo-brutalist look. Pure module,
 * client-safe.
 */

import type { CSSProperties } from 'react';
import { C, FONT, SHADOW } from '@/lib/theme';
import type { StoreStatus } from '@/lib/types';

export const superShell: CSSProperties = {
  minHeight: '100dvh',
  background: C.bg,
  color: C.text,
  fontFamily: FONT,
  padding: '34px 22px 90px',
  maxWidth: 1080,
  margin: '0 auto',
};

export const superCard: CSSProperties = {
  background: C.white,
  border: `1px solid ${C.border}`,
  borderRadius: 14,
  boxShadow: SHADOW,
  padding: '16px 18px',
};

const STATUS_COLORS: Record<StoreStatus, { fg: string; bg: string }> = {
  live: { fg: '#1a7f37', bg: '#e2f5e9' },
  building: { fg: C.accentDark, bg: C.accentBg },
  awaiting_video: { fg: C.primaryDark, bg: C.primarySofter },
  pending_payment: { fg: C.textMuted, bg: C.bgMuted },
  suspended: { fg: '#c62828', bg: '#fdecec' },
  canceled: { fg: C.textSoft, bg: C.bgMuted },
};

export function statusBadgeStyle(status: StoreStatus): CSSProperties {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.canceled;
  return {
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    color: c.fg,
    background: c.bg,
    border: `1px solid ${c.fg}33`,
    whiteSpace: 'nowrap',
  };
}

export function superBtn(kind: 'primary' | 'danger' | 'ghost' = 'primary'): CSSProperties {
  const base: CSSProperties = {
    padding: '7px 14px',
    fontSize: 13,
    fontWeight: 800,
    fontFamily: FONT,
    borderRadius: 9,
    border: `1px solid ${C.border}`,
    cursor: 'pointer',
  };
  if (kind === 'danger') return { ...base, background: '#fdecec', color: '#c62828' };
  if (kind === 'ghost') return { ...base, background: 'transparent', color: C.textMuted, border: `1px solid ${C.bgMuted}` };
  return { ...base, background: C.primary, color: '#fff', boxShadow: SHADOW };
}

export const superTextarea: CSSProperties = {
  width: '100%',
  minHeight: 260,
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  fontSize: 12.5,
  lineHeight: 1.5,
  padding: '10px 12px',
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  background: C.bg,
  color: C.text,
  resize: 'vertical',
  boxSizing: 'border-box',
};
