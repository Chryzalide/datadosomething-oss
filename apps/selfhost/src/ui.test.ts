import { describe, expect, it } from 'vitest';
import { renderPage } from './ui';

const page = renderPage();

describe('the minimal UI page (AC1)', () => {
  it('is a complete, self-contained HTML document', () => {
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).toContain('<html lang="en">');
    expect(page).toContain('</html>');
    expect(page).toContain('<style>');
    expect(page).toContain('<script type="module">');
  });

  it('offers both tools', () => {
    expect(page).toContain('value="markdown"');
    expect(page).toContain('value="json"');
    expect(page).toContain('/api/pdftomd');
    expect(page).toContain('/api/pdftojson');
  });

  it('exposes a file input accepting PDF, PNG and JPG', () => {
    expect(page).toMatch(/accept="[^"]*application\/pdf/);
    expect(page).toMatch(/accept="[^"]*image\/png/);
    expect(page).toMatch(/accept="[^"]*image\/jpeg/);
  });

  it('is deterministic — no timestamp, nonce or random value', () => {
    expect(renderPage()).toBe(page);
  });
});

describe('no CDN, no font, no tracker — mechanically (AD-9 / NFR-7)', () => {
  it('contains no external URL of any kind', () => {
    // The whole point of an inline page: nothing may be fetched from a third
    // party, so no visitor IP can leak and the zero-tracker posture holds. This
    // is the assertion that keeps that true as the page grows.
    const externals = page.match(/https?:\/\/[^"'\s)]+|\/\/[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
    expect(externals).toEqual([]);
  });

  it('declares no external resource elements', () => {
    expect(page).not.toMatch(/<link\b/i);
    expect(page).not.toMatch(/<script\b[^>]*\bsrc=/i);
    expect(page).not.toMatch(/@import/i);
    expect(page).not.toMatch(/<iframe\b/i);
    expect(page).not.toMatch(/<img\b/i);
  });
});

describe('accessibility of the minimal UI (NFR-9)', () => {
  it('labels every control', () => {
    expect(page).toContain('<label for="file">');
    // The output choice is a real radio group with a legend, not bare inputs.
    expect(page).toContain('<fieldset>');
    expect(page).toContain('<legend>Output</legend>');
    expect(page).toMatch(/<label><input type="radio" name="kind" value="markdown"/);
  });

  it('pairs the error with an icon, never colour alone (UX-DR10 / NFR-9)', () => {
    // The alert must carry a non-colour signal. The glyph is aria-hidden so a
    // screen reader gets the text only, not "warning sign warning sign".
    const alert = /<p class="alert hidden" id="error" role="alert">([\s\S]*?)<\/p>/.exec(page);
    expect(alert).not.toBeNull();
    expect(alert?.[1]).toContain('aria-hidden="true"');
    expect(alert?.[1]).toContain('id="error-text"');
  });

  it('writes error text into a span, so the icon is never overwritten', () => {
    // A regression guard: setting textContent on the <p> would delete the glyph.
    expect(page).toContain("getElementById('error-text')");
    expect(page).not.toMatch(/errorBox\.textContent\s*=/);
  });

  it('announces errors and status through live regions', () => {
    expect(page).toContain('role="alert"');
    expect(page).toContain('role="status"');
    expect(page).toContain('aria-live="polite"');
  });

  it('keeps a visible focus ring', () => {
    expect(page).toContain(':focus-visible');
  });

  it('tells the operator how to turn Nettoyage off', () => {
    // Nettoyage is on by default here, so the page has to say so and name the lever.
    expect(page).toContain('NETTOYAGE_ENABLED=false');
  });

  it('asks not to be indexed — a self-hosted instance is not a public page', () => {
    expect(page).toContain('name="robots" content="noindex"');
  });

  it('defines .visually-hidden CSS so #status does not render visibly beside #notice (2.3.1)', () => {
    expect(page).toContain('.visually-hidden');
    expect(page).toMatch(/\.visually-hidden\s*\{[^}]*clip:\s*rect\(0,\s*0,\s*0,\s*0\)/);
  });

  it('derives the download filename from the uploaded file stem, contains drag & drop, pages and nettoyage controls (2.3)', () => {
    expect(page).toContain('function stemOf(filename)');
    expect(page).toContain("anchor.download = downloadStem + '.' + extension");
    expect(page).toContain('id="dropzone"');
    expect(page).toContain('id="pages"');
    expect(page).toContain('id="nettoyage"');
    expect(page).toContain('id="source-meta"');
  });
});
