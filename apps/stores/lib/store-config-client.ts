/**
 * Client-side access to the current store's public configuration
 * (branding + shelves + floorplan), fetched from GET /api/store-config and
 * cached at module level for the life of the page.
 *
 * Failure handling: each load auto-retries twice (1 s / 3 s backoff). If all
 * attempts fail, `useStoreConfig` reports `error: true` and consumers can
 * call `retry()` — so one transient failure no longer permanently breaks the
 * shelf pickers / store map.
 *
 * Server code must NOT use this — it resolves the store via
 * lib/store-context.ts instead.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

/** Backoff before automatic retries within one fetchStoreConfig() cycle. */
const RETRY_DELAYS_MS = [1_000, 3_000] as const;

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

async function fetchConfigOnce(): Promise<StoreConfig> {
  const r = await fetch('/api/store-config');
  const d = await r.json();
  if (!d?.ok) throw new Error(typeof d?.error === 'string' ? d.error : `store-config failed (${r.status})`);
  return d as StoreConfig;
}

async function fetchConfigWithRetry(): Promise<StoreConfig> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    try {
      return await fetchConfigOnce();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Load (or return the cached) store config. Resolves null once the retry
 * budget is exhausted; a later call starts a fresh attempt cycle.
 */
export function fetchStoreConfig(): Promise<StoreConfig | null> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetchConfigWithRetry()
      .then(d => {
        cached = d;
        return d as StoreConfig | null;
      })
      .catch(() => null)
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export interface StoreConfigState {
  /** Current store config, or null while loading / after a failed load. */
  config: StoreConfig | null;
  /** True once a load cycle (with auto-retries) has failed. */
  error: boolean;
  /** Kick off a fresh load cycle (clears `error` first). */
  retry: () => void;
}

/**
 * Current store config plus load state. Components should render a sensible
 * empty state while `config` is null, and offer `retry()` when `error` is set.
 */
export function useStoreConfig(): StoreConfigState {
  const [config, setConfig] = useState<StoreConfig | null>(cached);
  const [error, setError] = useState(false);
  const aliveRef = useRef(true);

  const load = useCallback(() => {
    if (cached) {
      setConfig(cached);
      setError(false);
      return;
    }
    setError(false);
    fetchStoreConfig().then(cfg => {
      if (!aliveRef.current) return;
      if (cfg) setConfig(cfg);
      else setError(true);
    });
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    if (!cached) load();
    return () => { aliveRef.current = false; };
  }, [load]);

  return { config, error, retry: load };
}
