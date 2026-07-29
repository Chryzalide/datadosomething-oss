import { describe, expect, it } from 'vitest';
import { describeSelfhost } from './index';

describe('selfhost placeholder', () => {
  it('wraps the pure core in-process', () => {
    expect(describeSelfhost()).toBe('selfhost over @datadosomething/core@0.0.0');
  });
});
