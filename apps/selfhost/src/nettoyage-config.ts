/**
 * Nettoyage policy for the self-hosted envelope (FR-18 self-host, Story 3.3).
 *
 * **Self-host enables Nettoyage by default.** The user runs the instance with
 * their own keys and pays their own LLM calls, so there is nothing to gate — the
 * value-add is simply on, and `NETTOYAGE_ENABLED=false` is the documented opt-out.
 * This is the mirror image of the hosted hub, which reads the same flag with an
 * off default because its free tier is raw (see `apps/hub/lib/nettoyage.ts`).
 *
 * The full self-host API/UI is Story 4.1; this module ships the *policy* AC2
 * requires, tested, so 4.1 only has to call it.
 *
 * AD-1: no import of `apps/hub` (this file ships in the public OSS repo, which
 * does not contain the hub) and no vendor SDK.
 */

/** The self-hosted envelope's default: on (FR-18 self-host). */
const SELFHOST_DEFAULT_ENABLED = true;

/**
 * Parse an on/off env flag, falling back to `fallback` for absent, empty or
 * unrecognized values.
 *
 * Deliberately duplicated from `apps/hub/lib/nettoyage.ts` rather than shared:
 * the two envelopes are distributed separately and AD-1 forbids an edge between
 * them, so a shared package for six lines would cost more than it saves. Both
 * copies are covered by the same table of spellings in their respective tests.
 */
export function parseEnabledFlag(raw: string | undefined, fallback: boolean): boolean {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value === '') return fallback;
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off'].includes(value)) return false;
  return fallback;
}

/** Whether a self-hosted instance should run Nettoyage. Defaults to `true`. */
export function selfhostNettoyageEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return parseEnabledFlag(env.NETTOYAGE_ENABLED, SELFHOST_DEFAULT_ENABLED);
}
