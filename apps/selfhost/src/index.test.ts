import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { coreVersion } from '@datadosomething/core';
import { describeSelfhost } from './index';

describe('selfhost identity and versioning', () => {
  it('wraps the pure core in-process at the matching SemVer release', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(describeSelfhost()).toBe('selfhost over @datadosomething/core@1.1.0');
    expect(manifest.version).toBe(coreVersion());
  });
});
