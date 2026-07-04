'use client';

/**
 * Superadmin store detail UI (PRD F-12):
 *  (a) shelf-taxonomy JSON editor — schema-validated client-side (same
 *      validator the API re-runs server-side), live preview in the same
 *      card-grid style as ShelfAdmin's shelf selector, template import;
 *  (b) floorplan JSON editor — validated, unknown rect codes WARN (don't
 *      block), live props-driven <StoreMap> SVG preview, template import;
 *  (c) staff passcode reset — new code displayed exactly once;
 *  (d) readonly status + billing.
 */

import { useMemo, useState } from 'react';
import { C, FONT } from '@/lib/theme';
import { useTranslation } from '@/lib/i18n';
import LanguageToggle from '@/components/LanguageToggle';
import StoreMap from '@/components/StoreMap';
import type { ShelfLocation, Floorplan } from '@/lib/shelves';
import type { StoreStatus } from '@/lib/types';
import { validateShelves, validateFloorplan } from '@/lib/store-config-validate';
import { SHELF_TEMPLATE, FLOORPLAN_TEMPLATE } from '@/lib/templates/default-store';
import { statusBadgeStyle, superShell, superCard, superBtn, superTextarea } from '../ui';

export interface StoreDetailDto {
  slug: string;
  name: string;
  status: StoreStatus;
  displayName: string;
  defaultLocale: 'en' | 'zh';
  shelves: ShelfLocation[];
  floorplan: Floorplan;
  billing: {
    portalUserId: string | null;
    stripeCustomerId: string | null;
    subscriptionId: string | null;
    setupPaidAt: string | null;
  };
  video: { r2Key: string | null; url: string | null; uploadedAt: string | null };
  createdAt: string | null;
  updatedAt: string | null;
  passcodeUpdatedAt: string | null;
}

const mono: React.CSSProperties = { fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace' };

function pretty(v: unknown): string {
  return JSON.stringify(v, null, 2);
}

type SaveState = 'idle' | 'saving' | 'saved';

export default function StoreDetailClient({ store }: { store: StoreDetailDto }) {
  const { t } = useTranslation();

  // ── shelves editor state ──
  const [shelvesText, setShelvesText] = useState(() => pretty(store.shelves));
  const [shelvesSave, setShelvesSave] = useState<SaveState>('idle');
  const [shelvesApiError, setShelvesApiError] = useState<string | null>(null);

  const shelvesCheck = useMemo(() => {
    try {
      return validateShelves(JSON.parse(shelvesText));
    } catch {
      return { ok: false as const, errors: [t('sa_invalid_json')] };
    }
  }, [shelvesText, t]);

  // ── floorplan editor state ──
  const [floorplanText, setFloorplanText] = useState(() => pretty(store.floorplan));
  const [floorplanSave, setFloorplanSave] = useState<SaveState>('idle');
  const [floorplanApiError, setFloorplanApiError] = useState<string | null>(null);

  const knownCodes = useMemo(
    () => (shelvesCheck.ok ? shelvesCheck.value.map(s => s.code) : store.shelves.map(s => s.code)),
    [shelvesCheck, store.shelves]
  );

  const floorplanCheck = useMemo(() => {
    try {
      return validateFloorplan(JSON.parse(floorplanText), knownCodes);
    } catch {
      return { ok: false as const, errors: [t('sa_invalid_json')] };
    }
  }, [floorplanText, knownCodes, t]);

  // ── passcode reset ──
  const [newPasscode, setNewPasscode] = useState<string | null>(null);
  const [passcodeBusy, setPasscodeBusy] = useState(false);
  const [passcodeError, setPasscodeError] = useState<string | null>(null);

  const patchStore = async (body: object): Promise<{ ok: boolean; data: Record<string, unknown> }> => {
    const res = await fetch(`/api/superadmin/stores/${encodeURIComponent(store.slug)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, data };
  };

  const saveShelves = async () => {
    if (!shelvesCheck.ok || shelvesSave === 'saving') return;
    setShelvesSave('saving');
    setShelvesApiError(null);
    const { ok, data } = await patchStore({ shelves: shelvesCheck.value });
    if (ok) {
      setShelvesSave('saved');
      setTimeout(() => setShelvesSave('idle'), 2000);
    } else {
      setShelvesSave('idle');
      setShelvesApiError(String(data.error ?? t('sa_action_failed')));
    }
  };

  const saveFloorplan = async () => {
    if (!floorplanCheck.ok || floorplanSave === 'saving') return;
    setFloorplanSave('saving');
    setFloorplanApiError(null);
    const { ok, data } = await patchStore({ floorplan: floorplanCheck.value });
    if (ok) {
      setFloorplanSave('saved');
      setTimeout(() => setFloorplanSave('idle'), 2000);
    } else {
      setFloorplanSave('idle');
      setFloorplanApiError(String(data.error ?? t('sa_action_failed')));
    }
  };

  const resetPasscode = async () => {
    if (passcodeBusy) return;
    if (!confirm(t('sa_confirm_reset_passcode'))) return;
    setPasscodeBusy(true);
    setPasscodeError(null);
    const { ok, data } = await patchStore({ passcodeReset: true });
    setPasscodeBusy(false);
    if (ok && typeof data.passcode === 'string') {
      setNewPasscode(data.passcode);
    } else {
      setPasscodeError(String(data.error ?? t('sa_action_failed')));
    }
  };

  const infoRow = (label: string, value: React.ReactNode) => (
    <div style={{ display: 'flex', gap: 12, padding: '6px 0', fontSize: 13.5, borderBottom: `1px solid ${C.bgMuted}` }}>
      <div style={{ width: 150, flexShrink: 0, color: C.textMuted, fontWeight: 700 }}>{label}</div>
      <div style={{ ...mono, wordBreak: 'break-all' }}>{value ?? <span style={{ color: C.textSoft }}>{t('sa_none')}</span>}</div>
    </div>
  );

  const sectionTitle = (label: string) => (
    <h2 style={{ fontSize: 17, fontWeight: 800, margin: '0 0 12px', letterSpacing: -0.3 }}>{label}</h2>
  );

  return (
    <div style={superShell}>
      {/* Header */}
      <a href="/superadmin" style={{ color: C.textMuted, fontSize: 13.5, fontWeight: 700, textDecoration: 'none' }}>
        ← {t('sa_detail_back')}
      </a>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '10px 0 20px', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, letterSpacing: -0.6, ...mono }}>{store.slug}</h1>
          <span style={statusBadgeStyle(store.status)}>{store.status}</span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <a
            href={`https://${store.slug}.whataisle.com`}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 13, fontWeight: 700, color: C.primaryDark }}
          >
            {t('sa_open_store')} ↗
          </a>
          <LanguageToggle />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* (d) status + billing, readonly */}
        <section style={superCard}>
          {sectionTitle(t('sa_section_status'))}
          {infoRow(t('sa_field_slug'), store.slug)}
          {infoRow(t('sa_field_name'), `${store.displayName} (${store.name})`)}
          {infoRow(t('sa_col_status'), store.status)}
          {infoRow(t('sa_field_created'), store.createdAt ? new Date(store.createdAt).toLocaleString() : null)}
          {infoRow(t('sa_field_updated'), store.updatedAt ? new Date(store.updatedAt).toLocaleString() : null)}
          {infoRow(
            t('sa_field_video'),
            store.video.url || store.video.r2Key
              ? (
                  store.video.url
                    ? <a href={store.video.url} target="_blank" rel="noreferrer" style={{ color: C.primaryDark }}>{store.video.url}</a>
                    : store.video.r2Key
                )
              : null
          )}
          {infoRow(t('sa_field_portal_user'), store.billing.portalUserId)}
          {infoRow(t('sa_field_stripe_customer'), store.billing.stripeCustomerId)}
          {infoRow(t('sa_field_subscription'), store.billing.subscriptionId)}
        </section>

        {/* (c) passcode reset */}
        <section style={superCard}>
          {sectionTitle(t('sa_section_passcode'))}
          <p style={{ fontSize: 13, color: C.textMuted, margin: '0 0 12px' }}>{t('sa_passcode_note')}</p>
          {newPasscode ? (
            <div style={{
              padding: '12px 14px', background: C.accentTint, border: `1px solid ${C.border}`,
              borderRadius: 10, fontSize: 14, fontWeight: 700,
            }}>
              {t('sa_new_passcode')}{' '}
              <span style={{ ...mono, fontSize: 20, letterSpacing: 3, fontWeight: 800 }}>{newPasscode}</span>
            </div>
          ) : (
            <button onClick={resetPasscode} disabled={passcodeBusy} style={superBtn('danger')}>
              {passcodeBusy ? '…' : t('sa_reset_passcode')}
            </button>
          )}
          {passcodeError && <div style={{ marginTop: 8, fontSize: 13, color: '#c33', fontWeight: 700 }}>{passcodeError}</div>}
        </section>

        {/* (a) shelf taxonomy editor */}
        <section style={superCard}>
          {sectionTitle(t('sa_section_shelves'))}
          <textarea
            value={shelvesText}
            onChange={e => setShelvesText(e.target.value)}
            spellCheck={false}
            style={superTextarea}
          />
          <EditorFooter
            check={shelvesCheck}
            countLabel={shelvesCheck.ok ? t('sa_shelves_count', shelvesCheck.value.length) : ''}
            apiError={shelvesApiError}
            saveState={shelvesSave}
            onSave={saveShelves}
            onImportTemplate={() => setShelvesText(pretty(SHELF_TEMPLATE))}
          />
          {/* live preview — same card grid as ShelfAdmin's shelf selector */}
          {shelvesCheck.ok && shelvesCheck.value.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: C.textMuted, marginBottom: 8 }}>{t('sa_preview')}</div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                gap: 8, maxHeight: 320, overflowY: 'auto',
              }}>
                {shelvesCheck.value.map(s => (
                  <div key={s.code} style={{
                    padding: '8px 10px', background: C.white, border: `1px solid ${C.border}`,
                    borderRadius: 10, fontSize: 11.5, lineHeight: 1.3,
                  }}>
                    <div style={{ ...mono, fontWeight: 800, fontSize: 13 }}>{s.code}</div>
                    <div style={{ color: C.textMuted, marginTop: 2 }}>{s.description || '—'}</div>
                    {s.categories.length > 0 && (
                      <div style={{ color: C.textSoft, marginTop: 2 }}>{s.categories.length} categories</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* (b) floorplan editor */}
        <section style={superCard}>
          {sectionTitle(t('sa_section_floorplan'))}
          <textarea
            value={floorplanText}
            onChange={e => setFloorplanText(e.target.value)}
            spellCheck={false}
            style={superTextarea}
          />
          <EditorFooter
            check={floorplanCheck}
            countLabel={floorplanCheck.ok ? t('sa_rects_count', floorplanCheck.value.rects.length) : ''}
            apiError={floorplanApiError}
            saveState={floorplanSave}
            onSave={saveFloorplan}
            onImportTemplate={() => setFloorplanText(pretty(FLOORPLAN_TEMPLATE))}
          />
          {/* live SVG preview via the props-driven StoreMap */}
          {floorplanCheck.ok && floorplanCheck.value.rects.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: C.textMuted, marginBottom: 8 }}>{t('sa_preview')}</div>
              <div style={{
                maxWidth: 420, border: `1px solid ${C.bgMuted}`, borderRadius: 10,
                padding: 8, background: C.white,
              }}>
                <StoreMap
                  rects={floorplanCheck.value.rects}
                  viewBox={floorplanCheck.value.viewBox}
                  labels={floorplanCheck.value.labels}
                />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Validation feedback + template import + save row shared by both editors. */
function EditorFooter({
  check, countLabel, apiError, saveState, onSave, onImportTemplate,
}: {
  check: { ok: true; warnings: string[] } | { ok: false; errors: string[] };
  countLabel: string;
  apiError: string | null;
  saveState: SaveState;
  onSave: () => void;
  onImportTemplate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ marginTop: 10 }}>
      {!check.ok && (
        <ul style={{ margin: '0 0 10px', paddingLeft: 18, color: '#c33', fontSize: 12.5, fontWeight: 600 }}>
          {check.errors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
      {check.ok && check.warnings.length > 0 && (
        <ul style={{ margin: '0 0 10px', paddingLeft: 18, color: C.accentDark, fontSize: 12.5, fontWeight: 600 }}>
          {check.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
        </ul>
      )}
      {apiError && (
        <div style={{ margin: '0 0 10px', color: '#c33', fontSize: 12.5, fontWeight: 700 }}>{apiError}</div>
      )}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={onSave} disabled={!check.ok || saveState === 'saving'} style={{
          ...superBtn('primary'),
          opacity: check.ok ? 1 : 0.5,
          cursor: check.ok ? 'pointer' : 'default',
        }}>
          {saveState === 'saving' ? t('sa_saving') : saveState === 'saved' ? t('sa_saved') : t('sa_save')}
        </button>
        <button onClick={onImportTemplate} style={superBtn('ghost')}>{t('sa_import_template')}</button>
        {countLabel && (
          <span style={{ fontSize: 12.5, color: C.textMuted, fontWeight: 700, fontFamily: FONT }}>{countLabel}</span>
        )}
      </div>
    </div>
  );
}
