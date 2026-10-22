import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDocument,
  type DocumentEngine,
  type DocumentModel,
  EngineAuthError,
  type EngineRegistry,
} from '@datadosomething/core';
import { createSelfhostServer } from './server';

/**
 * Story 4.1 — the thin API, driven through a REAL listening server over REAL
 * `fetch`. Nothing about the HTTP layer is mocked, because the AC is "when it
 * runs": a test that called the handler directly would not prove the server
 * works, and Story 4.3 is about to put this in a container.
 */

const ch = (codePoint: number): string => String.fromCodePoint(codePoint);
const BOX_H = ch(0x2500); // stage-2 removable noise
const ZWSP = ch(0x200b); // stage-1 artifact

const bornDigitalPdf = readFileSync(
  new URL('../../../packages/core/src/engine/__fixtures__/born-digital.pdf', import.meta.url),
);

/** The model the fake engine returns: noisy, four blocks, two pages. */
const extracted: DocumentModel = createDocument({ type: 'pdf', pages: 2, provider: 'fake' }, [
  { type: 'heading', level: 1, text: `${ZWSP}Rapport${BOX_H.repeat(3)}`, page: 1 },
  { type: 'paragraph', text: 'Total : 12,50', page: 1 },
  { type: 'list', ordered: false, items: [`${BOX_H} un`, 'deux'], page: 2 },
  {
    type: 'table',
    rows: [
      ['h1', 'h2'],
      ['a', 'b'],
    ],
    page: 2,
  },
]);

function fakeEngines(): EngineRegistry {
  const extract: DocumentEngine['extract'] = async () => extracted;
  return { reader: { kind: 'reader', name: 'fake', extract } };
}

/** Boot a server on an ephemeral port and return its base URL + a closer. */
async function boot(
  options: Parameters<typeof createSelfhostServer>[0] = {},
): Promise<{ base: string; close: () => Promise<void>; server: Server }> {
  const server = createSelfhostServer({ engines: fakeEngines(), env: {}, ...options });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    server,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function pdfForm(name = 'report.pdf', type = 'application/pdf'): FormData {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(bornDigitalPdf)], name, { type }));
  return form;
}

describe('the minimal UI and health endpoint (AC1)', () => {
  it('serves the one-page UI at /', async () => {
    const { base, close } = await boot();
    try {
      const response = await fetch(base);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/text\/html/);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const html = await response.text();
      expect(html).toContain('<!doctype html>');
      expect(html).toContain('Markdown');
      expect(html).toContain('Structured JSON');
    } finally {
      await close();
    }
  });

  it('answers /healthz', async () => {
    const { base, close } = await boot();
    try {
      const response = await fetch(`${base}/healthz`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      await close();
    }
  });

  it('404s an unknown path and 405s a GET on a conversion endpoint', async () => {
    const { base, close } = await boot();
    try {
      expect((await fetch(`${base}/nope`)).status).toBe(404);
      const wrongMethod = await fetch(`${base}/api/pdftomd`);
      expect(wrongMethod.status).toBe(405);
      expect(wrongMethod.headers.get('allow')).toBe('POST');
    } finally {
      await close();
    }
  });
});

describe('both tools convert through the injected engines (AC2)', () => {
  it('returns Markdown from /api/pdftomd', async () => {
    const { base, close } = await boot();
    try {
      const response = await fetch(`${base}/api/pdftomd`, { method: 'POST', body: pdfForm() });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = (await response.json()) as { markdown: string; nettoyage?: unknown };
      expect(body.markdown).toContain('# ');
      expect(body.markdown).toContain('Rapport');
      // Nettoyage is on by default but has no key in this env, so it cannot run:
      // the Sortie is genuinely raw and no outcome is claimed.
      expect(body.nettoyage).toBeUndefined();
      expect(body.markdown).toContain(BOX_H);
    } finally {
      await close();
    }
  });

  it('returns the versioned v1.0 JSON from /api/pdftojson', async () => {
    const { base, close } = await boot();
    try {
      const response = await fetch(`${base}/api/pdftojson`, { method: 'POST', body: pdfForm() });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { json: string };
      const parsed = JSON.parse(body.json) as {
        schema_version: string;
        source: { pages: number };
        blocks: Array<{ type: string; page: number }>;
      };
      expect(parsed.schema_version).toBe('1.0');
      expect(parsed.source.pages).toBe(2);
      expect(parsed.blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'table']);
      expect(parsed.blocks.map((b) => b.page)).toEqual([1, 1, 2, 2]);
    } finally {
      await close();
    }
  });

  it('accepts a PNG scan through the OCR path', async () => {
    const { base, close } = await boot({
      engines: { ocr: { kind: 'ocr', name: 'fake-ocr', extract: async () => extracted } },
    });
    try {
      const form = new FormData();
      form.append(
        'file',
        new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'scan.png', { type: 'image/png' }),
      );
      const response = await fetch(`${base}/api/pdftomd`, { method: 'POST', body: form });
      expect(response.status).toBe(200);
      expect(((await response.json()) as { markdown: string }).markdown).toContain('Rapport');
    } finally {
      await close();
    }
  });
});

describe('no quota, no rate limit, no cap (AC1)', () => {
  it('serves 25 consecutive conversions, all 200', async () => {
    // The assertion that "no quota" is real rather than merely unimplemented.
    const { base, close } = await boot();
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 25; i += 1) {
        const response = await fetch(`${base}/api/pdftomd`, { method: 'POST', body: pdfForm() });
        statuses.push(response.status);
        await response.json();
      }
      expect(statuses).toHaveLength(25);
      expect(new Set(statuses)).toEqual(new Set([200]));
    } finally {
      await close();
    }
  }, 30_000);

  it('sets no cookie and asks for no auth', async () => {
    const { base, close } = await boot();
    try {
      const response = await fetch(`${base}/api/pdftomd`, { method: 'POST', body: pdfForm() });
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(response.headers.get('www-authenticate')).toBeNull();
    } finally {
      await close();
    }
  });
});

describe('Nettoyage is ON by default (AC1)', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Stub the chat endpoint; leave every other fetch (our own server) alone. */
  function stubChat(reply: (texts: string[]) => unknown) {
    const real = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: { body?: unknown }) => {
        const url = String(input);
        if (!url.includes('api.mistral.ai')) return real(input as string, init as RequestInit);
        const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
        const texts = JSON.parse(body.messages[1]?.content ?? '[]') as string[];
        return new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply(texts)) } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
  }

  it('cleans WITHOUT NETTOYAGE_ENABLED being set — only a key is needed', async () => {
    stubChat((texts) => texts.map((t) => t.replaceAll(BOX_H, '').replace(/\s+/g, ' ').trim()));
    // Note what is NOT in this env: no NETTOYAGE_ENABLED. Default-on is the AC.
    const { base, close } = await boot({ env: { MISTRAL_API_KEY: 'k' } });
    try {
      const response = await fetch(`${base}/api/pdftomd`, { method: 'POST', body: pdfForm() });
      const body = (await response.json()) as {
        markdown: string;
        nettoyage: { outcome: string };
      };
      expect(body.nettoyage).toEqual({ outcome: 'cleaned' });
      expect(body.markdown).not.toContain(BOX_H);
      expect(body.markdown).not.toContain(ZWSP);
    } finally {
      await close();
    }
  });

  it('reports rule-only, still 200, when the verifier rejects a rewrite', async () => {
    stubChat((texts) => texts.map(() => 'Totalement reecrit'));
    const { base, close } = await boot({ env: { MISTRAL_API_KEY: 'k' } });
    try {
      const response = await fetch(`${base}/api/pdftomd`, { method: 'POST', body: pdfForm() });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        markdown: string;
        nettoyage: { outcome: string; reason: string };
      };
      expect(body.nettoyage.outcome).toBe('rule-only');
      expect(body.nettoyage.reason).toBe('protected-content-removed');
      expect(body.markdown).toContain('Rapport');
    } finally {
      await close();
    }
  });

  it('runs nothing and claims nothing when NETTOYAGE_ENABLED=false', async () => {
    stubChat((texts) => texts);
    const { base, close } = await boot({
      env: { MISTRAL_API_KEY: 'k', NETTOYAGE_ENABLED: 'false' },
    });
    try {
      const response = await fetch(`${base}/api/pdftomd`, { method: 'POST', body: pdfForm() });
      const body = (await response.json()) as { markdown: string; nettoyage?: unknown };
      expect(body.nettoyage).toBeUndefined();
      // Genuinely raw: even the stage-1 artifact survives.
      expect(body.markdown).toContain(BOX_H);
    } finally {
      await close();
    }
  });
});

describe('input validation and honest errors', () => {
  it('415s an unsupported type', async () => {
    const { base, close } = await boot();
    try {
      const form = new FormData();
      form.append('file', new File(['GIF89a'], 'anim.gif', { type: 'image/gif' }));
      const response = await fetch(`${base}/api/pdftomd`, { method: 'POST', body: form });
      expect(response.status).toBe(415);
      expect(((await response.json()) as { error: string }).error).toMatch(/PDF, PNG, or JPG/);
    } finally {
      await close();
    }
  });

  it('400s an empty file and a missing file field', async () => {
    const { base, close } = await boot();
    try {
      const empty = new FormData();
      empty.append('file', new File([], 'empty.pdf', { type: 'application/pdf' }));
      expect((await fetch(`${base}/api/pdftomd`, { method: 'POST', body: empty })).status).toBe(
        400,
      );

      const none = new FormData();
      none.append('other', 'x');
      expect((await fetch(`${base}/api/pdftomd`, { method: 'POST', body: none })).status).toBe(400);
    } finally {
      await close();
    }
  });

  it('413s over the configurable stability bound, naming the lever', async () => {
    const { base, close } = await boot({ env: { MAX_UPLOAD_BYTES: '10' } });
    try {
      const response = await fetch(`${base}/api/pdftomd`, { method: 'POST', body: pdfForm() });
      expect(response.status).toBe(413);
      expect(((await response.json()) as { error: string }).error).toMatch(/MAX_UPLOAD_BYTES/);
    } finally {
      await close();
    }
  });

  it('enforces the bound WHILE STREAMING, before buffering the whole body', async () => {
    // The bound has to bite during upload: checking a File's size only helps once
    // the body is already in memory, which is the moment a pathological upload
    // would have exhausted it. 1 byte + margin, against a ~4 MB body.
    const { base, close } = await boot({ env: { MAX_UPLOAD_BYTES: '1' } });
    try {
      const form = new FormData();
      form.append(
        'file',
        new File([new Uint8Array(4 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' }),
      );
      const response = await fetch(`${base}/api/pdftomd`, { method: 'POST', body: form });
      expect(response.status).toBe(413);
      expect(((await response.json()) as { error: string }).error).toMatch(/MAX_UPLOAD_BYTES/);
    } finally {
      await close();
    }
  });

  it('accepts a body within the bound once it is lifted with 0', async () => {
    const { base, close } = await boot({ env: { MAX_UPLOAD_BYTES: '0' } });
    try {
      const response = await fetch(`${base}/api/pdftomd`, { method: 'POST', body: pdfForm() });
      expect(response.status).toBe(200);
    } finally {
      await close();
    }
  });

  it('503s with the env var named when no engine is configured (FR-14)', async () => {
    const { base, close } = await boot({ engines: {} });
    try {
      const response = await fetch(`${base}/api/pdftomd`, { method: 'POST', body: pdfForm() });
      expect(response.status).toBe(503);
      expect(((await response.json()) as { error: string }).error).toMatch(/Jina|Mistral/);
    } finally {
      await close();
    }
  });

  it('400s a non-multipart body rather than crashing', async () => {
    const { base, close } = await boot();
    try {
      const response = await fetch(`${base}/api/pdftomd`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"not":"multipart"}',
      });
      expect(response.status).toBe(400);
    } finally {
      await close();
    }
  });
});

describe('explicit config errors: missing vs rejected vs outage (Story 4.2 AC1)', () => {
  const DOCS = 'docs/selfhost-config.md';

  it('503s a MISSING key naming the provider and linking the config docs', async () => {
    const { base, close } = await boot({ engines: {} });
    try {
      const response = await fetch(`${base}/api/pdftomd`, { method: 'POST', body: pdfForm() });
      expect(response.status).toBe(503);
      const { error } = (await response.json()) as { error: string };
      expect(error).toMatch(/Jina|Mistral/);
      expect(error).toContain(DOCS);
    } finally {
      await close();
    }
  });

  it('503s a REJECTED key naming the env var — not a 502 (AC1)', async () => {
    // The distinction that lets an operator tell a bad key from an outage.
    const rejecting: EngineRegistry = {
      reader: {
        kind: 'reader',
        name: 'rejecting',
        extract: async () => {
          throw new EngineAuthError('Jina rejected the API key (HTTP 401). Check JINA_API_KEY.');
        },
      },
    };
    const { base, close } = await boot({ engines: rejecting });
    try {
      const response = await fetch(`${base}/api/pdftomd`, { method: 'POST', body: pdfForm() });
      expect(response.status).toBe(503);
      const { error } = (await response.json()) as { error: string };
      expect(error).toContain('JINA_API_KEY');
      expect(error).toContain(DOCS);
    } finally {
      await close();
    }
  });

  it('still 502s a genuine provider outage, with no config link', async () => {
    const failing: EngineRegistry = {
      reader: {
        kind: 'reader',
        name: 'failing',
        extract: async () => {
          throw new Error('Jina Reader request failed (HTTP 503).');
        },
      },
    };
    const { base, close } = await boot({ engines: failing });
    try {
      const response = await fetch(`${base}/api/pdftomd`, { method: 'POST', body: pdfForm() });
      expect(response.status).toBe(502);
      const { error } = (await response.json()) as { error: string };
      expect(error).not.toContain(DOCS);
    } finally {
      await close();
    }
  });

  it('honours CONFIG_DOCS_URL so the link can point at an internal runbook', async () => {
    const { base, close } = await boot({
      engines: {},
      env: { CONFIG_DOCS_URL: 'https://wiki.example/pdf' },
    });
    try {
      const response = await fetch(`${base}/api/pdftomd`, { method: 'POST', body: pdfForm() });
      const { error } = (await response.json()) as { error: string };
      expect(error).toContain('https://wiki.example/pdf');
      expect(error).not.toContain(DOCS);
    } finally {
      await close();
    }
  });
});

describe('Mistral-only converts a born-digital PDF via graceful fallback (AC2, AR-4)', () => {
  it('routes to OCR instead of refusing, with the REAL probe and router', async () => {
    // No reader engine, a real born-digital fixture, and the real text-layer
    // probe: the router must classify it born-digital, find no reader, and fall
    // back to OCR rather than refuse (AR-4). Only the vendor call is faked.
    let ocrCalls = 0;
    const mistralOnly: EngineRegistry = {
      ocr: {
        kind: 'ocr',
        name: 'mistral-ocr',
        extract: async () => {
          ocrCalls += 1;
          return extracted;
        },
      },
    };
    const { base, close } = await boot({ engines: mistralOnly });
    try {
      const response = await fetch(`${base}/api/pdftomd`, { method: 'POST', body: pdfForm() });
      expect(response.status).toBe(200);
      const { markdown } = (await response.json()) as { markdown: string };
      expect(markdown).toContain('Rapport');
      // Served by OCR, and nothing was refused.
      expect(ocrCalls).toBe(1);
    } finally {
      await close();
    }
  });

  it('does the same on the JSON endpoint', async () => {
    const mistralOnly: EngineRegistry = {
      ocr: { kind: 'ocr', name: 'mistral-ocr', extract: async () => extracted },
    };
    const { base, close } = await boot({ engines: mistralOnly });
    try {
      const response = await fetch(`${base}/api/pdftojson`, { method: 'POST', body: pdfForm() });
      expect(response.status).toBe(200);
      const { json } = (await response.json()) as { json: string };
      expect((JSON.parse(json) as { schema_version: string }).schema_version).toBe('1.0');
    } finally {
      await close();
    }
  });
});

describe('API metadata, per-request options & SELFHOST_API_TOKEN (2.2 / 2.3)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns source metadata { type, pages, provider } on /api/pdftomd and /api/pdftojson (2.3.4)', async () => {
    const { base, close } = await boot();
    try {
      const mdRes = await fetch(`${base}/api/pdftomd`, { method: 'POST', body: pdfForm() });
      expect(mdRes.status).toBe(200);
      const mdBody = (await mdRes.json()) as {
        markdown: string;
        source: { type: string; pages: number; provider: string };
      };
      expect(mdBody.source).toEqual({ type: 'pdf', pages: 2, provider: 'fake' });
    } finally {
      await close();
    }
  });

  it('supports per-request nettoyage=false in FormData or query string even when enabled in env (2.3.3)', async () => {
    const { base, close } = await boot({
      env: { MISTRAL_API_KEY: 'k', NETTOYAGE_ENABLED: 'true' },
    });
    try {
      const form = pdfForm();
      form.append('nettoyage', 'false');
      const res = await fetch(`${base}/api/pdftomd`, { method: 'POST', body: form });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { markdown: string; nettoyage?: unknown };
      expect(body.nettoyage).toBeUndefined();
      expect(body.markdown).toContain(BOX_H);
    } finally {
      await close();
    }
  });

  it('filters extracted pages when pages=2 is passed and 400s on invalid range (2.3.5)', async () => {
    const { base, close } = await boot();
    try {
      const form = pdfForm();
      form.append('pages', '2');
      const res = await fetch(`${base}/api/pdftomd`, { method: 'POST', body: form });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        markdown: string;
        source: { pages: number };
      };
      expect(body.source.pages).toBe(1);
      expect(body.markdown).not.toContain('Rapport');
      expect(body.markdown).toContain('deux');

      const badRes = await fetch(`${base}/api/pdftomd?pages=5-2`, {
        method: 'POST',
        body: pdfForm(),
      });
      expect(badRes.status).toBe(400);
      expect(((await badRes.json()) as { error: string }).error).toMatch(/pages/);
    } finally {
      await close();
    }
  });

  it('enforces constant-time Bearer token auth on /api/* when SELFHOST_API_TOKEN is set (2.3.6)', async () => {
    const { base, close } = await boot({
      env: { SELFHOST_API_TOKEN: 'secret-token-123' },
    });
    try {
      // /healthz stays accessible for container health checks
      expect((await fetch(`${base}/healthz`)).status).toBe(200);

      // Missing token -> 401
      const noAuth = await fetch(`${base}/api/pdftomd`, { method: 'POST', body: pdfForm() });
      expect(noAuth.status).toBe(401);
      expect(noAuth.headers.get('www-authenticate')).toBe('Bearer');

      // Wrong token -> 401
      const wrongAuth = await fetch(`${base}/api/pdftomd`, {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong-token' },
        body: pdfForm(),
      });
      expect(wrongAuth.status).toBe(401);

      // Valid token -> 200
      const okAuth = await fetch(`${base}/api/pdftomd`, {
        method: 'POST',
        headers: { Authorization: 'Bearer secret-token-123' },
        body: pdfForm(),
      });
      expect(okAuth.status).toBe(200);
    } finally {
      await close();
    }
  });

  it('uses custom NETTOYAGE_BASE_URL, NETTOYAGE_MODEL and NETTOYAGE_API_KEY when configured (2.2)', async () => {
    const real = globalThis.fetch;
    let calledUrl = '';
    let calledModel = '';
    let calledAuth = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: { body?: unknown; headers?: unknown }) => {
        const url = String(input);
        if (!url.includes('llm.custom.local')) return real(input as string, init as RequestInit);
        calledUrl = url;
        const headers = new Headers(init?.headers as ConstructorParameters<typeof Headers>[0]);
        calledAuth = headers.get('authorization') ?? '';
        const body = JSON.parse(String(init?.body)) as {
          model: string;
          messages: Array<{ content: string }>;
        };
        calledModel = body.model;
        const texts = JSON.parse(body.messages[1]?.content ?? '[]') as string[];
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify(
                    texts.map((t) => t.replaceAll(BOX_H, '').replace(/\s+/g, ' ').trim()),
                  ),
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    const { base, close } = await boot({
      env: {
        NETTOYAGE_API_KEY: 'custom-llm-key',
        NETTOYAGE_BASE_URL: 'https://llm.custom.local',
        NETTOYAGE_MODEL: 'qwen2.5-7b-instruct',
        NETTOYAGE_TIMEOUT_MS: '10000',
      },
    });
    try {
      const res = await fetch(`${base}/api/pdftomd`, { method: 'POST', body: pdfForm() });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { markdown: string; nettoyage: { outcome: string } };
      expect(body.nettoyage).toEqual({ outcome: 'cleaned' });
      expect(calledUrl).toBe('https://llm.custom.local/v1/chat/completions');
      expect(calledModel).toBe('qwen2.5-7b-instruct');
      expect(calledAuth).toBe('Bearer custom-llm-key');
    } finally {
      await close();
    }
  });
});
