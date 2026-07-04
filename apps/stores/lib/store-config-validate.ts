/**
 * Schema validation for the superadmin JSON editors (PRD F-12) — shelves
 * taxonomy and floorplan. PURE module (no server imports) so the client-side
 * editors and the /api/superadmin save route run the SAME checks.
 *
 * errors  → block saving;
 * warnings → surfaced but non-blocking (e.g. a floorplan rect whose code has
 *            no shelf entry yet — legitimate while building a store).
 */

import type { ShelfLocation, Floorplan, ShelfRect, FloorplanLabel } from './shelves';

export type ValidationResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; errors: string[] };

const MAX_SHELVES = 500;
const MAX_RECTS = 1000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string');
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// ─────────────────────────────────────────────────────────────
// Shelves: array of {code unique non-empty, description,
//                    description_zh?, categories: string[]}
// ─────────────────────────────────────────────────────────────

export function validateShelves(raw: unknown): ValidationResult<ShelfLocation[]> {
  const errors: string[] = [];
  if (!Array.isArray(raw)) {
    return { ok: false, errors: ['shelves must be a JSON array'] };
  }
  if (raw.length > MAX_SHELVES) {
    return { ok: false, errors: [`too many shelves (max ${MAX_SHELVES})`] };
  }

  const seen = new Set<string>();
  const value: ShelfLocation[] = [];

  raw.forEach((item, i) => {
    const at = `shelves[${i}]`;
    if (!isRecord(item)) {
      errors.push(`${at}: must be an object`);
      return;
    }
    const code = typeof item.code === 'string' ? item.code.trim() : '';
    if (!code) {
      errors.push(`${at}: 'code' must be a non-empty string`);
    } else if (seen.has(code)) {
      errors.push(`${at}: duplicate code '${code}'`);
    } else {
      seen.add(code);
    }
    if (typeof item.description !== 'string') {
      errors.push(`${at} (${code || '?'}): 'description' must be a string`);
    }
    if (item.description_zh !== undefined && typeof item.description_zh !== 'string') {
      errors.push(`${at} (${code || '?'}): 'description_zh' must be a string when present`);
    }
    if (!isStringArray(item.categories)) {
      errors.push(`${at} (${code || '?'}): 'categories' must be an array of strings`);
    }
    if (errors.length === 0) {
      const shelf: ShelfLocation & { description_zh?: string } = {
        code,
        description: item.description as string,
        categories: item.categories as string[],
      };
      if (typeof item.description_zh === 'string') shelf.description_zh = item.description_zh;
      value.push(shelf);
    }
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value, warnings: [] };
}

// ─────────────────────────────────────────────────────────────
// Floorplan: {viewBox:{x?,y?,w,h}, rects:[{code,x,y,w,h,kind?}], labels?}
// ─────────────────────────────────────────────────────────────

export function validateFloorplan(
  raw: unknown,
  knownShelfCodes?: string[]
): ValidationResult<Floorplan> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(raw)) {
    return { ok: false, errors: ['floorplan must be a JSON object'] };
  }

  // viewBox
  const vb = raw.viewBox;
  if (!isRecord(vb) || !isFiniteNumber(vb.w) || !isFiniteNumber(vb.h) || vb.w <= 0 || vb.h <= 0) {
    errors.push("'viewBox' must be {w>0, h>0} (x/y optional numbers)");
  } else {
    if (vb.x !== undefined && !isFiniteNumber(vb.x)) errors.push("'viewBox.x' must be a number");
    if (vb.y !== undefined && !isFiniteNumber(vb.y)) errors.push("'viewBox.y' must be a number");
  }

  // rects
  const rects: ShelfRect[] = [];
  if (!Array.isArray(raw.rects)) {
    errors.push("'rects' must be an array");
  } else if (raw.rects.length > MAX_RECTS) {
    errors.push(`too many rects (max ${MAX_RECTS})`);
  } else {
    raw.rects.forEach((r, i) => {
      const at = `rects[${i}]`;
      if (!isRecord(r)) {
        errors.push(`${at}: must be an object`);
        return;
      }
      const code = typeof r.code === 'string' ? r.code.trim() : '';
      if (!code) errors.push(`${at}: 'code' must be a non-empty string`);
      for (const k of ['x', 'y', 'w', 'h'] as const) {
        if (!isFiniteNumber(r[k])) errors.push(`${at} (${code || '?'}): '${k}' must be a number`);
      }
      if (r.kind !== undefined && r.kind !== 'aisle' && r.kind !== 'center') {
        errors.push(`${at} (${code || '?'}): 'kind' must be 'aisle' or 'center' when present`);
      }
      if (errors.length === 0) {
        const rect: ShelfRect = {
          code,
          x: r.x as number, y: r.y as number, w: r.w as number, h: r.h as number,
        };
        if (r.kind === 'aisle' || r.kind === 'center') rect.kind = r.kind;
        rects.push(rect);
      }
    });
  }

  // labels (optional)
  const labels: FloorplanLabel[] = [];
  if (raw.labels !== undefined) {
    if (!Array.isArray(raw.labels)) {
      errors.push("'labels' must be an array when present");
    } else {
      raw.labels.forEach((l, i) => {
        if (!isRecord(l) || typeof l.text !== 'string' || !isFiniteNumber(l.x) || !isFiniteNumber(l.y)) {
          errors.push(`labels[${i}]: must be {text: string, x: number, y: number}`);
        } else {
          labels.push({ text: l.text, x: l.x, y: l.y });
        }
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Non-blocking: rects whose code has no shelf entry (yet).
  if (knownShelfCodes) {
    const known = new Set(knownShelfCodes);
    const orphans = Array.from(new Set(rects.map(r => r.code).filter(c => !known.has(c))));
    if (orphans.length > 0) {
      warnings.push(`rect codes not in the shelf taxonomy: ${orphans.join(', ')}`);
    }
  }

  const viewBox = vb as Record<string, unknown>;
  const value: Floorplan = {
    viewBox: {
      ...(isFiniteNumber(viewBox.x) ? { x: viewBox.x } : {}),
      ...(isFiniteNumber(viewBox.y) ? { y: viewBox.y } : {}),
      w: viewBox.w as number,
      h: viewBox.h as number,
    },
    rects,
    labels,
  };
  return { ok: true, value, warnings };
}
