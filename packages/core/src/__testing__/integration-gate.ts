import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The gate for the real-API integration tests.
 *
 * These tests hit live providers. They cost money, they need the network, and
 * they fail for reasons that have nothing to do with the code. So they are
 * skipped by default — but *how* they were skipped was a trap:
 *
 * Each of the three suites carried its own copy of a root-`.env` loader and then
 * gated on `!!process.env.MISTRAL_API_KEY`. Story 4.3 tells a self-hoster to
 * create a `.env` from `.env.example` and run `pnpm test`. Anyone who did that
 * with a placeholder value un-skipped the tests and got two `401`s that look
 * exactly like broken code. The suite the newcomer runs first is the one that
 * lied to them.
 *
 * The gate is now **explicit opt-in**: a key alone is not enough, you must also
 * say you meant it. A key you forgot you had cannot spend your money by accident.
 *
 *     RUN_INTEGRATION_TESTS=1 MISTRAL_API_KEY=sk-real corepack pnpm -r test
 *
 * Excluded from the emitted build (`src/__testing__` is not distributed): this is
 * suite scaffolding, not part of the Apache-2.0 surface.
 */

/** Values that count as "yes" for `RUN_INTEGRATION_TESTS`. */
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

let dotEnvLoaded = false;

/**
 * Load the git-ignored repo-root `.env` into `process.env`, once, without
 * overwriting anything already set — a value passed on the command line must win
 * over a stale one in a file.
 *
 * Vitest runs with `cwd` at the workspace root (`packages/core`, `apps/selfhost`),
 * so the repo root is two levels up. Resolved rather than hardcoded so a suite
 * running from a different workspace still finds it.
 */
function loadRootDotEnv(): void {
  if (dotEnvLoaded) return;
  dotEnvLoaded = true;
  try {
    const raw = readFileSync(path.join(process.cwd(), '..', '..', '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      const name = match?.[1];
      if (name && !(name in process.env)) {
        process.env[name] = (match?.[2] ?? '').replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // No `.env` present — the callers below will report "not opted in" and skip.
  }
}

/** Whether the operator explicitly asked for live-provider tests. */
export function integrationTestsEnabled(): boolean {
  loadRootDotEnv();
  return TRUTHY.has((process.env.RUN_INTEGRATION_TESTS ?? '').trim().toLowerCase());
}

/**
 * The key for a gated suite, or `undefined` when it must skip.
 *
 * Returns a value only when BOTH the opt-in is set and the key is present, so a
 * caller can write `it.skipIf(!key)` and be right for both reasons.
 */
export function integrationApiKey(variable: string): string | undefined {
  if (!integrationTestsEnabled()) return undefined;
  const key = process.env[variable]?.trim();
  return key === undefined || key === '' ? undefined : key;
}

/**
 * The suite-name suffix: why it will skip, or that it is really going to call a
 * paid API. Silence in both directions is what made a placeholder key look like
 * broken code — and a run that spends money should say so in its own output.
 */
export function integrationSkipReason(variable: string): string {
  if (!integrationTestsEnabled()) {
    return 'set RUN_INTEGRATION_TESTS=1 to run (live API, costs money)';
  }
  if (integrationApiKey(variable) === undefined) return `set ${variable} to run`;
  return 'LIVE — calling the real API';
}
