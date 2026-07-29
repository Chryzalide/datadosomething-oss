import { configReport } from './config';
import { createSelfhostServer } from './server';

/**
 * The runnable entrypoint (`pnpm --filter selfhost start`).
 *
 * Kept separate from `index.ts` so importing the module — from a test, or from a
 * consumer embedding the server — never starts a listener as a side effect.
 */

const DEFAULT_PORT = 8080;

/** `0` is a legitimate value (ephemeral port); anything unparseable falls back. */
function resolvePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_PORT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    console.warn(`PORT="${raw}" is not a valid port; falling back to ${DEFAULT_PORT}.`);
    return DEFAULT_PORT;
  }
  return parsed;
}

const port = resolvePort(process.env.PORT);
// 0.0.0.0 by default because a container's port mapping cannot reach a listener
// bound to loopback. Override with HOST=127.0.0.1 to keep it local.
const host = process.env.HOST ?? '0.0.0.0';

const server = createSelfhostServer();

/**
 * A listen failure is a configuration problem too, and it is the most common one
 * an operator hits. Left unhandled, `listen` emits an `error` event that Node
 * rethrows as a bare stack trace — precisely the opaque crash AC1 forbids. Say
 * what happened, name the variable, then exit non-zero so a supervisor notices.
 */
server.on('error', (cause: NodeJS.ErrnoException) => {
  if (cause.code === 'EADDRINUSE') {
    console.error(
      `Cannot start: ${host}:${port} is already in use. Set PORT to a free port, ` +
        'or stop whatever is holding this one.',
    );
  } else if (cause.code === 'EACCES') {
    console.error(
      `Cannot start: not permitted to bind ${host}:${port}. Ports below 1024 need ` +
        'elevated privileges — set PORT to something above 1024.',
    );
  } else {
    console.error(`Cannot start: failed to bind ${host}:${port} — ${cause.message}`);
  }
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`datadosomething selfhost listening on http://${host}:${port}`);

  // Report the configuration at startup (AC1: "or the app starts"), then keep
  // running regardless. Refusing to boot on a config problem would be a crash by
  // another name, and an operator mid-setup is better served by an instance that
  // is up and says what is missing.
  const report = configReport();
  for (const line of report) {
    if (line.startsWith('[config error]')) console.error(line);
    else console.warn(line);
  }
  if (report.length === 0) {
    console.log('Configuration looks complete: reader + OCR keys present.');
  }

  // This app has no auth, no quota and no rate limit — by design (AC1: the
  // operator owns the cost). The consequence is worth stating out loud rather
  // than leaving in a README: anyone who can reach this port can spend the
  // configured API keys. Warn whenever we are bound beyond loopback.
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    console.warn(
      'Note: no authentication and no quota are applied. Anyone who can reach ' +
        'this address can run conversions against your API keys. Keep it on a ' +
        'private network, or put your own auth in front of it.',
    );
  }
});

// Containers stop with SIGTERM; close the listener so in-flight requests finish.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
