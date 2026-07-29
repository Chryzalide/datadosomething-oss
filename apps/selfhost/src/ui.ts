import { UPLOAD_ACCEPT_ATTR } from './upload';

/**
 * The minimal self-host UI (AC1): one self-contained page, no build step.
 *
 * Constraints this page is built to satisfy:
 *  - **No CDN, no web font, no tracker, no external request of any kind**
 *    (AD-9 / NFR-7). Everything is inline; `ui.test.ts` asserts mechanically
 *    that the markup contains no external URL.
 *  - **DESIGN.md's Cobalt palette.** The hub's `tokens.css` cannot be imported
 *    (AD-1 — selfhost ships without the hub), so the same values are carried in
 *    the token block below. A shared `packages/design-tokens` is the eventual
 *    fix; the duplication is logged in `deferred-work.md`.
 *  - **Accessible by construction:** a real label per control, a radio group in a
 *    `<fieldset>` with a `<legend>`, `role="alert"` for errors, `role="status"`
 *    for progress and the Nettoyage notice, and a visible focus ring.
 *
 * Deliberately smaller than the hub's page: no hero, no i18n, no marketing. The
 * self-hoster wants a working converter, and every byte here ships in the image
 * other people run.
 */

const STYLES = `
:root {
  --cobalt: #2f4bff;
  --on-cobalt: #ffffff;
  --coral: #ff5d47;
  --mint: #5ff0c9;
  --ink: #0b0b0f;
  --paper: #f7f7f2;
  --surface: #ffffff;
  --muted: #55555f;
  --outline: #0b0b0f;
  --border-width: 2px;
  --radius: 10px;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --sans: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 2rem 1rem; background: var(--paper); color: var(--ink);
  font-family: var(--sans); line-height: 1.55;
}
main { max-width: 52rem; margin: 0 auto; }
h1 { font-size: 1.9rem; letter-spacing: -0.02em; margin: 0 0 0.25rem; }
.lede { color: var(--muted); margin: 0 0 2rem; }
.card {
  background: var(--surface); border: var(--border-width) solid var(--outline);
  border-radius: var(--radius); padding: 1.25rem; margin-bottom: 1.25rem;
}
fieldset { border: var(--border-width) solid var(--outline); border-radius: var(--radius); margin: 0 0 1rem; }
legend { font-weight: 700; padding: 0 0.4rem; }
label { display: block; font-weight: 600; margin-bottom: 0.35rem; }
.radio { display: flex; gap: 1.25rem; }
.radio label { display: flex; gap: 0.4rem; align-items: center; font-weight: 500; margin: 0; }
input[type="file"] { width: 100%; font: inherit; }
button {
  font: inherit; font-weight: 700; cursor: pointer;
  background: var(--cobalt); color: var(--on-cobalt);
  border: var(--border-width) solid var(--outline); border-radius: var(--radius);
  padding: 0.6rem 1.1rem;
}
button.secondary { background: var(--surface); color: var(--ink); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
:focus-visible { outline: 3px solid var(--cobalt); outline-offset: 2px; }
.actions { display: flex; gap: 0.6rem; margin-top: 1rem; }
.alert { border-left: var(--border-width) solid var(--coral); padding: 0.6rem 0.8rem; margin-top: 1rem; }
.notice { border-left: var(--border-width) solid var(--mint); padding: 0.6rem 0.8rem; margin-bottom: 0.8rem; }
.notice.raw { border-left-color: var(--coral); }
pre {
  font-family: var(--mono); font-size: 0.85rem; white-space: pre-wrap; word-break: break-word;
  background: var(--paper); border: var(--border-width) solid var(--outline);
  border-radius: var(--radius); padding: 0.9rem; max-height: 28rem; overflow: auto; margin: 0;
}
.hidden { display: none; }
footer { color: var(--muted); font-size: 0.85rem; margin-top: 2rem; }
`;

// Inline module script. No bundler, no framework, no external request.
const SCRIPT = `
const form = document.getElementById('convert-form');
const fileInput = document.getElementById('file');
const cta = document.getElementById('cta');
const errorBox = document.getElementById('error');
const errorText = document.getElementById('error-text');
const statusBox = document.getElementById('status');
const result = document.getElementById('result');
const noticeBox = document.getElementById('notice');
const output = document.getElementById('output');
const copyBtn = document.getElementById('copy');
const downloadBtn = document.getElementById('download');

let sortie = '';
let extension = 'md';

const NOTICES = {
  cleaned: ['notice', 'Cleaned - OCR noise removed, wording unchanged.'],
  'rule-only': ['notice raw', 'Showing the raw output: the cleanup was rejected because it would have altered your content.'],
};

// Spelled out rather than concatenated, so the endpoints this page talks to are
// greppable in the served markup.
const ENDPOINTS = { markdown: '/api/pdftomd', json: '/api/pdftojson' };

function show(el, on) { el.classList.toggle('hidden', !on); }

function reset() {
  errorText.textContent = '';
  show(errorBox, false);
  show(result, false);
  show(noticeBox, false);
}

fileInput.addEventListener('change', () => {
  reset();
  cta.disabled = fileInput.files.length === 0;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = fileInput.files[0];
  if (!file) return;

  const kind = form.querySelector('input[name="kind"]:checked').value;
  extension = kind === 'json' ? 'json' : 'md';

  reset();
  cta.disabled = true;
  statusBox.textContent = 'Converting...';

  try {
    const body = new FormData();
    body.append('file', file);
    const response = await fetch(ENDPOINTS[kind], { method: 'POST', body });
    const data = await response.json().catch(() => ({}));
    const value = kind === 'json' ? data.json : data.markdown;

    if (!response.ok || typeof value !== 'string') {
      statusBox.textContent = '';
      errorText.textContent = typeof data.error === 'string' && data.error
        ? data.error
        : 'Conversion failed. Check the server logs.';
      show(errorBox, true);
      return;
    }

    sortie = value;
    output.textContent = value;
    const outcome = data.nettoyage && data.nettoyage.outcome;
    const notice = NOTICES[outcome];
    if (notice) {
      noticeBox.className = notice[0];
      noticeBox.textContent = notice[1];
      show(noticeBox, true);
    }
    statusBox.textContent = 'Done.' + (notice ? ' ' + notice[1] : '');
    show(result, true);
  } catch (cause) {
    statusBox.textContent = '';
    errorText.textContent = 'Could not reach the server. Is it still running?';
    show(errorBox, true);
  } finally {
    cta.disabled = fileInput.files.length === 0;
  }
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(sortie);
    copyBtn.textContent = 'Copied.';
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
  } catch (cause) { /* clipboard may be unavailable */ }
});

downloadBtn.addEventListener('click', () => {
  const mime = extension === 'json' ? 'application/json' : 'text/markdown';
  const blob = new Blob([sortie], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'document.' + extension;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
});
`;

/** Render the single page. Pure — same output every call. */
export function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>datadosomething - self-hosted</title>
<meta name="robots" content="noindex">
<style>${STYLES}</style>
</head>
<body>
<main>
  <h1>datadosomething</h1>
  <p class="lede">Self-hosted. Your keys, your infrastructure, no quota, nothing stored.</p>

  <form class="card" id="convert-form">
    <label for="file">PDF or scanned image (PNG/JPG)</label>
    <input type="file" id="file" name="file" accept="${UPLOAD_ACCEPT_ATTR}" required>

    <fieldset>
      <legend>Output</legend>
      <div class="radio">
        <label><input type="radio" name="kind" value="markdown" checked> Markdown (.md)</label>
        <label><input type="radio" name="kind" value="json"> Structured JSON (.json)</label>
      </div>
    </fieldset>

    <button type="submit" id="cta" disabled>Convert</button>

    <p class="alert hidden" id="error" role="alert">
      <span aria-hidden="true">&#9888; </span><span id="error-text"></span>
    </p>
    <p class="visually-hidden" id="status" role="status" aria-live="polite"></p>
  </form>

  <section class="card hidden" id="result" aria-label="Conversion result">
    <p class="notice hidden" id="notice" role="status"></p>
    <pre id="output"></pre>
    <div class="actions">
      <button type="button" class="secondary" id="copy">Copy</button>
      <button type="button" id="download">Download</button>
    </div>
  </section>

  <footer>
    Nettoyage runs by default on a self-hosted instance. Set
    <code>NETTOYAGE_ENABLED=false</code> to turn it off.
  </footer>
</main>
<script type="module">${SCRIPT}</script>
</body>
</html>
`;
}
