'use client';

import { useEffect, useState, useCallback } from 'react';
import type { ShelfLocation } from '@/lib/shelves';
import { useStoreConfig } from '@/lib/store-config-client';
import { useTranslation } from '@/lib/i18n';
import { C, FONT, SHADOW } from '@/lib/theme';
import Icon from './Icon';

interface AdminProduct {
  _id: string;
  canonical_name: string;
  aliases: string[];
  category?: string;
  latest_aisle: string;
  evidence_count: number;
  updated_at?: string;
  // Allow arbitrary extra fields (search_text, created_at, etc.) so the
  // raw-JSON drilldown can show everything the API actually returns.
  [key: string]: unknown;
}

const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
};

/** Shape the API accepts for create/edit. Store is scoped server-side —
 * the client must NOT send store_id. Note the server parses `latest_aisle`
 * (not `aisle`) as the shelf field. */
interface ProductWrite {
  canonical_name: string;
  aliases?: string[];
  category?: string;
  latest_aisle: string;
}

export default function ShelfAdmin({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  // Per-store shelf taxonomy (data-driven — no hardcoded shelf list).
  const { config, error: configError, retry: retryConfig } = useStoreConfig();
  const shelves = config?.shelves ?? [];
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [items, setItems] = useState<AdminProduct[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Set once a write returns 401 (cookie expired / absent). PasscodeGate owns
  // re-auth, so we surface a bilingual banner and offer a reload to trigger it.
  const [sessionExpired, setSessionExpired] = useState(false);
  // Transient inline error from a write that failed (non-2xx / network).
  const [writeError, setWriteError] = useState<string | null>(null);

  const loadCounts = useCallback(() => {
    fetch('/api/admin/products', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(d => { if (d.ok) setCounts(d.counts); });
  }, []);

  const loadShelf = useCallback((code: string) => {
    setLoading(true);
    setError(null);
    fetch(`/api/admin/products?aisle=${encodeURIComponent(code)}`, { credentials: 'same-origin' })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) setError(d.error || 'load failed');
        else setItems(d.products);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => {
    if (active) loadShelf(active);
    else setItems(null);
  }, [active, loadShelf]);

  // Re-GET the affected shelf's rows AND the per-shelf counts so the UI mirrors
  // the DB after any write. Passing an explicit code lets callers refresh a
  // shelf other than the one currently open (e.g. a create on a different aisle).
  const reconcile = useCallback((code?: string | null) => {
    loadCounts();
    const c = code ?? active;
    if (c && c === active) loadShelf(c);
  }, [loadCounts, loadShelf, active]);

  // Central error mapper: 401 → session-expired banner; anything else → inline
  // bilingual write error. Returns true when the caller should treat it as a
  // hard failure (used to roll back optimistic UI).
  const handleWriteFailure = useCallback((status: number, body?: { error?: string }) => {
    if (status === 401 || status === 403) {
      setSessionExpired(true);
    } else {
      setWriteError(body?.error || t('shelf_admin_err_write'));
    }
  }, [t]);

  const onDelete = async (p: AdminProduct) => {
    if (!confirm(t('shelf_admin_confirm_delete', p.canonical_name))) return;
    setWriteError(null);
    // Optimistic remove; snapshot for rollback.
    const prevItems = items;
    setItems(prev => (prev ? prev.filter(x => x._id !== p._id) : prev));
    try {
      const res = await fetch(`/api/admin/products/${encodeURIComponent(p._id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setItems(prevItems);           // rollback
        handleWriteFailure(res.status, body);
        return;
      }
      reconcile(active);
    } catch (e) {
      setItems(prevItems);             // rollback
      setWriteError(String(e));
    }
  };

  const onClearShelf = async (code: string, currentCount: number) => {
    if (currentCount === 0) return;
    if (!confirm(t('shelf_admin_confirm_clear', currentCount, code))) return;
    setWriteError(null);
    const prevItems = items;
    const wasActive = active === code;
    if (wasActive) { setItems([]); setExpandedId(null); }
    try {
      const res = await fetch(`/api/admin/products?aisle=${encodeURIComponent(code)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (wasActive) setItems(prevItems); // rollback
        handleWriteFailure(res.status, body);
        return;
      }
      reconcile(code);
    } catch (e) {
      if (wasActive) setItems(prevItems);   // rollback
      setWriteError(String(e));
    }
  };

  // Create (no _id) → POST; edit → PATCH. Resolves true on success so the modal
  // can close; false leaves it open with its own inline error shown. The store
  // is scoped server-side, so we never send store_id.
  const onSave = async (patch: ProductWrite, id: string): Promise<boolean> => {
    setWriteError(null);
    const isNew = !id;
    try {
      const res = await fetch(
        isNew ? '/api/admin/products' : `/api/admin/products/${encodeURIComponent(id)}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        handleWriteFailure(res.status, body);
        return false;
      }
      // Reconcile the shelf the product now lives on (may differ from `active`).
      reconcile(patch.latest_aisle);
      return true;
    } catch (e) {
      setWriteError(String(e));
      return false;
    }
  };

  return (
    <div style={{ minHeight: '100dvh', background: C.bg, color: C.text, fontFamily: FONT, padding: '62px 20px 80px' }}>
      <button onClick={onBack} style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        background: 'transparent', border: 'none', cursor: 'pointer',
        color: C.textMuted, fontFamily: FONT, fontSize: 15, fontWeight: 600,
        padding: '4px 10px 4px 0', marginBottom: 4, marginLeft: -2,
      }}>
        <Icon name="back" size={20} /> {t('shelf_admin_back_workspace')}
      </button>
      <div style={{ paddingTop: 4, marginBottom: 18 }}>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: 0, letterSpacing: -0.8 }}>{t('shelf_admin_title')}</h1>
        <p style={{ color: C.textMuted, fontSize: 15, margin: '6px 0 0', fontWeight: 500 }}>
          {t('shelf_admin_subtitle')}
        </p>
      </div>

      {/* Session expired (401/403) — PasscodeGate owns re-auth, so we surface a
          bilingual banner and offer a reload to re-run the gate's cookie probe. */}
      {sessionExpired && (
        <div style={{
          marginBottom: 16, padding: '10px 12px',
          background: '#fee', border: '1px solid #fcc', borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          fontSize: 13.5, color: '#933', fontWeight: 600,
        }}>
          <span>{t('shelf_admin_session_expired')}</span>
          <button onClick={() => window.location.reload()} style={{
            background: C.white, border: `1px solid ${C.border}`, borderRadius: 8,
            padding: '4px 12px', fontSize: 12.5, fontWeight: 700, color: C.text,
            cursor: 'pointer', fontFamily: FONT, flexShrink: 0,
          }}>{t('shelf_admin_reauth')}</button>
        </div>
      )}

      {/* Transient write error (non-2xx / network) — dismissible. */}
      {writeError && !sessionExpired && (
        <div
          onClick={() => setWriteError(null)}
          style={{
            marginBottom: 16, padding: '10px 12px',
            background: '#fee', border: '1px solid #fcc', borderRadius: 12,
            fontSize: 13.5, color: '#933', fontWeight: 600, cursor: 'pointer',
          }}
        >
          {t('shelf_admin_err_write')}
        </div>
      )}

      {configError && !config && (
        <div style={{
          marginBottom: 16, padding: '10px 12px',
          background: '#fee', border: '1px solid #fcc', borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          fontSize: 13.5, color: '#933', fontWeight: 600,
        }}>
          <span>{t('config_load_error')}</span>
          <button onClick={retryConfig} style={{
            background: C.white, border: `1px solid ${C.border}`, borderRadius: 8,
            padding: '4px 12px', fontSize: 12.5, fontWeight: 700, color: C.text,
            cursor: 'pointer', fontFamily: FONT, flexShrink: 0,
          }}>{t('config_retry')}</button>
        </div>
      )}

      {/* Shelf grid — hidden once you drill into a shelf */}
      {!active && (
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: 10,
        marginBottom: 20,
      }}>
        {shelves.map(s => {
          const c = counts?.[s.code] ?? 0;
          return (
            <div
              key={s.code}
              onClick={() => setActive(s.code)}
              style={{
                position: 'relative',
                padding: '10px 12px',
                background: c > 0 ? C.primarySofter : C.white,
                color: C.text,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 12,
                lineHeight: 1.3,
                boxShadow: SHADOW,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ ...mono, fontWeight: 800, fontSize: 13.5 }}>{s.code}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    ...mono, fontSize: 11, fontWeight: 700,
                    background: c > 0 ? C.primary : C.bgMuted,
                    color: c > 0 ? '#fff' : C.textMuted,
                    padding: '1px 7px', borderRadius: 999,
                  }}>{c}</span>
                  {c > 0 && (
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        onClearShelf(s.code, c);
                      }}
                      title={t('shelf_admin_clear_title', c, s.code)}
                      aria-label={t('shelf_admin_clear_title', c, s.code)}
                      style={{
                        background: 'transparent',
                        border: '1px solid #e5484d',
                        color: '#e5484d',
                        borderRadius: 6,
                        padding: '1px 7px',
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: 'pointer',
                        lineHeight: 1.2,
                        fontFamily: FONT,
                      }}
                    >
                      {t('shelf_admin_clear')}
                    </button>
                  )}
                </div>
              </div>
              <div style={{
                fontSize: 11, color: C.textMuted, marginTop: 3,
                overflow: 'hidden', textOverflow: 'ellipsis',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              }}>{s.description}</div>
            </div>
          );
        })}
      </div>
      )}

      {active && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setActive(null)}
              style={{
                background: C.white, border: `1px solid ${C.border}`, borderRadius: 10,
                padding: '6px 13px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                fontFamily: FONT, color: C.text,
              }}
            >← {t('shelf_admin_back_shelves')}</button>
            <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0, flex: 1 }}>
              <span style={mono}>{active}</span> · {t('shelf_admin_products_n', items?.length ?? 0)}
            </h2>
            <button
              onClick={() => setEditing({ _id: '', canonical_name: '', aliases: [], category: '', latest_aisle: active, evidence_count: 1 } as AdminProduct)}
              style={{
                background: C.primary, color: C.text, border: `2px solid ${C.border}`, borderRadius: 10,
                padding: '6px 13px', fontSize: 13, fontWeight: 800, cursor: 'pointer',
                fontFamily: FONT, boxShadow: SHADOW,
              }}
            >+ {t('shelf_admin_add')}</button>
            <button
              onClick={() => loadShelf(active)}
              style={{
                background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 10,
                padding: '6px 11px', fontSize: 12, cursor: 'pointer',
                fontFamily: FONT, color: C.textMuted, fontWeight: 600,
              }}
            >{t('shelf_admin_refresh')}</button>
          </div>
          {loading && <div style={{ color: C.textMuted, fontSize: 14 }}>{t('shelf_admin_loading')}</div>}
          {error && <pre style={{ ...mono, color: '#e5484d' }}>{error}</pre>}
          {items && items.length === 0 && !loading && (
            <div style={{ color: C.textMuted, padding: 24, textAlign: 'center', background: C.bgMuted, borderRadius: 14, fontSize: 14 }}>
              {t('shelf_admin_empty')}
            </div>
          )}
          {items && items.length > 0 && (
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', boxShadow: SHADOW }}>
              {items.map((p, i) => {
                const isOpen = expandedId === p._id;
                return (
                  <div key={p._id} style={{ borderTop: i ? `1px solid ${C.border}` : 'none' }}>
                    <div
                      onClick={() => setExpandedId(isOpen ? null : p._id)}
                      style={{
                        display: 'flex', gap: 10, alignItems: 'flex-start',
                        padding: '11px 13px', cursor: 'pointer',
                        background: isOpen ? C.primarySofter : 'transparent',
                      }}
                    >
                      <span style={{
                        color: C.textSoft, fontSize: 11, marginTop: 4, flexShrink: 0, width: 12,
                      }}>{isOpen ? '▾' : '▸'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 700, color: C.text }}>{p.canonical_name}</div>
                        <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
                          {[p.category, `seen ${p.evidence_count}×`].filter(Boolean).join(' · ')}
                        </div>
                        {p.aliases && p.aliases.length > 1 && (
                          <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {p.aliases
                              .filter(a => a !== p.canonical_name)
                              .slice(0, 8)
                              .map(a => (
                                <span key={a} style={{
                                  fontSize: 10, padding: '1px 7px', borderRadius: 999,
                                  background: C.bgMuted, color: C.textMuted, ...mono,
                                }}>{a}</span>
                              ))}
                          </div>
                        )}
                      </div>
                      <div
                        onClick={e => e.stopPropagation()}
                        style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}
                      >
                        <button onClick={() => setEditing(p)} style={{
                          background: C.white, border: `1px solid ${C.border}`, borderRadius: 8,
                          padding: '3px 10px', fontSize: 11.5, cursor: 'pointer',
                          fontFamily: FONT, fontWeight: 600, color: C.text,
                        }}>{t('shelf_admin_edit')}</button>
                        <button onClick={() => onDelete(p)} style={{
                          background: C.white, border: '1px solid #e5484d', borderRadius: 8,
                          color: '#e5484d', padding: '3px 10px', fontSize: 11.5, cursor: 'pointer',
                          fontFamily: FONT, fontWeight: 600,
                        }}>{t('shelf_admin_delete')}</button>
                      </div>
                    </div>
                    {isOpen && <ProductDetail product={p} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {editing && (
        <EditModal
          product={editing}
          shelves={shelves}
          onCancel={() => setEditing(null)}
          onSave={onSave}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function EditModal({
  product,
  shelves,
  onCancel,
  onSave,
  onClose,
}: {
  product: AdminProduct;
  shelves: ShelfLocation[];
  onCancel: () => void;
  /** POST (create) or PATCH (edit) via the parent. Resolves true on success. */
  onSave: (patch: ProductWrite, id: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(product.canonical_name);
  const [aliasesText, setAliasesText] = useState(
    product.aliases.filter(a => a !== product.canonical_name).join('\n')
  );
  const [category, setCategory] = useState(product.category ?? '');
  const [aisle, setAisle] = useState(product.latest_aisle);
  const [busy, setBusy] = useState(false);

  const canSave = name.trim().length > 0 && aisle.trim().length > 0 && !busy;

  const submit = async () => {
    if (!canSave) return;
    setBusy(true);
    // Store is scoped server-side — do NOT send store_id. Server parses
    // `latest_aisle` (not `aisle`) for the shelf.
    const ok = await onSave({
      canonical_name: name.trim(),
      aliases: aliasesText.split('\n').map(s => s.trim()).filter(Boolean),
      category: category.trim() || undefined,
      latest_aisle: aisle,
    }, product._id);
    setBusy(false);
    if (ok) onClose();       // failure keeps the modal open; parent shows the error
  };

  return (
    <div
      onClick={busy ? undefined : onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 14, zIndex: 100,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: C.bg, borderRadius: 18, padding: 18,
          width: '100%', maxWidth: 480, boxShadow: '0 16px 40px rgba(0,0,0,0.25)',
          fontFamily: FONT, border: `2px solid ${C.border}`,
        }}
      >
        <h3 style={{ margin: '0 0 12px', fontSize: 17, fontWeight: 800, color: C.text, letterSpacing: -0.3 }}>
          {product._id ? t('shelf_admin_edit_title') : t('shelf_admin_add_title')}
        </h3>
        <Field label="canonical_name">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={busy}
            style={fieldStyle}
          />
        </Field>
        <Field label={t('shelf_admin_field_aliases')}>
          <textarea
            value={aliasesText}
            onChange={e => setAliasesText(e.target.value)}
            rows={5}
            disabled={busy}
            style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </Field>
        <Field label="category">
          <input
            value={category}
            onChange={e => setCategory(e.target.value)}
            disabled={busy}
            style={fieldStyle}
            placeholder={t('shelf_admin_field_category_ph')}
          />
        </Field>
        <Field label="latest_aisle">
          <select
            value={aisle}
            onChange={e => setAisle(e.target.value)}
            disabled={busy}
            style={fieldStyle}
          >
            {shelves.map(s => (
              <option key={s.code} value={s.code}>
                {s.code} — {s.description}
              </option>
            ))}
          </select>
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onCancel} disabled={busy} style={btnSecondary}>{t('shelf_admin_cancel')}</button>
          <button
            onClick={submit}
            disabled={!canSave}
            style={{ ...btnPrimary, opacity: canSave ? 1 : 0.55, cursor: canSave ? 'pointer' : 'not-allowed' }}
          >{busy ? t('shelf_admin_saving') : t('shelf_admin_save')}</button>
        </div>
      </div>
    </div>
  );
}

function ProductDetail({ product }: { product: AdminProduct }) {
  // Show every field the DB document actually has, in a labeled list.
  // Special-case timestamps (human-friendly) and arrays (one per line).
  const SKIP = new Set<string>(['_id']); // shown separately
  const order = [
    'canonical_name', 'latest_aisle', 'category', 'evidence_count',
    'aliases', 'search_text', 'created_at', 'updated_at',
  ];
  const known = order.filter(k => k in product);
  const extra = Object.keys(product).filter(k => !SKIP.has(k) && !order.includes(k));
  const keys = [...known, ...extra];

  return (
    <div style={{
      background: '#0f1115', color: '#dce0e8',
      padding: '12px 14px 14px',
      ...mono, fontSize: 12, lineHeight: 1.55,
    }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 6, opacity: 0.8 }}>
        <span style={{ color: '#7d92b3', minWidth: 110 }}>_id</span>
        <span style={{ flex: 1, wordBreak: 'break-all' }}>{product._id}</span>
      </div>
      {keys.map(k => (
        <div key={k} style={{ display: 'flex', gap: 10, marginBottom: 4 }}>
          <span style={{ color: '#7d92b3', minWidth: 110, flexShrink: 0 }}>{k}</span>
          <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
            {renderValue(k, product[k])}
          </span>
        </div>
      ))}
    </div>
  );
}

function renderValue(key: string, v: unknown): React.ReactNode {
  if (v === null || v === undefined) return <span style={{ opacity: 0.5 }}>—</span>;
  if (key === 'created_at' || key === 'updated_at') {
    const d = parseDate(v);
    if (d) return `${d.toLocaleString()} (${relativeTime(d)})`;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return <span style={{ opacity: 0.5 }}>[]</span>;
    return v.map((x, i) => (
      <span key={i} style={{
        display: 'inline-block',
        background: '#1d2330', color: '#cfd8e8',
        padding: '1px 7px', borderRadius: 4,
        margin: '0 4px 4px 0', fontSize: 11,
      }}>{typeof x === 'string' ? x : JSON.stringify(x)}</span>
    ));
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function parseDate(raw: unknown): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'string') {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === 'object' && raw && '$date' in raw) {
    const d = new Date(String((raw as { $date: string }).$date));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4, fontWeight: 700, ...mono }}>{label}</div>
      {children}
    </label>
  );
}

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', border: `1px solid ${C.border}`,
  borderRadius: 10, fontSize: 13.5, boxSizing: 'border-box',
  background: C.white, color: C.text, fontFamily: FONT,
};

const btnPrimary: React.CSSProperties = {
  background: C.primary, color: C.text, border: `2px solid ${C.border}`,
  padding: '9px 18px', borderRadius: 12, fontSize: 13.5, fontWeight: 800, cursor: 'pointer',
  fontFamily: FONT, boxShadow: SHADOW,
};

const btnSecondary: React.CSSProperties = {
  background: C.white, color: C.textMuted, border: `1px solid ${C.border}`,
  padding: '9px 18px', borderRadius: 12, fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
  fontFamily: FONT,
};
