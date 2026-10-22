import { selfhostNettoyageEnabled } from './nettoyage-config';

/**
 * Configuration legibility for the self-hosted envelope (FR-14, UX-DR10).
 *
 * Story 4.1 already returned a 503 naming the missing *provider*. This module
 * adds the two things UX-DR10 asks for and 4.1 lacked: the exact **environment
 * variable** and a **config-docs link**, plus a startup report so the operator
 * learns about a misconfiguration before the first conversion fails instead of
 * after.
 *
 * Two deliberate non-behaviours:
 *  - **Nothing here refuses to start.** AC1 says "never a crash", and an
 *    instance that boots and explains what is missing is strictly more useful to
 *    someone mid-setup than one that exits.
 *  - **Nothing here calls a provider to test a key.** Validating credentials at
 *    boot would spend money on every restart and turn a provider outage into a
 *    failed deploy. Validity is discovered on first use, where the typed
 *    `EngineAuthError` now makes it explicit.
 */

/** Where the config docs live. Relative by default because the OSS repo ships
 *  them alongside the code; `CONFIG_DOCS_URL` lets an operator point at their
 *  own runbook instead. */
const DEFAULT_CONFIG_DOCS = 'docs/selfhost-config.md';

export function configDocsUrl(env: Record<string, string | undefined> = process.env): string {
  const override = env.CONFIG_DOCS_URL?.trim();
  return override && override !== '' ? override : DEFAULT_CONFIG_DOCS;
}

/**
 * Append the config-docs pointer to a message, exactly once — messages travel
 * from `core` through the converter to the UI, and a link repeated twice reads
 * like a bug.
 */
export function withConfigDocs(
  message: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const suffix = `See ${configDocsUrl(env)} for the full configuration reference.`;
  // Match the whole appended sentence, not just the URL: a short override such as
  // CONFIG_DOCS_URL=/docs could otherwise appear incidentally in a message and
  // suppress the link altogether.
  if (message.endsWith(suffix)) return message;
  return `${message} ${suffix}`;
}

/**
 * `error`   — something cannot work at all.
 * `notice`  — it works, but not the way the operator may expect (cost, or a
 *             silently inactive feature). Not a warning about breakage.
 */
export type DiagnosticLevel = 'error' | 'notice';

export interface ConfigDiagnostic {
  level: DiagnosticLevel;
  /** The variable to set, when there is exactly one. */
  envVar?: string;
  message: string;
}

/**
 * Static configuration diagnostics. Pure: same env in, same list out, no I/O.
 *
 * Ordered most-severe first so a startup log reads top-down.
 */
export function configDiagnostics(
  env: Record<string, string | undefined> = process.env,
): ConfigDiagnostic[] {
  const mistral = env.MISTRAL_API_KEY?.trim();
  const jina = env.JINA_API_KEY?.trim();
  const nettoyageKey = env.NETTOYAGE_API_KEY?.trim() || mistral;
  const diagnostics: ConfigDiagnostic[] = [];

  if (!mistral && !jina) {
    diagnostics.push({
      level: 'error',
      envVar: 'MISTRAL_API_KEY',
      message:
        'No provider key is configured, so no document can be converted. Set MISTRAL_API_KEY (required for scans and images) and optionally JINA_API_KEY.',
    });
    // Everything below is implied by "nothing is configured"; saying it three
    // times would bury the one thing the operator has to do.
    return diagnostics;
  }

  if (!mistral) {
    diagnostics.push({
      level: 'error',
      envVar: 'MISTRAL_API_KEY',
      message:
        'MISTRAL_API_KEY is not set: scanned PDFs and images cannot be read, and Nettoyage cannot run. Born-digital PDFs will still convert via Jina.',
    });
  }

  if (!jina) {
    // AC2's cost consequence, stated plainly rather than left as a surprise on
    // the invoice: the router falls back to OCR, which is ~100x the cost per page.
    diagnostics.push({
      level: 'notice',
      envVar: 'JINA_API_KEY',
      message:
        'JINA_API_KEY is not set: born-digital PDFs will be converted with OCR instead of the much cheaper reader. Conversions still work — this only costs more.',
    });
  }

  if (selfhostNettoyageEnabled(env) && !nettoyageKey) {
    diagnostics.push({
      level: 'notice',
      envVar: 'MISTRAL_API_KEY',
      message:
        'Nettoyage is enabled but needs MISTRAL_API_KEY, so it will not run. Output will be served raw. Set NETTOYAGE_ENABLED=false to silence this.',
    });
  }

  return diagnostics;
}

/**
 * The startup report: one line per diagnostic, each carrying the docs link.
 * Returns the lines rather than printing them, so it is testable and the caller
 * decides where they go.
 */
export function configReport(env: Record<string, string | undefined> = process.env): string[] {
  return configDiagnostics(env).map(
    (diagnostic) =>
      `[${diagnostic.level === 'error' ? 'config error' : 'config notice'}] ${withConfigDocs(
        diagnostic.message,
        env,
      )}`,
  );
}
