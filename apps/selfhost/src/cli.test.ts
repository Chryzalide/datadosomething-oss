import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createDocument, type DocumentModel, type EngineRegistry } from '@datadosomething/core';
import { runCli } from './cli';

const bornDigitalPdfPath = fileURLToPath(
  new URL('../../../packages/core/src/engine/__fixtures__/born-digital.pdf', import.meta.url),
);

const sampleDoc: DocumentModel = createDocument({ type: 'pdf', pages: 2, provider: 'fake' }, [
  { type: 'heading', level: 1, text: 'CLI Report', page: 1 },
  { type: 'paragraph', text: 'Page one text.', page: 1 },
  { type: 'paragraph', text: 'Page two text.', page: 2 },
]);

const fakeEngines: EngineRegistry = {
  reader: { kind: 'reader', name: 'fake', extract: async () => sampleDoc },
};

describe('runCli (2.3.7)', () => {
  it('prints usage and exits 0 on --help', async () => {
    let stdout = '';
    const code = await runCli(['--help'], { stdout: (s) => (stdout += s) });
    expect(code).toBe(0);
    expect(stdout).toContain('datadosomething convert <file>');
  });

  it('converts a PDF to Markdown on stdout', async () => {
    let stdout = '';
    let stderr = '';
    const code = await runCli(['convert', bornDigitalPdfPath, '--format', 'md', '--no-nettoyage'], {
      stdout: (s) => (stdout += s),
      stderr: (s) => (stderr += s),
      engines: fakeEngines,
      env: {},
    });
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('# CLI Report');
    expect(stdout).toContain('Page one text.');
    expect(stdout).toContain('Page two text.');
  });

  it('converts a PDF to JSON and filters by --pages', async () => {
    let stdout = '';
    const code = await runCli(
      ['convert', bornDigitalPdfPath, '--format', 'json', '--pages', '2', '--no-nettoyage'],
      {
        stdout: (s) => (stdout += s),
        engines: fakeEngines,
        env: {},
      },
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as {
      source: { pages: number };
      blocks: Array<{ text: string; page: number }>;
    };
    expect(parsed.source.pages).toBe(1);
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0]?.page).toBe(2);
    expect(parsed.blocks[0]?.text).toBe('Page two text.');
  });

  it('exits 1 with an error on stderr when the command or format is invalid', async () => {
    let stderr = '';
    expect(await runCli(['unknown'], { stderr: (s) => (stderr += s) })).toBe(1);
    expect(stderr).toContain('Unknown command');

    stderr = '';
    expect(
      await runCli(['convert', bornDigitalPdfPath, '--format', 'xml'], {
        stderr: (s) => (stderr += s),
      }),
    ).toBe(1);
    expect(stderr).toContain('Invalid --format');
  });
});
