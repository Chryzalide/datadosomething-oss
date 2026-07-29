import { describe, expect, it, vi } from 'vitest';
import { LlmConfigError, NETTOYAGE_REASONING_EFFORT, NETTOYAGE_TEMPERATURE } from '../llm-port';
import { MistralSmallAdapter } from './mistral-small-adapter';
import { jsonFetch } from '../../__testing__/json-fetch';

const request = { system: 'Remove OCR noise only.', user: 'Some  text.' };

const reply = (content: unknown) => ({ choices: [{ message: { content } }] });

/** The parsed request body of the first call. */
function bodyOf(fetchImpl: ReturnType<typeof jsonFetch>): Record<string, unknown> {
  const [, init] = fetchImpl.mock.calls[0] ?? [];
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe('MistralSmallAdapter — config (AC1)', () => {
  it('throws LlmConfigError naming the env var on a missing key (FR-14, UX-DR10)', () => {
    expect(() => new MistralSmallAdapter({ apiKey: '' })).toThrow(LlmConfigError);
    expect(() => new MistralSmallAdapter({ apiKey: '   ' })).toThrow(LlmConfigError);
    expect(() => new MistralSmallAdapter({ apiKey: '' })).toThrow(/MISTRAL_API_KEY/);
  });

  it('carries a vendor-neutral provider identity', () => {
    expect(new MistralSmallAdapter({ apiKey: 'k' }).name).toBe('mistral-small');
  });
});

describe('MistralSmallAdapter — request shape (AC1)', () => {
  it('POSTs to the chat-completions endpoint with Bearer auth', async () => {
    const fetchImpl = jsonFetch(200, reply('cleaned'));
    await new MistralSmallAdapter({ apiKey: 'k', fetch: fetchImpl }).complete(request);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://api.mistral.ai/v1/chat/completions');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer k');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Accept).toBe('application/json');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('always sends temperature=0 and reasoning_effort="none" (AR-2, AD-8)', async () => {
    const fetchImpl = jsonFetch(200, reply('cleaned'));
    await new MistralSmallAdapter({ apiKey: 'k', fetch: fetchImpl }).complete(request);

    const body = bodyOf(fetchImpl);
    expect(body.temperature).toBe(0);
    expect(body.reasoning_effort).toBe('none');
    expect(NETTOYAGE_TEMPERATURE).toBe(0);
    expect(NETTOYAGE_REASONING_EFFORT).toBe('none');
  });

  it('does not expose the determinism settings as config — they cannot be overridden', async () => {
    const fetchImpl = jsonFetch(200, reply('cleaned'));
    // Anything a caller smuggles in is ignored: the fields are not in the config
    // type, and the adapter reads them from the port constants.
    const config = {
      apiKey: 'k',
      fetch: fetchImpl,
      temperature: 0.9,
      reasoning_effort: 'high',
    } as unknown as ConstructorParameters<typeof MistralSmallAdapter>[0];
    await new MistralSmallAdapter(config).complete(request);

    const body = bodyOf(fetchImpl);
    expect(body.temperature).toBe(0);
    expect(body.reasoning_effort).toBe('none');
  });

  it('maps system and user into messages, in order', async () => {
    const fetchImpl = jsonFetch(200, reply('cleaned'));
    await new MistralSmallAdapter({ apiKey: 'k', fetch: fetchImpl }).complete(request);

    expect(bodyOf(fetchImpl).messages).toEqual([
      { role: 'system', content: 'Remove OCR noise only.' },
      { role: 'user', content: 'Some  text.' },
    ]);
  });

  it('defaults the model and allows pinning a dated alias', async () => {
    const a = jsonFetch(200, reply('x'));
    await new MistralSmallAdapter({ apiKey: 'k', fetch: a }).complete(request);
    expect(bodyOf(a).model).toBe('mistral-small-latest');

    const b = jsonFetch(200, reply('x'));
    await new MistralSmallAdapter({ apiKey: 'k', fetch: b, model: 'mistral-small-2506' }).complete(
      request,
    );
    expect(bodyOf(b).model).toBe('mistral-small-2506');
  });

  it('sends max_tokens only when maxOutputTokens is provided', async () => {
    const without = jsonFetch(200, reply('x'));
    await new MistralSmallAdapter({ apiKey: 'k', fetch: without }).complete(request);
    expect(bodyOf(without)).not.toHaveProperty('max_tokens');

    const withCap = jsonFetch(200, reply('x'));
    await new MistralSmallAdapter({ apiKey: 'k', fetch: withCap }).complete({
      ...request,
      maxOutputTokens: 256,
    });
    expect(bodyOf(withCap).max_tokens).toBe(256);
  });

  it('honours a custom baseUrl (self-host mirrors)', async () => {
    const fetchImpl = jsonFetch(200, reply('x'));
    await new MistralSmallAdapter({
      apiKey: 'k',
      fetch: fetchImpl,
      baseUrl: 'https://mirror.example/v1/chat/completions',
    }).complete(request);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://mirror.example/v1/chat/completions');
  });
});

describe('MistralSmallAdapter — responses (AC1)', () => {
  it('returns the assistant content verbatim, adding no interpretation', async () => {
    const fetchImpl = jsonFetch(200, reply('  cleaned text  '));
    const out = await new MistralSmallAdapter({ apiKey: 'k', fetch: fetchImpl }).complete(request);
    expect(out).toBe('  cleaned text  ');
  });

  it('returns an empty string reply as-is (the caller decides what it means)', async () => {
    const fetchImpl = jsonFetch(200, reply(''));
    await expect(
      new MistralSmallAdapter({ apiKey: 'k', fetch: fetchImpl }).complete(request),
    ).resolves.toBe('');
  });

  it('surfaces a non-2xx status with its detail', async () => {
    const fetchImpl = jsonFetch(429, { message: 'rate limited' });
    await expect(
      new MistralSmallAdapter({ apiKey: 'k', fetch: fetchImpl }).complete(request),
    ).rejects.toThrow(/HTTP 429/);
  });

  it('surfaces a non-JSON body', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>502</html>', { status: 200 }));
    await expect(
      new MistralSmallAdapter({ apiKey: 'k', fetch: fetchImpl }).complete(request),
    ).rejects.toThrow(/non-JSON/);
  });

  it('rejects an unexpected shape rather than inventing content', async () => {
    for (const body of [{}, { choices: [] }, { choices: [{}] }, reply(null), reply(42)]) {
      const fetchImpl = jsonFetch(200, body);
      await expect(
        new MistralSmallAdapter({ apiKey: 'k', fetch: fetchImpl }).complete(request),
      ).rejects.toThrow(/unexpected response/);
    }
  });

  it('reports a timeout distinctly from a network error', async () => {
    const timeout = vi.fn(async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    });
    await expect(
      new MistralSmallAdapter({ apiKey: 'k', fetch: timeout, timeoutMs: 5 }).complete(request),
    ).rejects.toThrow(/timed out after 5ms/);

    const offline = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(
      new MistralSmallAdapter({ apiKey: 'k', fetch: offline }).complete(request),
    ).rejects.toThrow(/network error \(ECONNREFUSED\)/);
  });
});
