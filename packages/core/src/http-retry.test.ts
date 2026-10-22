import { describe, expect, it, vi } from 'vitest';
import {
  computeRetryDelayMs,
  fetchWithRetry,
  isRetryableStatus,
  parseRetryAfterMs,
} from './http-retry';

describe('isRetryableStatus', () => {
  it('marks 429, 502, 503, and 504 as retryable', () => {
    for (const status of [429, 502, 503, 504]) {
      expect(isRetryableStatus(status)).toBe(true);
    }
  });

  it('never retries auth errors (401/403), client errors (400/404/413/415/422), or 500', () => {
    for (const status of [200, 400, 401, 403, 404, 413, 415, 422, 500]) {
      expect(isRetryableStatus(status)).toBe(false);
    }
  });
});

describe('parseRetryAfterMs', () => {
  it('parses delay-seconds into milliseconds', () => {
    expect(parseRetryAfterMs('2')).toBe(2000);
    expect(parseRetryAfterMs(' 0.5 ')).toBe(500);
    expect(parseRetryAfterMs('0')).toBe(0);
  });

  it('parses an HTTP-date relative to nowMs', () => {
    const now = Date.parse('2026-10-22T18:00:00.000Z');
    expect(parseRetryAfterMs('Thu, 22 Oct 2026 18:00:03 GMT', now)).toBe(3000);
    // Past date clamps to 0
    expect(parseRetryAfterMs('Thu, 22 Oct 2026 17:59:50 GMT', now)).toBe(0);
  });

  it('returns undefined for absent or unparseable values', () => {
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
    expect(parseRetryAfterMs('')).toBeUndefined();
    expect(parseRetryAfterMs('not-a-date-or-number')).toBeUndefined();
  });
});

describe('computeRetryDelayMs', () => {
  it('uses exponential backoff bounded by maxDelayMs when Retry-After is absent', () => {
    const res = new Response('busy', { status: 503 });
    expect(computeRetryDelayMs(0, res, { baseDelayMs: 250, maxDelayMs: 5000 })).toBe(250);
    expect(computeRetryDelayMs(1, res, { baseDelayMs: 250, maxDelayMs: 5000 })).toBe(500);
    expect(computeRetryDelayMs(5, res, { baseDelayMs: 250, maxDelayMs: 1000 })).toBe(1000);
  });

  it('honours Retry-After and clamps it to maxDelayMs', () => {
    const resShort = new Response('rate limited', {
      status: 429,
      headers: { 'Retry-After': '1' },
    });
    expect(computeRetryDelayMs(0, resShort, { baseDelayMs: 250, maxDelayMs: 5000 })).toBe(1000);

    const resHuge = new Response('rate limited', {
      status: 429,
      headers: { 'Retry-After': '3600' },
    });
    expect(computeRetryDelayMs(0, resHuge, { baseDelayMs: 250, maxDelayMs: 5000 })).toBe(5000);
  });
});

describe('fetchWithRetry', () => {
  it('succeeds after transient 429 / 503 responses and records exponential / Retry-After delays', async () => {
    const delays: number[] = [];
    const responses = [
      new Response('rate limited', { status: 429, headers: { 'Retry-After': '1' } }),
      new Response('gateway unavailable', { status: 503 }),
      new Response('{"ok":true}', { status: 200 }),
    ];
    const rawFetch = vi.fn(async () => responses.shift()!);
    const wrapped = fetchWithRetry(rawFetch, {
      maxRetries: 2,
      baseDelayMs: 250,
      maxDelayMs: 5000,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    const res = await wrapped('https://example.test/api');
    expect(res.status).toBe(200);
    expect(rawFetch).toHaveBeenCalledTimes(3);
    // Attempt 0 honoured Retry-After: 1 (1000ms); attempt 1 used 250 * 2^1 = 500ms.
    expect(delays).toEqual([1000, 500]);
  });

  it('stops after maxRetries and returns the last failing response', async () => {
    const rawFetch = vi.fn(async () => new Response('still overloaded', { status: 502 }));
    const wrapped = fetchWithRetry(rawFetch, {
      maxRetries: 2,
      baseDelayMs: 0,
    });

    const res = await wrapped('https://example.test/api');
    expect(res.status).toBe(502);
    expect(rawFetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retryable statuses such as 401 or 400', async () => {
    const rawFetch = vi.fn(async () => new Response('unauthorized', { status: 401 }));
    const wrapped = fetchWithRetry(rawFetch, { maxRetries: 2, baseDelayMs: 0 });

    const res = await wrapped('https://example.test/api');
    expect(res.status).toBe(401);
    expect(rawFetch).toHaveBeenCalledOnce();
  });

  it('returns the original fetch unchanged when options is false or maxRetries is 0', () => {
    const rawFetch = vi.fn() as unknown as typeof fetch;
    expect(fetchWithRetry(rawFetch, false)).toBe(rawFetch);
    expect(fetchWithRetry(rawFetch, { maxRetries: 0 })).toBe(rawFetch);
  });
});
