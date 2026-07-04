import 'server-only';

import type { StoreStatus } from '@/lib/store-status';

/**
 * Tiny client for the Stores App internal API (PRD F-13).
 *
 * Both apps run on the same VM and talk over the loopback interface with a
 * shared bearer secret. Caddy blocks /api/internal/* on every public vhost.
 */

const MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 1_000;
const REQUEST_TIMEOUT_MS = 10_000;

function getBaseUrl(): string {
  return process.env.STORES_INTERNAL_URL || 'http://127.0.0.1:3001';
}

function getSecret(): string {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    throw new Error('INTERNAL_API_SECRET environment variable is not set');
  }
  return secret;
}

export interface CreateStoreParams {
  slug: string;
  name: string;
  portalUserId: string;
  stripeCustomerId?: string | null;
  subscriptionId?: string | null;
}

export interface UpdateStoreParams {
  status?: StoreStatus;
  name?: string;
  stripeCustomerId?: string | null;
  subscriptionId?: string | null;
}

/**
 * Request with 3 attempts + exponential backoff (1s, 2s).
 * Retries network errors, timeouts and 5xx; 4xx fails immediately.
 * Throws on final failure — callers decide how to alert.
 */
async function request<T = unknown>(
  path: string,
  method: 'GET' | 'POST' | 'PATCH',
  body?: Record<string, unknown>
): Promise<T> {
  const url = `${getBaseUrl()}${path}`;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getSecret()}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.ok) {
        const text = await response.text();
        return (text ? JSON.parse(text) : {}) as T;
      }

      const errorText = await response.text().catch(() => '');
      const error = new Error(
        `Stores API ${method} ${path} failed with ${response.status}: ${errorText}`
      );
      // 4xx: retrying will not help
      if (response.status < 500) {
        throw error;
      }
      lastError = error;
    } catch (error) {
      clearTimeout(timer);
      // AbortError (timeout) and TypeError (network) are retryable
      const retryable =
        (error instanceof DOMException && error.name === 'AbortError') ||
        error instanceof TypeError;
      if (
        !retryable &&
        error instanceof Error &&
        !error.message.includes('failed with 5')
      ) {
        throw error;
      }
      lastError = error;
    }

    if (attempt < MAX_ATTEMPTS) {
      const delay = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `Stores API ${method} ${path} attempt ${attempt} failed, retrying in ${delay}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(
        `Stores API ${method} ${path} failed after ${MAX_ATTEMPTS} attempts`
      );
}

/**
 * Provision a store in the Stores App (Mongo).
 * The Stores App must treat this as idempotent (PRD F-13 验收).
 */
export async function createStore(params: CreateStoreParams): Promise<void> {
  await request('/api/internal/stores', 'POST', { ...params });
}

/**
 * Push a status/config change to the Stores App.
 */
export async function updateStore(
  slug: string,
  patch: UpdateStoreParams
): Promise<void> {
  await request(`/api/internal/stores/${encodeURIComponent(slug)}`, 'PATCH', {
    ...patch,
  });
}

export interface ResetPasscodeResult {
  /** The freshly generated staff admin passcode, returned ONCE. */
  passcode: string;
}

/**
 * Ask the Stores App to rotate the staff /admin passcode for a store and
 * return the new value. The Stores App owns passcode generation/hashing —
 * the portal only relays the owner's request and surfaces the plaintext once.
 */
export async function resetStorePasscode(
  slug: string
): Promise<ResetPasscodeResult> {
  return request<ResetPasscodeResult>(
    `/api/internal/stores/${encodeURIComponent(slug)}/reset-passcode`,
    'POST'
  );
}
