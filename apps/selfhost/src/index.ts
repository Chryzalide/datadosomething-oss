import { CORE_PACKAGE, coreVersion } from '@datadosomething/core';

/**
 * apps/selfhost — the OSS thin app over the pure engine (Apache-2.0).
 *
 * AD-1: depends on `@datadosomething/core` in-process ONLY, and never on
 * `apps/hub` or any quota/ads/Stripe/vendor code. Story 4.1 turned the Story 1.1
 * placeholder into a real thin API + minimal UI; Docker packaging and the public
 * repo split are Story 4.3.
 *
 * The runnable entrypoint is `main.ts` — importing this module starts nothing.
 */
export function describeSelfhost(): string {
  return `selfhost over ${CORE_PACKAGE}@${coreVersion()}`;
}

export { createSelfhostServer, type SelfhostServerOptions } from './server';
export {
  convert,
  type ConversionOutcome,
  type ConvertOptions,
  type OutputKind,
  parsePageSelection,
} from './convert';
export { type CliIo, runCli } from './cli';
export { composeEngines } from './engines';
export {
  type ConfigDiagnostic,
  configDiagnostics,
  configDocsUrl,
  configReport,
  type DiagnosticLevel,
  withConfigDocs,
} from './config';
export {
  applyNettoyage,
  composeNettoyage,
  type NettoyageComposition,
  type NettoyageReport,
} from './nettoyage';
export { parseEnabledFlag, selfhostNettoyageEnabled } from './nettoyage-config';
export {
  DEFAULT_MAX_UPLOAD_BYTES,
  maxUploadBytes,
  UPLOAD_ACCEPT_ATTR,
  validateUpload,
  type UploadVerdict,
} from './upload';
export { renderPage } from './ui';
