import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { EngineRegistry } from '@datadosomething/core';
import { convert, type OutputKind } from './convert';
import { composeEngines } from './engines';
import { renderPage } from './ui';
import { maxUploadBytes } from './upload';

/**
 * The thin self-host API + minimal UI (AC1), on `node:http` with **zero**
 * dependencies.
 *
 * Routes:
 *   GET  /                 → the one-page UI
 *   GET  /healthz          → { ok: true }
 *   POST /api/pdftomd      → { markdown, nettoyage? }
 *   POST /api/pdftojson    → { json, nettoyage? }
 *   anything else          → 404
 *
 * **No quota, no rate limit, no page cap, no auth, no ads, no payment.** That is
 * the specified behaviour, not an omission: the operator supplies the keys and
 * owns the cost, and the architecture's rollout rule exempts self-host from the
 * gate the hosted hub needs.
 *
 * Zero-retention (AD-7): request bytes live only for the request, nothing is
 * written to disk or a database, and every response carries `no-store`.
 *
 * Why `node:http` rather than a framework: selfhost needs one page and two
 * endpoints, and every dependency added here has to clear AD-9's license review
 * and lands in the image others run. Multipart still gets a real parser — the
 * platform's — by re-wrapping the buffered body in a `Request` (see `toRequest`).
 */

export interface SelfhostServerOptions {
  /** Injectable so tests need no keys and no network. Defaults to env composition. */
  engines?: EngineRegistry;
  env?: Record<string, string | undefined>;
}

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...NO_STORE,
  });
  res.end(payload);
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    ...NO_STORE,
  });
  res.end(html);
}

/**
 * Margin covering multipart framing (boundaries, part headers) so a file that is
 * itself within the bound is never rejected for its envelope.
 */
const MULTIPART_OVERHEAD_MARGIN = 1024 * 1024;

/**
 * Buffer the request body, refusing to RETAIN more than `limit` (+ margin).
 *
 * The bound is enforced HERE, while streaming, not later in `validateUpload`:
 * checking a `File`'s size only helps once the whole body is already in memory,
 * which is exactly the moment a pathological upload would have exhausted it. A
 * `limit` of `0` means the operator lifted the bound deliberately.
 *
 * Once over the bound we stop retaining data but keep draining the stream. That
 * keeps memory constant AND lets the client finish its upload and read a real
 * `413` — destroying the socket instead produces a bare connection reset, which
 * tells the operator nothing about what went wrong.
 */
async function readBody(
  req: IncomingMessage,
  limit: number,
): Promise<{ ok: true; body: Buffer } | { ok: false }> {
  const ceiling = limit > 0 ? limit + MULTIPART_OVERHEAD_MARGIN : 0;
  const chunks: Buffer[] = [];
  let total = 0;
  let overBound = false;

  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (!overBound && ceiling > 0 && total > ceiling) {
      overBound = true;
      chunks.length = 0; // release what we already held
    }
    if (!overBound) chunks.push(buf);
  }

  return overBound ? { ok: false } : { ok: true, body: Buffer.concat(chunks) };
}

/**
 * Wrap a buffered Node request as a WHATWG `Request` so `.formData()` gives us
 * the platform's multipart parser (undici — the same one Next uses in the hub).
 * This is what keeps the dependency count at zero without hand-rolling multipart.
 */
function toRequest(req: IncomingMessage, body: Buffer): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else headers.set(name, value);
  }
  return new Request(`http://localhost${req.url ?? '/'}`, {
    method: req.method ?? 'GET',
    headers,
    body: new Uint8Array(body),
  });
}

const ENDPOINTS: Record<string, OutputKind> = {
  '/api/pdftomd': 'markdown',
  '/api/pdftojson': 'json',
};

export function createSelfhostServer(options: SelfhostServerOptions = {}): Server {
  const env = options.env ?? process.env;
  // Composed once at startup, exactly as the AC describes ("when the app starts").
  const engines = options.engines ?? composeEngines(env);

  return createServer((req, res) => {
    void (async () => {
      // Strip any query string; this app has no query parameters.
      const pathname = (req.url ?? '/').split('?')[0] ?? '/';
      const method = req.method ?? 'GET';

      try {
        if (pathname === '/' && method === 'GET') {
          sendHtml(res, 200, renderPage());
          return;
        }

        if (pathname === '/healthz' && method === 'GET') {
          sendJson(res, 200, { ok: true });
          return;
        }

        const kind = ENDPOINTS[pathname];
        if (kind) {
          if (method !== 'POST') {
            res.writeHead(405, { Allow: 'POST', ...NO_STORE });
            res.end();
            return;
          }
          const limit = maxUploadBytes(env);
          const read = await readBody(req, limit);
          if (!read.ok) {
            sendJson(res, 413, {
              error: `That upload is over the ${limit} byte bound. Raise MAX_UPLOAD_BYTES, or set it to 0 to lift the bound.`,
            });
            return;
          }

          let form: FormData;
          try {
            form = await toRequest(req, read.body).formData();
          } catch {
            sendJson(res, 400, {
              error: 'Expected a multipart form upload with a "file" field.',
            });
            return;
          }
          const outcome = await convert(kind, form, { engines, env });
          sendJson(res, outcome.status, outcome.body);
          return;
        }

        sendJson(res, 404, { error: 'Not found.' });
      } catch (cause) {
        // Last-resort guard: never leave a socket hanging, never leak a stack.
        const detail = cause instanceof Error ? cause.message : 'Unknown error.';
        if (!res.headersSent) sendJson(res, 500, { error: `Request failed — ${detail}` });
        else res.end();
      }
    })();
  });
}
