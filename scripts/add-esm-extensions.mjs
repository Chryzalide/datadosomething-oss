/**
 * Post-build step: add explicit `.js` extensions to the relative import
 * specifiers in the given directory's emitted `.js` files.
 *
 *   node scripts/add-esm-extensions.mjs packages/core/dist
 *
 * Shared by `packages/core` and `apps/selfhost` — both emit under the same
 * `moduleResolution: "Bundler"` settings and both need to be loadable by Node.
 * (Story 4.3's public-repo split must therefore include this `scripts/` dir.)
 *
 * WHY THIS EXISTS
 * ---------------
 * `tsconfig.base.json` uses `moduleResolution: "Bundler"`, so the SOURCE writes
 * extensionless relative imports (`./document-model`) and `tsc` emits them
 * verbatim. Node's ESM loader requires a real file path, so the emitted
 * `dist/index.js` was not loadable by `node` at all — `import('@datadosomething/core')`
 * failed with ERR_MODULE_NOT_FOUND. `apps/hub` never noticed because Turbopack
 * resolves `@datadosomething/core` to `packages/core/src` (a tsconfig `paths`
 * mapping) and bundles it.
 *
 * That made the "OSS distributable core" (AD-9) impossible to run from a plain
 * Node process — which Story 4.1 is the first consumer to need, and Story 4.3's
 * Docker image will need harder.
 *
 * WHY NOT FIX THE SOURCE
 * ----------------------
 * Adding `.js` to the source specifiers works for `tsc`, `vitest` and Node, but
 * Turbopack does NOT map `./x.js` onto `./x.ts`, so the hub build breaks (tried
 * and verified). Rewriting the emit keeps both consumers correct without a
 * bundler dependency: the hub stays on source, the package stays Node-loadable.
 *
 * The standards-correct end state is `moduleResolution: "NodeNext"` with `.js`
 * specifiers in source plus a Turbopack `extensionAlias`; that is a
 * repo-wide migration, logged in `deferred-work.md`.
 *
 * Idempotent, dependency-free, and it only touches relative specifiers that have
 * no extension yet.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error('usage: node scripts/add-esm-extensions.mjs <dist-dir>');
  process.exit(1);
}
const distDir = path.resolve(target);

/** `from './x'`, `from "../y"`, and dynamic `import('./z')`. */
const SPECIFIER = /(from\s*|import\s*\(\s*)(['"])(\.\.?\/[^'"]*)(\2)/g;

async function jsFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await jsFiles(full)));
    else if (entry.name.endsWith('.js')) found.push(full);
  }
  return found;
}

let rewritten = 0;
let touched = 0;

for (const file of await jsFiles(distDir)) {
  const before = await readFile(file, 'utf8');
  const after = before.replace(SPECIFIER, (match, pre, quote, specifier) => {
    if (path.extname(specifier) !== '') return match; // already explicit
    rewritten += 1;
    return `${pre}${quote}${specifier}.js${quote}`;
  });
  if (after !== before) {
    await writeFile(file, after);
    touched += 1;
  }
}

console.log(`add-esm-extensions: ${rewritten} specifier(s) in ${touched} file(s) under ${target}`);
