'use client';

import { C } from '@/lib/theme';
import type { ShelfRect, FloorplanViewBox, FloorplanLabel } from '@/lib/shelves';

interface StoreMapProps {
  /** Floorplan rectangles (merged aisle + center zones) from store.floorplan. */
  rects: ShelfRect[];
  /** Whole-store viewBox from store.floorplan; computed from rects if absent. */
  viewBox?: FloorplanViewBox;
  /** Static section labels (e.g. "A" / "B") from store.floorplan. */
  labels?: FloorplanLabel[];
  /** Shelf shown as currently picked (green) — used by the picker modal. */
  selected?: string;
  /** Shelf flagged as the search target (red) — used in search results. */
  highlight?: string;
  /** Omit for a read-only map (no clicks, no pointer cursor). */
  onSelect?: (code: string) => void;
}

// Search-target highlight (red), distinct from the "selected" state.
const HI = '#e5484d';
const HI_DARK = '#c62828';

/** Within the aisle zone: wide rect = main shelf face (shows full code),
 *  narrow rect = L/R side face (shows just the side letter). */
function isMainFace(r: ShelfRect) {
  return r.w >= 100;
}

function fallbackViewBox(rects: ShelfRect[]): string {
  if (rects.length === 0) return '0 0 100 100';
  const pad = 20;
  const minX = Math.min(...rects.map(r => r.x)) - pad;
  const minY = Math.min(...rects.map(r => r.y)) - pad;
  const maxX = Math.max(...rects.map(r => r.x + r.w)) + pad;
  const maxY = Math.max(...rects.map(r => r.y + r.h)) + pad;
  return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
}

export default function StoreMap({
  rects, viewBox: vb, labels, selected, highlight, onSelect,
}: StoreMapProps) {
  const clickable = !!onSelect;
  const aisleRects = rects.filter(r => (r.kind ?? 'aisle') === 'aisle');
  const centerRects = rects.filter(r => r.kind === 'center');

  // For a search-target highlight (read-only result map), zoom the viewBox to
  // a tight window around that shelf instead of rendering the whole store.
  let viewBox = vb
    ? `${vb.x ?? 0} ${vb.y ?? 0} ${vb.w} ${vb.h}`
    : fallbackViewBox(rects);
  if (highlight) {
    const hi = rects.find(r => r.code === highlight);
    if (hi) {
      const padX = 200, padY = 200;
      const vw = hi.w + padX * 2;
      const vh = hi.h + padY * 2;
      const vx = hi.x + hi.w / 2 - vw / 2;
      const vy = hi.y + hi.h / 2 - vh / 2;
      viewBox = `${vx} ${vy} ${vw} ${vh}`;
    }
  }
  return (
    <svg
      viewBox={viewBox}
      width="100%"
      style={{ display: 'block', userSelect: 'none' }}
      aria-label="Store map"
    >
      {/* Section labels */}
      {(labels ?? []).map(l => (
        <text key={`${l.text}-${l.x}-${l.y}`} x={l.x} y={l.y} textAnchor="middle"
          fontSize={22} fontWeight={800}
          fill={C.textMuted} fontFamily="ui-sans-serif, system-ui, sans-serif">{l.text}</text>
      ))}

      {/* Aisle shelf rects */}
      {aisleRects.map(r => {
        const sel = selected === r.code;
        const hi = highlight === r.code;
        const main = isMainFace(r);
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        const label = main ? r.code : (r.code.startsWith('L') ? 'L' : 'R');
        return (
          <g key={r.code}
            onClick={clickable ? () => onSelect!(r.code) : undefined}
            style={{ cursor: clickable ? 'pointer' : 'default' }}>
            <rect
              x={r.x} y={r.y} width={r.w} height={r.h}
              fill={hi ? HI : sel ? C.primary : (main ? C.accentBg : C.primarySofter)}
              stroke={hi ? HI_DARK : sel ? C.primaryDark : C.primaryChip}
              strokeWidth={(hi || sel) ? 2.5 : 1}
              rx={4}
            />
            <text
              x={cx} y={cy}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={(hi || sel) ? '#fff' : C.text}
              fontSize={main ? 16 : 13}
              fontWeight={700}
              fontFamily="ui-monospace, monospace"
              pointerEvents="none"
            >
              {label}
            </text>
          </g>
        );
      })}

      {/* Center zone rects */}
      {centerRects.map(r => {
        const sel = selected === r.code;
        const hi = highlight === r.code;
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        const isTall = r.h > r.w;
        return (
          <g key={r.code}
            onClick={clickable ? () => onSelect!(r.code) : undefined}
            style={{ cursor: clickable ? 'pointer' : 'default' }}>
            <rect
              x={r.x} y={r.y} width={r.w} height={r.h}
              fill={hi ? HI : sel ? C.primary : C.accentTint}
              stroke={hi ? HI_DARK : sel ? C.primaryDark : C.accent}
              strokeWidth={(hi || sel) ? 2.5 : 1}
              rx={4}
            />
            <text
              x={cx} y={cy}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={(hi || sel) ? '#fff' : C.accentDark}
              fontSize={isTall ? 11 : 12}
              fontWeight={700}
              fontFamily="ui-monospace, monospace"
              pointerEvents="none"
              transform={isTall ? `rotate(-90,${cx},${cy})` : undefined}
            >
              {r.code}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
