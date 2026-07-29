import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  classifyLicense,
  DISTRIBUTED_WORKSPACE_DIRS,
  PERMISSIVE_LICENSES,
  productionClosure,
  readDeclaredLicense,
  resolvePackageDir,
} from './license-check.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPTS_DIR, '..');

/**
 * AR-10 is a rule about what may enter the *distributed* tree, so the thing worth
 * testing is the classifier's posture: permissive passes, non-commercial fails,
 * and — the part that actually protects us — anything it cannot read fails too.
 */

describe('classifyLicense — permissive identifiers pass', () => {
  it.each([...PERMISSIVE_LICENSES])('accepts %s', (identifier) => {
    expect(classifyLicense(identifier).ok).toBe(true);
  });

  it('accepts the "or later" form', () => {
    expect(classifyLicense('MIT+').ok).toBe(true);
  });

  it('tolerates surrounding whitespace', () => {
    expect(classifyLicense('  MIT  ').ok).toBe(true);
  });
});

describe('classifyLicense — the case AR-10 names', () => {
  it.each(['CC-BY-NC-4.0', 'CC-BY-NC-SA-4.0', 'CC-BY-NC-ND-3.0'])('rejects %s', (identifier) => {
    const verdict = classifyLicense(identifier);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/non-commercial/);
  });

  it('rejects it even inside an OR expression, since neither operand is permissive', () => {
    expect(classifyLicense('(CC-BY-NC-4.0 OR SSPL-1.0)').ok).toBe(false);
  });

  it('rejects it inside an AND expression, where the permissive operand does not save it', () => {
    const verdict = classifyLicense('MIT AND CC-BY-NC-4.0');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/CC-BY-NC-4\.0/);
  });
});

describe('classifyLicense — other non-distributable licenses', () => {
  it.each([
    ['AGPL-3.0', /network copyleft/],
    ['GPL-3.0-only', /strong copyleft/],
    ['LGPL-2.1', /weak copyleft/],
    ['SSPL-1.0', /not an open-source license/],
    ['BUSL-1.1', /commercial-use restriction/],
    ['Elastic-2.0', /commercial-use restriction/],
    ['UNLICENSED', /not licensed for redistribution/],
  ])('rejects %s with an explanation', (identifier, reason) => {
    const verdict = classifyLicense(identifier);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(reason);
  });
});

describe('classifyLicense — deny by default', () => {
  it.each([undefined, null, '', '   '])('rejects a missing license (%s)', (declared) => {
    const verdict = classifyLicense(declared);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/no license declared/);
  });

  it('rejects an out-of-band license rather than assuming it is fine', () => {
    const verdict = classifyLicense('SEE LICENSE IN LICENSE.txt');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/out-of-band/);
  });

  it('rejects an identifier nobody has reviewed', () => {
    const verdict = classifyLicense('Weird-Bespoke-1.0');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/not on the reviewed permissive allowlist/);
  });
});

describe('classifyLicense — SPDX expressions', () => {
  it('passes an OR expression when any operand is permissive', () => {
    expect(classifyLicense('(MIT OR CC-BY-4.0)').ok).toBe(true);
    expect(classifyLicense('GPL-2.0 OR MIT').ok).toBe(true);
  });

  it('passes an AND expression only when every operand is permissive', () => {
    expect(classifyLicense('MIT AND Apache-2.0').ok).toBe(true);
    expect(classifyLicense('MIT AND GPL-3.0').ok).toBe(false);
  });

  it('treats a mixed expression conservatively — every operand must pass', () => {
    expect(classifyLicense('MIT OR Apache-2.0 AND GPL-3.0').ok).toBe(false);
  });
});

describe('the check as it actually runs', () => {
  // The classifier can be perfect while the script still fails to resolve pnpm,
  // read a manifest, or find any dependency at all — none of which a unit test
  // over pure functions would notice. This runs the real thing against the real
  // installed tree, which is the only way the AR-10 gate is worth anything.
  it('passes over this repository and clears the whole distributed closure', () => {
    const output = execFileSync(process.execPath, [join(SCRIPTS_DIR, 'license-check.mjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(output).toMatch(/ok {4}marked@[\d.]+ — MIT/);
    expect(output).toMatch(/ok {4}unpdf@[\d.]+ — MIT/);
    expect(output).toMatch(/license-check passed/);
  });
});

describe('productionClosure — over this repository', () => {
  const closure = productionClosure(
    REPO_ROOT,
    DISTRIBUTED_WORKSPACE_DIRS.map((relative) => join(REPO_ROOT, relative)),
  );

  it('resolves the whole tree', () => {
    expect(closure.unresolved).toEqual([]);
  });

  it('reaches the transitive runtime dependencies of the engine', () => {
    const names = [...closure.packages.keys()].map((id) => id.replace(/@[^@]*$/, ''));
    expect(names).toContain('marked');
    expect(names).toContain('unpdf');
  });

  it('includes the distributed workspaces themselves, so their own license is asserted', () => {
    const names = [...closure.packages.keys()].map((id) => id.replace(/@[^@]*$/, ''));
    expect(names).toContain('@datadosomething/core');
    expect(names).toContain('selfhost');
  });

  it('does not follow devDependencies — they are not distributed', () => {
    const names = [...closure.packages.keys()].map((id) => id.replace(/@[^@]*$/, ''));
    expect(names).not.toContain('vitest');
    expect(names).not.toContain('typescript');
  });

  it('never reaches the hosted app, whose dependencies AR-10 does not govern', () => {
    for (const dir of closure.packages.values()) expect(dir).not.toMatch(/apps\/hub/);
    const names = [...closure.packages.keys()].map((id) => id.replace(/@[^@]*$/, ''));
    expect(names).not.toContain('next');
    expect(names).not.toContain('react');
  });
});

describe('resolvePackageDir', () => {
  it('finds a dependency hoisted to the repository root', () => {
    const found = resolvePackageDir('typescript', join(REPO_ROOT, 'packages/core'), REPO_ROOT);
    expect(found).toBeDefined();
    expect(readFileSync(join(found, 'package.json'), 'utf8')).toMatch(/"name": "typescript"/);
  });

  it('returns undefined rather than throwing when nothing resolves', () => {
    expect(resolvePackageDir('not-a-real-package-xyz', SCRIPTS_DIR, REPO_ROOT)).toBeUndefined();
  });

  it('stops at the ceiling instead of escaping the repository', () => {
    // `vitest` is installed here; searching from a subdirectory with the ceiling
    // set to that same subdirectory must not find it further up.
    expect(resolvePackageDir('vitest', SCRIPTS_DIR, SCRIPTS_DIR)).toBeUndefined();
  });
});

describe('readDeclaredLicense', () => {
  it('reads the modern string form', () => {
    const dir = resolvePackageDir('typescript', REPO_ROOT, REPO_ROOT);
    expect(readDeclaredLicense(dir)).toBeTruthy();
  });

  it('reads the legacy `licenses: [{ type }]` array form', () => {
    const dir = mkdtempSync(join(tmpdir(), 'license-legacy-'));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'old', licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] }),
    );
    expect(readDeclaredLicense(dir)).toBe('MIT OR Apache-2.0');
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns undefined — which the classifier rejects — when nothing is declared', () => {
    const dir = mkdtempSync(join(tmpdir(), 'license-none-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'anonymous' }));
    expect(readDeclaredLicense(dir)).toBeUndefined();
    expect(classifyLicense(readDeclaredLicense(dir)).ok).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
