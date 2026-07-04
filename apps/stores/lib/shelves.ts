/**
 * Shelf + floorplan types and PURE helpers.
 *
 * Multi-tenant note: the shelf list used to be a hardcoded single-store array
 * here. It now lives per-store in MongoDB (`stores.shelves`, see lib/types.ts)
 * and every helper takes the store's `ShelfLocation[]` as its first argument.
 * The founder's starting template (the old hardcoded data) moved to
 * lib/templates/default-store.ts.
 *
 * This module is intentionally dependency-free so both server code and client
 * components can import the types and helpers.
 */

export interface ShelfLocation {
  /** Short code shown in compact UI ("B6") */
  code: string;
  /** Human-readable description shown in dropdown options */
  description: string;
  /** Keywords (EN + zh) used to prime Vision + Agent prompts */
  categories: string[];
}

/** One rectangle on the store floorplan SVG (merged A/B + center zones). */
export interface ShelfRect {
  code: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Render style: 'aisle' (default) = A/B-style shelf faces (primary tints,
   * side faces labelled L/R); 'center' = C/X-style zones (accent tints,
   * rotated label when tall).
   */
  kind?: 'aisle' | 'center';
}

/** Static text placed on the floorplan (e.g. the "A" / "B" section labels). */
export interface FloorplanLabel {
  text: string;
  x: number;
  y: number;
}

export interface FloorplanViewBox {
  /** Origin offset — legacy store coordinates don't start at 0,0. Default 0. */
  x?: number;
  y?: number;
  w: number;
  h: number;
}

export interface Floorplan {
  viewBox: FloorplanViewBox;
  rects: ShelfRect[];
  labels?: FloorplanLabel[];
}

export function getShelf(shelves: ShelfLocation[], code: string): ShelfLocation | undefined {
  return shelves.find(s => s.code === code);
}

export function shelfCodes(shelves: ShelfLocation[]): string[] {
  return shelves.map(s => s.code);
}

export function isValidShelfCode(shelves: ShelfLocation[], code: string): boolean {
  return shelves.some(s => s.code === code);
}

/**
 * Compact one-line context string ready to drop into an LLM prompt.
 *   buildShelfContext(shelves, "B6") -> "B6 — Instant Noodles. Likely products: instant noodles, ..."
 */
export function buildShelfContext(shelves: ShelfLocation[], code: string): string {
  const s = getShelf(shelves, code);
  if (!s) return code;
  const likely = s.categories.length > 0
    ? ` Likely products: ${s.categories.slice(0, 12).join(', ')}.`
    : '';
  return `${s.code} — ${s.description}.${likely}`;
}
