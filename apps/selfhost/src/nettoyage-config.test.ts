import { describe, expect, it } from 'vitest';
import { parseEnabledFlag, selfhostNettoyageEnabled } from './nettoyage-config';

describe('selfhostNettoyageEnabled (Story 3.3 AC2)', () => {
  it('is ON by default — the self-host promise of FR-18', () => {
    // The single most important assertion in this file: a self-hoster who
    // configures nothing still gets the value-add.
    expect(selfhostNettoyageEnabled({})).toBe(true);
    expect(selfhostNettoyageEnabled({ NETTOYAGE_ENABLED: undefined })).toBe(true);
    expect(selfhostNettoyageEnabled({ NETTOYAGE_ENABLED: '' })).toBe(true);
  });

  it('honours the documented opt-out', () => {
    expect(selfhostNettoyageEnabled({ NETTOYAGE_ENABLED: 'false' })).toBe(false);
    expect(selfhostNettoyageEnabled({ NETTOYAGE_ENABLED: '0' })).toBe(false);
    expect(selfhostNettoyageEnabled({ NETTOYAGE_ENABLED: 'no' })).toBe(false);
    expect(selfhostNettoyageEnabled({ NETTOYAGE_ENABLED: 'off' })).toBe(false);
  });

  it('falls back to ON for an unrecognized value rather than guessing', () => {
    expect(selfhostNettoyageEnabled({ NETTOYAGE_ENABLED: 'maybe' })).toBe(true);
  });
});

/**
 * The same spellings table the hub asserts against its own copy of this parser
 * (`apps/hub/tests/nettoyage-config.test.ts`). The duplication is deliberate —
 * selfhost ships without the hub — so these two tables are what keep the two
 * envelopes behaving identically.
 */
describe('parseEnabledFlag — shared spellings', () => {
  it('accepts every truthy spelling, case- and whitespace-insensitively', () => {
    for (const raw of ['true', 'TRUE', ' True ', '1', 'yes', 'YES', 'on', 'ON']) {
      expect(parseEnabledFlag(raw, false)).toBe(true);
    }
  });

  it('accepts every falsy spelling, case- and whitespace-insensitively', () => {
    for (const raw of ['false', 'FALSE', ' False ', '0', 'no', 'NO', 'off', 'OFF']) {
      expect(parseEnabledFlag(raw, true)).toBe(false);
    }
  });

  it('returns the fallback for absent, empty or unrecognized values', () => {
    for (const raw of [undefined, '', '   ', 'maybe', 'enabled', '2', 'null']) {
      expect(parseEnabledFlag(raw, true)).toBe(true);
      expect(parseEnabledFlag(raw, false)).toBe(false);
    }
  });
});
