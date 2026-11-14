import { describe, expect, it } from 'vitest';
import { parseApiError, ApiError, resolveApiBase } from './client';

describe('resolveApiBase', () => {
  it('prefers the runtime URL over the Vite bake', () => {
    expect(resolveApiBase('https://api.up.railway.app/', 'https://stale.example')).toBe('https://api.up.railway.app');
  });

  it('falls back to the baked URL and strips a trailing slash', () => {
    expect(resolveApiBase('', 'https://api.example.com/')).toBe('https://api.example.com');
  });

  it('returns empty when neither is set (dev proxy)', () => {
    expect(resolveApiBase(undefined, undefined)).toBe('');
  });
});

describe('parseApiError', () => {
  it('parses envelope payload', async () => {
    const response = new Response(JSON.stringify({
      code: 'forbidden',
      message: 'Denied',
      request_id: 'abc123',
    }), { status: 403, headers: { 'Content-Type': 'application/json' } });

    const err = await parseApiError(response);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('forbidden');
    expect(err.status).toBe(403);
    expect(err.requestId).toBe('abc123');
  });

  it('falls back to text payload', async () => {
    const response = new Response('Internal crash', { status: 500 });
    const err = await parseApiError(response);
    expect(err.code).toBe('error');
    expect(err.message).toContain('Internal crash');
  });
});
