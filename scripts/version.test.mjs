import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bumpVersion,
  compareSemver,
  computeNextSemver,
  formatChangelogSection,
  parseChangelogRelease,
  parseCliArgs,
  parseSemver,
  renderWhatsNewBlock,
  syncReadmeWithChangelog,
  verifyVersioning,
  WHATS_NEW_END,
  WHATS_NEW_START,
} from './version.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Create a minimal synthetic workspace fixture (mirroring the OSS layout) so
 * bump, sync-readme, and git-tag freshness checks can be tested deterministically.
 *
 * @param {string} root
 * @param {string} [version]
 */
function createSyntheticWorkspace(root, version = '1.1.0') {
  mkdirSync(join(root, 'packages/core/src'), { recursive: true });
  mkdirSync(join(root, 'apps/selfhost/src'), { recursive: true });

  for (const rel of ['package.json', 'packages/core/package.json', 'apps/selfhost/package.json']) {
    writeFileSync(
      join(root, rel),
      `${JSON.stringify({ name: rel, version, license: 'Apache-2.0' }, null, 2)}\n`,
    );
  }

  writeFileSync(
    join(root, 'packages/core/src/index.ts'),
    `export const CORE_PACKAGE = '@datadosomething/core' as const;\nexport const CORE_VERSION = '${version}' as const;\n`,
  );

  const changelog = [
    '# Changelog',
    '',
    `- **Release & Workspace Version (\`${version}\`)**: Synchronized across workspaces.`,
    '',
    '---',
    '',
    `## [${version}] - 2026-10-22`,
    '',
    'Engine performance and developer experience upgrades.',
    '',
    '### Added',
    '',
    '- **Local PDF Reader (`@datadosomething/core`)**:',
    '  - Zero-key in-memory extraction for born-digital PDFs.',
    '- **CLI & Bearer Protection (`apps/selfhost`)**:',
    '  - Standalone CLI and optional token guard.',
    '',
  ].join('\n');
  writeFileSync(join(root, 'CHANGELOG.md'), changelog);

  const release = parseChangelogRelease(changelog);
  if (!release) throw new Error('Failed to parse synthetic changelog');

  const readme = [
    '# datadosomething — self-host',
    '',
    `**Version \`${version}\`** · **Document Model & JSON Schema \`v1.0\`**`,
    '',
    '## Versioning',
    '',
    '| Version scope | Current | Identifier / Location | Policy |',
    '| --- | --- | --- | --- |',
    `| **Release & Workspace Version** | \`${version}\` | \`package.json\` | Synchronized SemVer. |`,
    '',
    renderWhatsNewBlock(release, { changelogLink: 'CHANGELOG.md' }),
    '',
  ].join('\n');
  writeFileSync(join(root, 'README.md'), readme);
}

describe('SemVer parsing and progression', () => {
  it('parses valid MAJOR.MINOR.PATCH strings and rejects pre-release or malformed inputs', () => {
    expect(parseSemver('1.1.0')).toEqual({ major: 1, minor: 1, patch: 0 });
    expect(parseSemver('0.12.34')).toEqual({ major: 0, minor: 12, patch: 34 });
    expect(parseSemver('1.1')).toBeUndefined();
    expect(parseSemver('1.1.0-alpha.1')).toBeUndefined();
    expect(parseSemver('')).toBeUndefined();
  });

  it('compares SemVer versions accurately', () => {
    expect(compareSemver('1.1.0', '1.1.0')).toBe(0);
    expect(compareSemver('1.2.0', '1.1.9')).toBe(1);
    expect(compareSemver('2.0.0', '1.99.99')).toBe(1);
    expect(compareSemver('1.1.0', '1.1.1')).toBe(-1);
  });

  it('computes patch, minor, major, and explicit version bumps while rejecting downgrades', () => {
    expect(computeNextSemver('1.1.0', 'patch')).toBe('1.1.1');
    expect(computeNextSemver('1.1.0', 'minor')).toBe('1.2.0');
    expect(computeNextSemver('1.1.0', 'major')).toBe('2.0.0');
    expect(computeNextSemver('1.1.0', 'v1.4.2')).toBe('1.4.2');
    expect(() => computeNextSemver('1.1.0', '1.1.0')).toThrow(/strictly greater/);
    expect(() => computeNextSemver('1.1.0', '1.0.9')).toThrow(/strictly greater/);
  });
});

describe('live repository versioning gate', () => {
  it('passes verifyVersioning on the current repository checkout', () => {
    const result = verifyVersioning({ root: REPO_ROOT });
    expect(result.violations).toEqual([]);
    expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('validates matching --tag and rejects mismatched --tag', () => {
    const { version } = verifyVersioning({ root: REPO_ROOT });
    expect(verifyVersioning({ root: REPO_ROOT, expectedTag: `v${version}` }).violations).toEqual(
      [],
    );
    expect(
      verifyVersioning({ root: REPO_ROOT, expectedTag: `refs/tags/v${version}` }).violations,
    ).toEqual([]);
    expect(verifyVersioning({ root: REPO_ROOT, expectedTag: 'v99.99.99' }).violations).toEqual([
      `expected git tag "v${version}", but received "v99.99.99"`,
    ]);
  });
});

describe('bumpVersion, syncReadmeWithChangelog, and main-branch git tag freshness', () => {
  /** @type {string} */
  let sandbox;

  beforeAll(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'dds-version-test-'));
  });

  afterAll(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('bumps all manifests, CORE_VERSION, CHANGELOG.md, and README "What\'s new" in lockstep', () => {
    const ws = join(sandbox, 'bump-suite');
    createSyntheticWorkspace(ws, '1.1.0');
    expect(verifyVersioning({ root: ws }).violations).toEqual([]);

    const bumped = bumpVersion({
      root: ws,
      target: 'minor',
      date: '2026-11-03',
      summary: 'Code block preview parity and local reader wiring.',
      added: [
        '**Local PDF Reader Enabled by Default (`apps/selfhost`)**: Zero-key born-digital extraction.',
      ],
      fixed: ['**MarkdownPreview Fenced Code Blocks**: Preserves multi-line code fences.'],
    });

    expect(bumped.previousVersion).toBe('1.1.0');
    expect(bumped.nextVersion).toBe('1.2.0');
    expect(verifyVersioning({ root: ws }).violations).toEqual([]);

    const readme = readFileSync(join(ws, 'README.md'), 'utf8');
    expect(readme).toContain('**Version `1.2.0`**');
    expect(readme).toContain("### What's new in `v1.2.0` (2026-11-03)");
    expect(readme).toContain('Code block preview parity and local reader wiring.');
    expect(readme).toContain('**Local PDF Reader Enabled by Default (`apps/selfhost`)**');
    expect(readme).toContain('**MarkdownPreview Fenced Code Blocks**');
  });

  it('detects when README.md is out of sync with CHANGELOG.md and repairs it via syncReadmeWithChangelog', () => {
    const ws = join(sandbox, 'drift-suite');
    createSyntheticWorkspace(ws, '1.1.0');

    // Drift README's WHATS_NEW block
    const readmePath = join(ws, 'README.md');
    const originalReadme = readFileSync(readmePath, 'utf8');
    writeFileSync(
      readmePath,
      originalReadme.replace(
        new RegExp(`${WHATS_NEW_START}[\\s\\S]*?${WHATS_NEW_END}`),
        `${WHATS_NEW_START}\n### What's new in \`v1.0.0\` (2026-10-01)\n\nStale notes.\n${WHATS_NEW_END}`,
      ),
    );

    const checkDrifted = verifyVersioning({ root: ws });
    expect(checkDrifted.violations).toContainEqual(
      expect.stringMatching(/README\.md "What's new" block is out of sync/),
    );

    const synced = syncReadmeWithChangelog({ root: ws });
    expect(synced.version).toBe('1.1.0');
    expect(synced.updatedFiles).toEqual(['README.md']);
    expect(verifyVersioning({ root: ws }).violations).toEqual([]);
  });

  it('enforces main-branch git tag freshness: fails when a new commit reuses an already-tagged version', () => {
    const ws = join(sandbox, 'git-suite');
    createSyntheticWorkspace(ws, '1.1.0');

    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    };

    execFileSync('git', ['init', '-b', 'main'], { cwd: ws, env: gitEnv, stdio: 'ignore' });
    execFileSync('git', ['add', '-A'], { cwd: ws, env: gitEnv, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'Release v1.1.0'], {
      cwd: ws,
      env: gitEnv,
      stdio: 'ignore',
    });
    execFileSync('git', ['tag', '-a', 'v1.1.0', '-m', 'Release v1.1.0'], {
      cwd: ws,
      env: gitEnv,
      stdio: 'ignore',
    });

    // At the tagged commit itself, --check-git-tag passes.
    expect(verifyVersioning({ root: ws, checkGitMainTag: true }).violations).toEqual([]);

    // Now land a new commit on main WITHOUT bumping the version.
    writeFileSync(
      join(ws, 'apps/selfhost/src/feature.ts'),
      'export const feature = "new on main";\n',
    );
    execFileSync('git', ['add', '-A'], { cwd: ws, env: gitEnv, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'feat: add feature without bumping version'], {
      cwd: ws,
      env: gitEnv,
      stdio: 'ignore',
    });

    // --check-git-tag must fail because v1.1.0 points to the previous commit!
    const staleResult = verifyVersioning({ root: ws, checkGitMainTag: true });
    expect(staleResult.violations).toContainEqual(
      expect.stringMatching(/git tag "v1\.1\.0" already exists at commit/),
    );

    // Once the version is bumped to 1.2.0, --check-git-tag passes again!
    bumpVersion({
      root: ws,
      target: 'minor',
      date: '2026-11-03',
      summary: 'New feature release on main.',
      added: ['Added `feature` export in `apps/selfhost`.'],
    });
    expect(verifyVersioning({ root: ws, checkGitMainTag: true }).violations).toEqual([]);
  });
});

describe('formatChangelogSection & parseCliArgs', () => {
  it('formats a structured changelog entry with default fallback bullet when none is supplied', () => {
    const md = formatChangelogSection({ version: '1.2.1', date: '2026-11-03' });
    expect(md).toContain('## [1.2.1] - 2026-11-03');
    expect(md).toContain('### Changed');
    expect(md).toContain('Synchronized workspace release `v1.2.1`.');
  });

  it('parses CLI flags for check and bump commands', () => {
    const checkArgs = parseCliArgs(['check', '--check-git-tag', '--tag', 'v1.2.0']);
    expect(checkArgs.subcommand).toBe('check');
    expect(checkArgs.checkGitMainTag).toBe(true);
    expect(checkArgs.tag).toBe('v1.2.0');

    const bumpArgs = parseCliArgs([
      'bump',
      'minor',
      '--date',
      '2026-11-03',
      '--summary',
      'Summary text',
      '--added',
      'Added item 1',
      '--fixed',
      'Fixed item 1',
      '--tag',
    ]);
    expect(bumpArgs.subcommand).toBe('bump');
    expect(bumpArgs.positionals).toEqual(['minor']);
    expect(bumpArgs.date).toBe('2026-11-03');
    expect(bumpArgs.summary).toBe('Summary text');
    expect(bumpArgs.added).toEqual(['Added item 1']);
    expect(bumpArgs.fixed).toEqual(['Fixed item 1']);
    expect(bumpArgs.createGitTag).toBe(true);
  });
});
