/**
 * Client-side access to the current store's public configuration
 * (branding + shelves + floorplan), fetched once from GET /api/store-config
 * and cached at module level for the life of the page.
 *
 * Server code must NOT use this — it resolves the store via
 * lib/store-context.ts instead.
 */

'use client';

import { useEffect, useState } from 'react';
import type { ShelfLocation, Floorplan } from './shelves';
import type { StoreBranding } from './types';

export interface StoreConfig {
  slug: string;
  name: string;
  name_zh: string | null;
  branding: StoreBranding;
  shelves: ShelfLocation[];
  floorplan: Floorplan;
}

let cached: StoreConfig | null = null;
let inflight: Promise<StoreConfig | null> | null = null;

export function fetchStoreConfig(): Promise<StoreConfig | null> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetch('/api/store-config')
      .then(r => r.json())
      .then(d => {
        if (!d?.ok) return null;
        cached = d as StoreConfig;
        return cached;
      })
      .catch(() => null)
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/**
 * Current store config, or null while loading / when unavailable.
 * Components should render a sensible empty state on null.
 */
export function useStoreConfig(): StoreConfig | null {
  const [config, setConfig] = useState<StoreConfig | null>(cached);

  useEffect(() => {
    if (cached) return;
    let alive = true;
    fetchStoreConfig().then(cfg => { if (alive && cfg) setConfig(cfg); });
    return () => { alive = false; };
  }, []);

  return config;
}
