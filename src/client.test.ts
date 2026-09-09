import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSmartPetClient, RateLimitedError } from './index.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

function mockResponses(...seq: Array<{ status: number; headers?: Record<string, string>; body?: unknown }>) {
  let i = 0;
  globalThis.fetch = vi.fn(async () => {
    const r = seq[Math.min(i++, seq.length - 1)];
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { 'content-type': 'application/json', ...(r.headers ?? {}) } });
  }) as typeof fetch;
  return () => (globalThis.fetch as any).mock.calls.length;
}

describe('createSmartPetClient', () => {
  it('attaches the bearer token from the getter', async () => {
    const calls = mockResponses({ status: 200, body: { ok: true } });
    const api = createSmartPetClient({ baseUrl: 'http://x', token: () => 'tok-123' });
    await api.GET('/api/auth/me');
    const req = (globalThis.fetch as any).mock.calls[0][0] as Request;
    expect(req.headers.get('authorization')).toBe('Bearer tok-123');
    expect(calls()).toBe(1);
  });

  it('retries a GET on 429 then succeeds', async () => {
    const calls = mockResponses(
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 200, body: { ok: true } },
    );
    const api = createSmartPetClient({ baseUrl: 'http://x', backoffBaseMs: 1 });
    const { response } = await api.GET('/api/auth/me');
    expect(response.status).toBe(200);
    expect(calls()).toBe(2);
  });

  it('does NOT retry a plain POST (non-idempotent)', async () => {
    const calls = mockResponses({ status: 429, headers: { 'retry-after': '0' } });
    const api = createSmartPetClient({ baseUrl: 'http://x', backoffBaseMs: 1 });
    const { response } = await api.POST('/api/auth/login', { body: { email: 'a@b.co', password: 'x' } as any });
    expect(response.status).toBe(429);
    expect(calls()).toBe(1);
  });

  it('throws RateLimitedError once retries are exhausted', async () => {
    mockResponses({ status: 429, headers: { 'retry-after': '0' } });
    const api = createSmartPetClient({ baseUrl: 'http://x', maxRetries: 2, backoffBaseMs: 1 });
    await expect(api.GET('/api/auth/me')).rejects.toBeInstanceOf(RateLimitedError);
  });
});
