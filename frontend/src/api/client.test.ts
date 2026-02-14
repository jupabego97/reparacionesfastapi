import { describe, expect, it } from 'vitest';
import { parseApiError, ApiError } from './client';

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
