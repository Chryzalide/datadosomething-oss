/**
 * dependency-cruiser — the CI-time gate enforcing AD-1 (Story 1.1).
 *
 * Every forbidden rule has severity 'error' so a violating import FAILS the build
 * (`pnpm boundaries`). Allowed edges: apps/hub → packages/core and
 * apps/selfhost → packages/core only. The vendor regex is intentionally broad and
 * gets tuned to real package names as providers land in later stories — the point
 * is that `core` may never import an app, a DB client, a payment/ads SDK, or a
 * vendor OCR/LLM SDK. `core` talks to vendors only through ports (AD-2).
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'core-no-apps',
      comment: 'packages/core is pure — it must never import any app (AD-1).',
      severity: 'error',
      from: { path: '^packages/core' },
      to: { path: '^apps/' },
    },
    {
      name: 'core-no-vendors',
      comment:
        'packages/core must never import a DB client, payment/ads SDK, or vendor OCR/LLM SDK (AD-1). It uses ports only (AD-2).',
      severity: 'error',
      from: { path: '^packages/core' },
      to: {
        // Substring-matched against the resolved module path (pnpm nests a
        // second `node_modules/<pkg>/` segment, so this catches the real dep).
        // Covers the payment / ads / LLM / OCR / DB families the project will
        // plausibly use; extend as concrete providers are added (AD-2 ports).
        path: 'node_modules/(stripe|@stripe|@paddle|paypal|braintree|@mistralai|mistral|jina|openai|@anthropic-ai|cohere-ai|@google-cloud|@aws-sdk|@azure|googleapis|ethicalads|@ethicalads|pg|postgres|mysql|mysql2|mariadb|mongodb|mongoose|redis|ioredis|better-sqlite3|sqlite3|prisma|@prisma|knex|typeorm|sequelize|drizzle-orm)',
      },
    },
    {
      name: 'hub-no-selfhost',
      comment: 'apps/hub must never depend on apps/selfhost (AD-1).',
      severity: 'error',
      from: { path: '^apps/hub' },
      to: { path: '^apps/selfhost' },
    },
    {
      name: 'selfhost-no-hub',
      comment: 'apps/selfhost must never depend on apps/hub (AD-1).',
      severity: 'error',
      from: { path: '^apps/selfhost' },
      to: { path: '^apps/hub' },
    },
    {
      name: 'no-parity-in-shipped-code',
      comment:
        'The Story 4.4 parity harness imports BOTH apps by design — that is what parity means, ' +
        'and it is why it lives outside them (AD-1 forbids the edge between the apps themselves). ' +
        'The harness is strictly one-directional: nothing that ships may import it, or the ' +
        '`hub -> selfhost` edge would exist again with `parity/` as the courier.',
      severity: 'error',
      from: { path: '^(packages|apps)/' },
      to: { path: '^parity/' },
    },
    {
      name: 'pg-only-in-the-quota-adapter',
      comment:
        'AD-5/AR-6: one Quota/Entitlement module owns ALL usage/entitlement state, and nothing ' +
        'else touches the store. `apps/hub/lib/quota/pg-client.ts` is the single adapter behind ' +
        'the SqlClient port (AD-2); every other file in the repository talks to the port. An ' +
        'import of `pg` anywhere else is a second write path to the one durable store (AD-7), ' +
        'which is exactly the divergence AD-5 exists to prevent. Note packages/core is already ' +
        'covered more broadly by `core-no-vendors`.',
      severity: 'error',
      from: { pathNot: '^apps/hub/lib/quota/pg-client\\.ts$' },
      to: { path: 'node_modules/pg/' },
    },
    {
      name: 'quota-module-has-one-door',
      comment:
        'The Quota/Entitlement module is reachable only through `apps/hub/lib/quota/index.ts` ' +
        '(Story 5.1, AC2). Importing `store.ts`, `migrate.ts` or the driver adapter directly ' +
        'would let a route, a middleware or a webhook handler own a piece of the state the ' +
        "module is supposed to be the single owner of. The module's own files and its " +
        'co-located tests are inside the door and unaffected.',
      severity: 'error',
      from: { path: '^apps/', pathNot: '^apps/hub/lib/quota/' },
      to: { path: '^apps/hub/lib/quota/', pathNot: '^apps/hub/lib/quota/index\\.ts$' },
    },
    {
      name: 'no-circular',
      comment: 'No circular dependencies.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Build output, not source. Without this, `pnpm boundaries` after a local
    // `pnpm build` dies with "Maximum call stack size exceeded" inside a
    // Turbopack chunk — and it reads as a boundary violation when it is nothing
    // of the sort, which cost two people an investigation each. CI never saw it
    // (it runs `boundaries` before `build`, and a fresh checkout has no `.next`),
    // so this is a developer-experience fix rather than a correctness one.
    // Recorded as deferred since the Story 3.1 review; closed here.
    exclude: { path: '(^|/)\\.next/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'types', 'default'],
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
    },
    // NOTE: do NOT add `includeOnly: '^(packages|apps)/'` — it discards
    // node_modules from the graph, which silently neutralizes `core-no-vendors`
    // (the forbidden edge points at node_modules/<vendor>). `doNotFollow` already
    // keeps the graph small by not traversing INTO node_modules, while preserving
    // the direct core→vendor edge so the rule can fire.
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/(?:@[^/]+/[^/]+|[^/]+)' },
    },
  },
};
