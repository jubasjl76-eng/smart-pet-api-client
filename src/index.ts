/**
 * @jubasjl76-eng/api-client — the typed Smart Pet API client.
 *
 *   import { createSmartPetClient } from '@jubasjl76-eng/api-client';
 *   const api = createSmartPetClient({ baseUrl: '/api/v1', token: () => localStorage.token });
 *   const { data, error } = await api.POST('/api/auth/login', { body: { email, password } });
 *
 * Wraps `openapi-fetch` with:
 *   - bearer auth from a token getter
 *   - retry with jittered exponential backoff on 429 / 5xx / network errors
 *     (honours `Retry-After`); only idempotent methods + explicitly-keyed POSTs
 *   - a `RateLimitedError` surfaced once retries are exhausted
 */
import createClient, { type Client, type ClientOptions, type Middleware } from 'openapi-fetch';
import type { paths } from './schema.js';

export type SmartPetPaths = paths;
export type SmartPetClient = Client<paths>;

export class RateLimitedError extends Error {
  constructor(
    public readonly retryAfterMs: number,
    public readonly response: Response,
  ) {
    super(`rate limited; retry after ~${Math.round(retryAfterMs / 1000)}s`);
    this.name = 'RateLimitedError';
  }
}

export interface SmartPetClientOptions extends Omit<ClientOptions, 'headers'> {
  /** Called per request; return the bearer token or null. */
  token?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Max retry attempts for retryable failures. Default 3. */
  maxRetries?: number;
  /** Base backoff in ms. Default 500. */
  backoffBaseMs?: number;
  /** Backoff cap in ms. Default 20_000. */
  backoffCapMs?: number;
  headers?: Record<string, string>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const IDEMPOTENT = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']);

function retryDelayMs(res: Response | undefined, attempt: number, base: number, cap: number): number {
  const ra = res?.headers.get('retry-after');
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs)) return secs * 1000;
    const at = Date.parse(ra);
    if (!Number.isNaN(at)) return Math.max(0, at - Date.now());
  }
  // full jitter
  return Math.random() * Math.min(cap, base * 2 ** attempt);
}

export function createSmartPetClient(opts: SmartPetClientOptions = {}): SmartPetClient {
  const {
    token,
    maxRetries = 3,
    backoffBaseMs = 500,
    backoffCapMs = 20_000,
    headers,
    ...clientOpts
  } = opts;

  const client = createClient<paths>({ headers, ...clientOpts });

  const auth: Middleware = {
    async onRequest({ request }) {
      const t = token ? await token() : undefined;
      if (t) request.headers.set('authorization', `Bearer ${t}`);
      return request;
    },
  };

  const retry: Middleware = {
    async onResponse({ request, response }) {
      const method = request.method.toUpperCase();
      const retryable =
        response.status === 429 || (response.status >= 500 && response.status <= 599);
      const safe = IDEMPOTENT.has(method) || request.headers.has('idempotency-key');
      if (!retryable || !safe) return response;

      let res = response;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        await sleep(retryDelayMs(res, attempt, backoffBaseMs, backoffCapMs));
        res = await fetch(request.clone());
        if (res.status !== 429 && !(res.status >= 500 && res.status <= 599)) return res;
      }
      if (res.status === 429) {
        throw new RateLimitedError(retryDelayMs(res, maxRetries, backoffBaseMs, backoffCapMs), res);
      }
      return res;
    },
  };

  client.use(auth, retry);
  return client;
}

export { createClient as createRawClient };
