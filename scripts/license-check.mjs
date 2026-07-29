#!/usr/bin/env node
/**
 * AR-10 / AD-9 gate: **no non-commercial-licensed dependency may enter the
 * distributed core.**
 *
 * The rule has existed since Story 1.1 and was enforced by nobody — the kind of
 * rule that holds right up until someone adds ReaderLM (CC-BY-NC) because it is
 * the obvious tool for the job. This script walks the **production** dependency
 * closure of the two workspaces we distribute under Apache-2.0 (`packages/core`
 * and `apps/selfhost`), reads each installed package's declared license, and
 * exits non-zero on anything that is not on a reviewed permissive allowlist.
 *
 * Two deliberate design choices:
 *
 *  - **Deny by default.** An unrecognized identifier, a missing `license` field,
 *    or a `SEE LICENSE IN …` pointer all FAIL. The obligation is to prove the
 *    closure is clean, and "we could not tell" is not proof. A false alarm costs
 *    one line in the allowlist below, after a human reads the license; a false
 *    pass ships a licence violation to everyone who clones the public repo.
 *  - **Production only.** TypeScript, Vitest and ESLint are build-time tools
 *    that are not distributed and not linked into the artifact; their licenses
 *    are permissive anyway, but including them would mean reviewing a hundred
 *    packages that AR-10 does not speak about.
 *
 * No new dependency (AD-9), and no subprocess: the resolved `node_modules` tree
 * is the ground truth and Node can read it directly.
 *
 * Usage: `pnpm license-check` (also runs in CI, before any image is built).
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The workspaces distributed under Apache-2.0. Everything they pull in at
 *  runtime is what AR-10 is about. `apps/hub` is deliberately absent: it is not
 *  distributed, so its dependencies are not bound by this rule. */
export const DISTRIBUTED_WORKSPACES = ['@datadosomething/core', 'selfhost'];

/** Where those workspaces live, relative to the repository root. */
export const DISTRIBUTED_WORKSPACE_DIRS = ['packages/core', 'apps/selfhost'];

/**
 * Permissive identifiers, reviewed one by one. Every entry here is a license
 * that permits commercial use, redistribution and sublicensing under Apache-2.0
 * terms. Adding a line to this list is a licensing decision — it should be as
 * visible in a diff as adding a dependency.
 */
export const PERMISSIVE_LICENSES = new Set([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MIT-0',
  'MPL-2.0', // file-level copyleft only; distributing it alongside is fine
  'Python-2.0',
  'Unlicense',
  'WTFPL',
  'Zlib',
]);

/**
 * Named-and-shamed rejections, so the failure message can say *why* rather than
 * "not on the list". CC-BY-NC is the case AR-10 names explicitly; the others are
 * the licenses that would actually plausibly show up and be a problem.
 */
const EXPLAINED_REJECTIONS = [
  [/^CC-BY-NC/i, 'non-commercial: forbidden in the distributed core by AR-10'],
  [/^AGPL/i, 'network copyleft: incompatible with an Apache-2.0 distribution'],
  [/^SSPL/i, 'not an open-source license (server-side public license)'],
  [/^(BUSL|BSL)/i, 'source-available with a commercial-use restriction'],
  [/^Elastic/i, 'source-available with a commercial-use restriction'],
  [/^GPL/i, 'strong copyleft: incompatible with an Apache-2.0 distribution'],
  [/^LGPL/i, 'weak copyleft: needs a human decision before it may be distributed'],
  [/^UNLICENSED$/i, 'explicitly not licensed for redistribution'],
];

/**
 * Classify one declared license string.
 *
 * SPDX expressions are handled the way the licenses themselves work: `OR` is a
 * choice, so it passes if ANY operand is permissive (we take the permissive
 * one); `AND` is cumulative, so every operand must be permissive.
 *
 * @param {string | undefined | null} declared
 * @returns {{ ok: boolean, reason?: string }}
 */
export function classifyLicense(declared) {
  if (declared === undefined || declared === null || declared.trim() === '') {
    return { ok: false, reason: 'no license declared' };
  }

  const expression = declared.trim();

  if (/^SEE LICENSE IN\b/i.test(expression)) {
    return { ok: false, reason: 'license text is out-of-band; read it and decide by hand' };
  }

  // Strip the parentheses SPDX expressions are usually wrapped in, then split on
  // the operators. Nested/mixed expressions are rare enough that treating a
  // mixed one conservatively (all operands must pass) is the right trade.
  const bare = expression.replace(/[()]/g, ' ').trim();
  const hasOr = /\sOR\s/i.test(bare);
  const hasAnd = /\sAND\s/i.test(bare);

  if (hasOr || hasAnd) {
    const operands = bare
      .split(/\s+(?:OR|AND)\s+/i)
      .map((part) => part.trim())
      .filter((part) => part !== '');
    const results = operands.map((operand) => classifyLicense(operand));
    // A mixed expression falls through to the conservative AND branch.
    if (hasOr && !hasAnd) {
      if (results.some((result) => result.ok)) return { ok: true };
      return { ok: false, reason: `no permissive operand in "${expression}"` };
    }
    const rejected = operands.filter((_, index) => !results[index].ok);
    if (rejected.length === 0) return { ok: true };
    return { ok: false, reason: `"${rejected.join('", "')}" in "${expression}" is not permissive` };
  }

  // `MIT+`, `Apache-2.0+` etc. — the trailing `+` means "or later", same terms.
  const identifier = bare.replace(/\+$/, '');

  if (PERMISSIVE_LICENSES.has(identifier)) return { ok: true };

  for (const [pattern, reason] of EXPLAINED_REJECTIONS) {
    if (pattern.test(identifier)) return { ok: false, reason };
  }

  return { ok: false, reason: `"${expression}" is not on the reviewed permissive allowlist` };
}

/**
 * Find the directory Node would resolve `name` to from `fromDir`, by walking up
 * the `node_modules` chain the way the runtime does.
 *
 * This is why the check shells out to nothing. The first version ran
 * `pnpm list --prod --json`, which meant the gate only worked when `pnpm` was on
 * PATH — it failed the moment it was invoked as `node scripts/license-check.mjs`
 * under Corepack, where `pnpm` is a shim. A supply-chain gate that depends on how
 * it was launched is a gate that will be quietly skipped one day. Walking
 * `node_modules` also has the advantage of describing what actually ships: the
 * resolved tree, not a package manager's model of it.
 *
 * @param {string} name
 * @param {string} fromDir
 * @param {string} stopAt outermost directory to search
 * @returns {string | undefined}
 */
export function resolvePackageDir(name, fromDir, stopAt) {
  let current = resolve(fromDir);
  const ceiling = resolve(stopAt);
  for (;;) {
    const candidate = join(current, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (current === ceiling) return undefined;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Every package reachable at **runtime** from the given workspace directories.
 *
 * `dependencies` and `optionalDependencies` only: `devDependencies` are build
 * tools that are neither distributed nor linked into the artifact, and following
 * them would mean reviewing a hundred packages AR-10 does not speak about.
 * `peerDependencies` are the consumer's to satisfy.
 *
 * Directories are de-duplicated by real path, so the symlink farm pnpm builds
 * (and the workspace link from `apps/selfhost` to `packages/core`) is walked once
 * and cannot loop.
 *
 * @param {string} root repository root — the ceiling for resolution
 * @param {string[]} workspaceDirs absolute paths of the distributed workspaces
 * @returns {{ packages: Map<string, string>, unresolved: string[] }}
 */
export function productionClosure(root, workspaceDirs) {
  /** @type {Map<string, string>} */
  const packages = new Map();
  const unresolved = [];
  const visited = new Set();

  /** @param {string} dir @param {boolean} isEntryPoint */
  const walk = (dir, isEntryPoint) => {
    const real = realpathSync(dir);
    if (visited.has(real)) return;
    visited.add(real);

    const manifest = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8'));
    // The entry points are the workspaces themselves; they are the subject of the
    // check, not part of its closure, but their own manifests still declare
    // Apache-2.0 and are worth reporting.
    if (!isEntryPoint || DISTRIBUTED_WORKSPACES.includes(manifest.name)) {
      packages.set(`${manifest.name}@${manifest.version ?? 'unknown'}`, real);
    }

    const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies };
    const optional = new Set(Object.keys(manifest.optionalDependencies ?? {}));
    for (const name of Object.keys(dependencies)) {
      const resolved = resolvePackageDir(name, real, root);
      if (resolved === undefined) {
        // An unresolvable required dependency means the check cannot see the
        // whole tree, which is a failure — silence there is how something slips
        // through. An optional one that is genuinely absent ships nothing.
        if (!optional.has(name)) unresolved.push(`${name} (required by ${manifest.name})`);
        continue;
      }
      walk(resolved, false);
    }
  };

  for (const dir of workspaceDirs) walk(dir, true);
  return { packages, unresolved };
}

/** @param {string} packagePath */
export function readDeclaredLicense(packagePath) {
  const manifest = JSON.parse(readFileSync(join(packagePath, 'package.json'), 'utf8'));
  if (typeof manifest.license === 'string') return manifest.license;
  // The legacy `licenses: [{type}]` form, still present in older packages.
  if (Array.isArray(manifest.licenses)) {
    const types = manifest.licenses.map((entry) => entry?.type).filter(Boolean);
    if (types.length > 0) return types.join(' OR ');
  }
  if (typeof manifest.license?.type === 'string') return manifest.license.type;
  return undefined;
}

function main() {
  const workspaceDirs = DISTRIBUTED_WORKSPACE_DIRS.map((relative) => join(REPO_ROOT, relative));
  const { packages, unresolved } = productionClosure(REPO_ROOT, workspaceDirs);

  if (unresolved.length > 0) {
    console.error('license-check: could not resolve part of the tree — run `pnpm install` first:');
    for (const entry of unresolved) console.error(`  ${entry}`);
    process.exit(1);
  }

  if (packages.size === 0) {
    console.error(
      'license-check: resolved an EMPTY closure. That is a broken check, not a clean ' +
        'one — run `pnpm install` first.',
    );
    process.exit(1);
  }

  /** @type {{ id: string, license: string, reason: string }[]} */
  const violations = [];
  /** @type {{ id: string, license: string }[]} */
  const cleared = [];

  for (const [id, path] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    let declared;
    try {
      declared = readDeclaredLicense(path);
    } catch (cause) {
      violations.push({
        id,
        license: '<unreadable>',
        reason: `could not read its package.json (${cause instanceof Error ? cause.message : cause})`,
      });
      continue;
    }
    const verdict = classifyLicense(declared);
    if (verdict.ok) cleared.push({ id, license: declared ?? '' });
    else
      violations.push({ id, license: declared ?? '<none>', reason: verdict.reason ?? 'rejected' });
  }

  console.log(
    `license-check: ${packages.size} package(s) in the distributed runtime closure ` +
      `(${DISTRIBUTED_WORKSPACES.join(' + ')}).`,
  );
  for (const { id, license } of cleared) console.log(`  ok    ${id} — ${license}`);

  if (violations.length > 0) {
    console.error(`\nlicense-check FAILED — ${violations.length} package(s) not distributable:`);
    for (const { id, license, reason } of violations) {
      console.error(`  FAIL  ${id} — ${license}: ${reason}`);
    }
    console.error(
      '\nAR-10: no non-commercial-licensed dependency may enter the distributed core.\n' +
        'Either drop the dependency, or — if the license really is permissive — read it\n' +
        'and add its SPDX identifier to PERMISSIVE_LICENSES in scripts/license-check.mjs.',
    );
    process.exit(1);
  }

  console.log('\nlicense-check passed: every distributed dependency is permissively licensed.');
}

// Only run when executed directly, so the tests can import the pure helpers.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
