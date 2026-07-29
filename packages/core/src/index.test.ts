import { describe, expect, it } from 'vitest';
import { CORE_PACKAGE, coreVersion } from './index';

describe('@datadosomething/core placeholder', () => {
  it('exposes a stable package identity', () => {
    expect(CORE_PACKAGE).toBe('@datadosomething/core');
  });

  it('reports a version', () => {
    expect(coreVersion()).toBe('0.0.0');
  });
});
