#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { EngineRegistry } from '@datadosomething/core';
import { convert, type OutputKind } from './convert';
import { composeEngines } from './engines';

export interface CliIo {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  env?: Record<string, string | undefined>;
  engines?: EngineRegistry;
}

const USAGE = `Usage:
  datadosomething convert <file> [options]

Options:
  --format, -f <md|json>   Output format (default: md)
  --output, -o <path>      Write output to file instead of stdout
  --pages, -p <range>      1-based page selection (e.g. 1-5 or 1,3-5)
  --nettoyage              Enable verified Nettoyage for this run
  --no-nettoyage           Disable verified Nettoyage for this run
  --help, -h               Show this help message
`;

function mimeForPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

export async function runCli(argv: readonly string[], io: CliIo = {}): Promise<number> {
  const out = io.stdout ?? ((text: string) => process.stdout.write(text));
  const err = io.stderr ?? ((text: string) => process.stderr.write(text));
  const env = io.env ?? process.env;

  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    out(USAGE);
    return 0;
  }

  const command = argv[0];
  if (command !== 'convert') {
    err(`Unknown command "${command ?? ''}".\n${USAGE}`);
    return 1;
  }

  let filePath: string | undefined;
  let kind: OutputKind = 'markdown';
  let outputPath: string | undefined;
  let pages: string | undefined;
  let nettoyage: string | undefined;

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--format' || arg === '-f') {
      const val = argv[++i]?.toLowerCase();
      if (val === 'md' || val === 'markdown') kind = 'markdown';
      else if (val === 'json') kind = 'json';
      else {
        err(`Invalid --format "${val ?? ''}". Expected "md" or "json".\n`);
        return 1;
      }
    } else if (arg === '--output' || arg === '-o') {
      outputPath = argv[++i];
      if (!outputPath) {
        err('Missing value for --output.\n');
        return 1;
      }
    } else if (arg === '--pages' || arg === '-p') {
      pages = argv[++i];
      if (!pages) {
        err('Missing value for --pages.\n');
        return 1;
      }
    } else if (arg === '--nettoyage') {
      nettoyage = 'true';
    } else if (arg === '--no-nettoyage') {
      nettoyage = 'false';
    } else if (arg.startsWith('-')) {
      err(`Unknown option "${arg}".\n${USAGE}`);
      return 1;
    } else if (!filePath) {
      filePath = arg;
    } else {
      err(`Unexpected argument "${arg}".\n${USAGE}`);
      return 1;
    }
  }

  if (!filePath) {
    err(`Missing input file.\n${USAGE}`);
    return 1;
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(resolve(filePath));
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    err(`Could not read file "${filePath}": ${detail}\n`);
    return 1;
  }

  const form = new FormData();
  const filename = basename(filePath);
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  form.append(
    'file',
    new File([view as Uint8Array<ArrayBuffer>], filename, {
      type: mimeForPath(filename),
    }),
  );
  if (pages) form.append('pages', pages);
  if (nettoyage) form.append('nettoyage', nettoyage);

  const engines = io.engines ?? composeEngines(env);
  const outcome = await convert(kind, form, { engines, env });
  if (outcome.status !== 200) {
    const message =
      typeof outcome.body.error === 'string' ? outcome.body.error : 'Conversion failed.';
    err(`Error (${outcome.status}): ${message}\n`);
    return 1;
  }

  const sortie = String(outcome.body[kind === 'markdown' ? 'markdown' : 'json'] ?? '');
  if (outputPath) {
    try {
      writeFileSync(resolve(outputPath), `${sortie}\n`, 'utf8');
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      err(`Could not write output file "${outputPath}": ${detail}\n`);
      return 1;
    }
  } else {
    out(`${sortie}\n`);
  }

  return 0;
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  void runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
