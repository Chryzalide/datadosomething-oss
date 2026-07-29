import { describe, expect, it } from 'vitest';
import { configDiagnostics, configDocsUrl, configReport, withConfigDocs } from './config';

const DOCS = 'docs/selfhost-config.md';
const BOTH = { MISTRAL_API_KEY: 'm', JINA_API_KEY: 'j' };

/** Levels + the variable each diagnostic points at, for compact assertions. */
const shape = (env: Record<string, string | undefined>) =>
  configDiagnostics(env).map((d) => `${d.level}:${d.envVar ?? '-'}`);

describe('configDocsUrl (AC1)', () => {
  it('defaults to the in-repo reference', () => {
    expect(configDocsUrl({})).toBe(DOCS);
    expect(configDocsUrl({ CONFIG_DOCS_URL: '   ' })).toBe(DOCS);
  });

  it('lets an operator point at their own runbook', () => {
    expect(configDocsUrl({ CONFIG_DOCS_URL: 'https://wiki.example/pdf' })).toBe(
      'https://wiki.example/pdf',
    );
  });
});

describe('withConfigDocs (AC1)', () => {
  it('appends the docs pointer', () => {
    const out = withConfigDocs('Set MISTRAL_API_KEY.', {});
    expect(out).toContain('Set MISTRAL_API_KEY.');
    expect(out).toContain(DOCS);
  });

  it('appends it exactly once, however many times it is applied', () => {
    // Messages travel core -> converter -> UI; a doubled link reads like a bug.
    const once = withConfigDocs('Set MISTRAL_API_KEY.', {});
    const twice = withConfigDocs(once, {});
    expect(twice).toBe(once);
    expect(twice.match(new RegExp(DOCS.replace(/[.]/g, '\\.'), 'g'))).toHaveLength(1);
  });

  it('honours the override when appending', () => {
    expect(withConfigDocs('x', { CONFIG_DOCS_URL: 'https://wiki.example/pdf' })).toContain(
      'https://wiki.example/pdf',
    );
  });
});

describe('configDiagnostics (AC1, AC2)', () => {
  it('reports a single actionable error when nothing is configured', () => {
    // One instruction, not three: with no keys at all, every other diagnostic is
    // implied and would bury the one thing the operator must do.
    const diagnostics = configDiagnostics({});
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.level).toBe('error');
    expect(diagnostics[0]?.envVar).toBe('MISTRAL_API_KEY');
    expect(diagnostics[0]?.message).toContain('MISTRAL_API_KEY');
    expect(diagnostics[0]?.message).toContain('JINA_API_KEY');
  });

  it('is silent when both keys are present', () => {
    expect(configDiagnostics(BOTH)).toEqual([]);
  });

  it('errors on a missing Mistral key but says born-digital still works', () => {
    const diagnostics = configDiagnostics({ JINA_API_KEY: 'j' });
    // Two diagnostics: the error, plus the notice that Nettoyage cannot run
    // (it needs the same key).
    expect(shape({ JINA_API_KEY: 'j' })).toEqual([
      'error:MISTRAL_API_KEY',
      'notice:MISTRAL_API_KEY',
    ]);
    expect(diagnostics[0]?.message).toMatch(/scanned|images/i);
    expect(diagnostics[0]?.message).toMatch(/still convert/i);
  });

  it('notices a missing Jina key as a COST consequence, not a failure (AC2)', () => {
    const diagnostics = configDiagnostics({ MISTRAL_API_KEY: 'm' });
    expect(shape({ MISTRAL_API_KEY: 'm' })).toEqual(['notice:JINA_API_KEY']);
    // The operator must understand the fallback costs more, not that it is broken.
    expect(diagnostics[0]?.level).toBe('notice');
    expect(diagnostics[0]?.message).toMatch(/OCR/);
    expect(diagnostics[0]?.message).toMatch(/still work/i);
  });

  it('notices that Nettoyage cannot run without a Mistral key', () => {
    const env = { JINA_API_KEY: 'j' };
    const messages = configDiagnostics(env).map((d) => d.message);
    expect(messages.some((m) => /Nettoyage is enabled but needs MISTRAL_API_KEY/.test(m))).toBe(
      true,
    );
  });

  it('drops that notice when Nettoyage is switched off', () => {
    const env = { JINA_API_KEY: 'j', NETTOYAGE_ENABLED: 'false' };
    const diagnostics = configDiagnostics(env);
    // The missing-Mistral ERROR still mentions Nettoyage among the consequences;
    // what must disappear is the standalone notice about it.
    expect(diagnostics.some((d) => /Nettoyage is enabled but needs/.test(d.message))).toBe(false);
    expect(shape(env)).toEqual(['error:MISTRAL_API_KEY']);
  });

  it('treats a blank key as absent', () => {
    expect(configDiagnostics({ MISTRAL_API_KEY: '  ', JINA_API_KEY: '' })).toHaveLength(1);
  });

  it('lists errors before notices, so a startup log reads top-down', () => {
    const levels = configDiagnostics({ JINA_API_KEY: 'j' }).map((d) => d.level);
    expect(levels.indexOf('error')).toBeLessThan(levels.lastIndexOf('notice'));
  });
});

describe('configReport (AC1 — "or the app starts")', () => {
  it('is empty for a complete configuration', () => {
    expect(configReport(BOTH)).toEqual([]);
  });

  it('labels each line and carries the docs link on every one', () => {
    const lines = configReport({});
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[config error\]/);
    expect(lines[0]).toContain(DOCS);
  });

  it('distinguishes notices from errors in the label', () => {
    const lines = configReport({ MISTRAL_API_KEY: 'm' });
    expect(lines[0]).toMatch(/^\[config notice\]/);
  });
});
