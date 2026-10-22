import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CORE_PACKAGE, CORE_VERSION, coreVersion } from './index';

describe('@datadosomething/core identity and versioning', () => {
  it('exposes a stable package identity', () => {
    expect(CORE_PACKAGE).toBe('@datadosomething/core');
  });

  it('reports a real SemVer version in lockstep with packages/core/package.json', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(coreVersion()).toBe('1.1.0');
    expect(CORE_VERSION).toBe('1.1.0');
    expect(coreVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(coreVersion()).not.toBe('0.0.0');
    expect(manifest.version).toBe(coreVersion());
  });
});
