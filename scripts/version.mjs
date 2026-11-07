#!/usr/bin/env node
/**
 * Release & OSS Versioning Gate (`scripts/version.mjs`).
 *
 * Enforces three invariants across both the upstream monorepo and the generated
 * Apache-2.0 repository (`datadosomething-oss`):
 *
 *  1. **Workspace & Engine Lockstep**: Every `package.json` (`root`,
 *     `packages/core`, `apps/selfhost`, and `apps/hub` when present) and
 *     `CORE_VERSION` in `packages/core/src/index.ts` declare the exact same
 *     SemVer (`MAJOR.MINOR.PATCH`, never `0.0.0`).
 *  2. **Changelog & README "What's new" Synchronization**: The top release entry
 *     in `CHANGELOG.md` (`## [X.Y.Z] - YYYY-MM-DD`) matches the workspace
 *     version, and `README.md` (both `scripts/oss/repo-README.md` and root
 *     `README.md`) reflects the current version badge, the Versioning table row,
 *     and a deterministic `<!-- WHATS_NEW_START -->…<!-- WHATS_NEW_END -->`
 *     section summarizing the release highlights from `CHANGELOG.md`.
 *  3. **Main-Branch Tag Freshness (`--check-git-tag`)**: Every update landing on
 *     `main` must carry a new version tag `vX.Y.Z`. If tag `vX.Y.Z` already
 *     exists in Git and points to an earlier commit (`tagCommit !== HEAD`), the
 *     gate fails and instructs the maintainer to run `pnpm version:bump`.
 *
 * Zero external dependencies (AD-9). Shipped in the OSS allowlist so the public
 * repository runs the exact same gate in its own CI.
 *
 * Usage:
 *   node scripts/version.mjs check [--tag vX.Y.Z] [--check-git-tag]
 *   node scripts/version.mjs sync-readme
 *   node scripts/version.mjs bump <patch|minor|major|X.Y.Z> [--date YYYY-MM-DD]
 *     [--summary "..."] [--added "..."] [--changed "..."] [--fixed "..."] [--tag]
 *   node scripts/version.mjs current
 *   node scripts/version.mjs release-notes [--version X.Y.Z]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const WHATS_NEW_START = '<!-- WHATS_NEW_START -->';
export const WHATS_NEW_END = '<!-- WHATS_NEW_END -->';

/**
 * Parse a strict `MAJOR.MINOR.PATCH` SemVer string.
 *
 * @param {string | undefined | null} version
 * @returns {{ major: number, minor: number, patch: number } | undefined}
 */
export function parseSemver(version) {
  if (typeof version !== 'string') return undefined;
  const match = SEMVER_RE.exec(version.trim());
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * Compare two SemVer strings (`-1` if `a < b`, `0` if equal, `1` if `a > b`).
 *
 * @param {string} a
 * @param {string} b
 * @returns {-1 | 0 | 1}
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) {
    throw new Error(`Invalid SemVer comparison: "${a}" vs "${b}".`);
  }
  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;
  return 0;
}

/**
 * Compute the next SemVer from a bump keyword (`patch`, `minor`, `major`) or an
 * explicit `MAJOR.MINOR.PATCH` target.
 *
 * @param {string} current
 * @param {string} target
 * @param {{ allowSame?: boolean }} [options]
 * @returns {string}
 */
export function computeNextSemver(current, target, options = {}) {
  const parsedCurrent = parseSemver(current);
  if (!parsedCurrent) {
    throw new Error(`Current version "${current}" is not a valid MAJOR.MINOR.PATCH SemVer.`);
  }
  const cleanTarget = target.trim().replace(/^v/, '');
  let next;
  if (cleanTarget === 'patch') {
    next = `${parsedCurrent.major}.${parsedCurrent.minor}.${parsedCurrent.patch + 1}`;
  } else if (cleanTarget === 'minor') {
    next = `${parsedCurrent.major}.${parsedCurrent.minor + 1}.0`;
  } else if (cleanTarget === 'major') {
    next = `${parsedCurrent.major + 1}.0.0`;
  } else if (parseSemver(cleanTarget)) {
    next = cleanTarget;
  } else {
    throw new Error(
      `Invalid bump target "${target}". Expected "patch", "minor", "major", or an explicit "X.Y.Z".`,
    );
  }

  const cmp = compareSemver(next, current);
  if (cmp < 0 || (cmp === 0 && !options.allowSame)) {
    throw new Error(
      `Target version "${next}" must be strictly greater than current version "${current}".`,
    );
  }
  return next;
}

/**
 * Resolve the versioned file paths for either the upstream monorepo or the
 * split public OSS repository.
 *
 * @param {string} [root]
 */
export function resolveVersionTargets(root = REPO_ROOT) {
  const manifests = ['package.json', 'packages/core/package.json', 'apps/selfhost/package.json'];
  if (existsSync(join(root, 'apps/hub/package.json'))) {
    manifests.push('apps/hub/package.json');
  }

  const isMonorepo = existsSync(join(root, 'scripts/oss/CHANGELOG.md'));
  const changelog = isMonorepo ? 'scripts/oss/CHANGELOG.md' : 'CHANGELOG.md';

  /** @type {{ path: string, changelogLink: string, requireBadgeAndTable: boolean }[]} */
  const readmes = [];
  if (isMonorepo) {
    if (existsSync(join(root, 'scripts/oss/repo-README.md'))) {
      readmes.push({
        path: 'scripts/oss/repo-README.md',
        changelogLink: 'CHANGELOG.md',
        requireBadgeAndTable: true,
      });
    }
    if (existsSync(join(root, 'README.md'))) {
      readmes.push({
        path: 'README.md',
        changelogLink: 'scripts/oss/CHANGELOG.md',
        requireBadgeAndTable: true,
      });
    }
  } else if (existsSync(join(root, 'README.md'))) {
    readmes.push({
      path: 'README.md',
      changelogLink: 'CHANGELOG.md',
      requireBadgeAndTable: true,
    });
  }

  return {
    manifests,
    coreIndex: 'packages/core/src/index.ts',
    changelog,
    readmes,
  };
}

/**
 * Parse a specific release section (or the latest top release section when
 * `targetVersion` is omitted) from `CHANGELOG.md`.
 *
 * @param {string} changelogText
 * @param {string} [targetVersion]
 * @returns {{
 *   version: string,
 *   date: string,
 *   summary: string,
 *   highlights: string[],
 *   rawBody: string
 * } | undefined}
 */
export function parseChangelogRelease(changelogText, targetVersion) {
  const headingMatches = [
    ...changelogText.matchAll(/^## \[(\d+\.\d+\.\d+)\]\s*-\s*(\d{4}-\d{2}-\d{2})\s*$/gm),
  ];
  if (headingMatches.length === 0) return undefined;

  const index =
    targetVersion === undefined
      ? 0
      : headingMatches.findIndex((m) => m[1] === targetVersion.replace(/^v/, ''));
  if (index === -1) return undefined;

  const match = headingMatches[index];
  const version = match[1];
  const date = match[2];
  const bodyStart = (match.index ?? 0) + match[0].length;
  const bodyEnd =
    index + 1 < headingMatches.length
      ? (headingMatches[index + 1].index ?? changelogText.length)
      : changelogText.length;

  const rawSection = changelogText
    .slice(bodyStart, bodyEnd)
    .replace(/\n---\s*$/, '')
    .trim();

  const lines = rawSection.split('\n');
  /** @type {string[]} */
  const summaryLines = [];
  /** @type {{ text: string, subItems: string[] }[]} */
  const bulletGroups = [];
  let inSubheading = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (/^###\s+/.test(line)) {
      inSubheading = true;
      continue;
    }
    if (!inSubheading) {
      if (line.trim() !== '') summaryLines.push(line.trim());
      continue;
    }

    const topBullet = /^-\s+(.+)$/.exec(line);
    if (topBullet) {
      bulletGroups.push({ text: topBullet[1].trim(), subItems: [] });
      continue;
    }

    const subBullet = /^\s{2,}-\s+(.+)$/.exec(line);
    if (subBullet && bulletGroups.length > 0) {
      bulletGroups[bulletGroups.length - 1].subItems.push(subBullet[1].trim());
    }
  }

  const highlights = bulletGroups.map((group) => {
    if (group.subItems.length > 0) {
      const head = group.text.replace(/:\s*$/, '');
      return `${head} — ${group.subItems[0]}`;
    }
    return group.text;
  });

  return {
    version,
    date,
    summary: summaryLines.join(' '),
    highlights,
    rawBody: rawSection,
  };
}

/**
 * Render the deterministic `<!-- WHATS_NEW_START -->…<!-- WHATS_NEW_END -->`
 * Markdown section for `README.md`.
 *
 * @param {{ version: string, date: string, summary: string, highlights: string[] }} release
 * @param {{ changelogLink?: string }} [options]
 * @returns {string}
 */
export function renderWhatsNewBlock(release, options = {}) {
  const changelogLink = options.changelogLink ?? 'CHANGELOG.md';
  const lines = [
    WHATS_NEW_START,
    `### What's new in \`v${release.version}\` (${release.date})`,
    '',
  ];
  if (release.summary) {
    lines.push(release.summary, '');
  }
  for (const item of release.highlights) {
    lines.push(`- ${item}`);
  }
  if (release.highlights.length > 0) {
    lines.push('');
  }
  lines.push(
    `Full release notes and version history: **[${changelogLink}](${changelogLink})**.`,
    WHATS_NEW_END,
  );
  return lines.join('\n');
}

/**
 * Normalize whitespace inside a Markdown fragment so comparisons are resilient
 * to line-ending or prose-wrapping differences while remaining strict on text.
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeMarkdownFragment(text) {
  return text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
}

/**
 * Synchronize version badges, the Versioning table row, and the `WHATS_NEW`
 * block in a single README string.
 *
 * @param {string} readmeText
 * @param {{ version: string, date: string, summary: string, highlights: string[] }} release
 * @param {{ changelogLink?: string }} [options]
 * @returns {string}
 */
export function updateReadmeContent(readmeText, release, options = {}) {
  const changelogLink = options.changelogLink ?? 'CHANGELOG.md';
  let updated = readmeText.replace(
    /\*\*Version `\d+\.\d+\.\d+`\*\*/g,
    `**Version \`${release.version}\`**`,
  );
  updated = updated.replace(
    /(\|\s*\*\*Release & Workspace Version\*\*\s*\|\s*)`\d+\.\d+\.\d+`/g,
    `$1\`${release.version}\``,
  );

  const block = renderWhatsNewBlock(release, { changelogLink });
  const blockRe = new RegExp(`${WHATS_NEW_START}[\\s\\S]*?${WHATS_NEW_END}`);
  if (blockRe.test(updated)) {
    updated = updated.replace(blockRe, block);
  }
  return updated;
}

/**
 * Synchronize all README files in `root` with the latest entry in `CHANGELOG.md`.
 *
 * @param {{ root?: string }} [options]
 * @returns {{ version: string, updatedFiles: string[] }}
 */
export function syncReadmeWithChangelog(options = {}) {
  const root = resolve(options.root ?? REPO_ROOT);
  const targets = resolveVersionTargets(root);
  const changelogPath = join(root, targets.changelog);
  if (!existsSync(changelogPath)) {
    throw new Error(`Cannot sync README: ${targets.changelog} does not exist.`);
  }
  const changelogText = readFileSync(changelogPath, 'utf8');
  const latest = parseChangelogRelease(changelogText);
  if (!latest) {
    throw new Error(
      `Cannot sync README: no "## [X.Y.Z] - YYYY-MM-DD" section in ${targets.changelog}.`,
    );
  }

  /** @type {string[]} */
  const updatedFiles = [];
  for (const readme of targets.readmes) {
    const fullPath = join(root, readme.path);
    if (!existsSync(fullPath)) continue;
    const before = readFileSync(fullPath, 'utf8');
    const after = updateReadmeContent(before, latest, { changelogLink: readme.changelogLink });
    if (after !== before) {
      writeFileSync(fullPath, after);
      updatedFiles.push(readme.path);
    }
  }

  return { version: latest.version, updatedFiles };
}

/**
 * Inspect the Git tag state for `v${version}` in `root`.
 *
 * @param {string} root
 * @param {string} version
 * @returns {{ isGitRepo: boolean, headCommit?: string, tagExists: boolean, tagCommit?: string }}
 */
export function inspectGitTagState(root, version) {
  let headCommit;
  try {
    headCommit = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return { isGitRepo: false, tagExists: false };
  }

  try {
    const tagCommit = execFileSync(
      'git',
      ['rev-parse', '-q', '--verify', `refs/tags/v${version}^{commit}`],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
    return { isGitRepo: true, headCommit, tagExists: true, tagCommit };
  } catch {
    return { isGitRepo: true, headCommit, tagExists: false };
  }
}

/**
 * Verify all versioning, changelog, README "What's new", and optional Git tag
 * invariants for `root`.
 *
 * @param {{
 *   root?: string,
 *   expectedTag?: string,
 *   checkGitMainTag?: boolean
 * }} [options]
 * @returns {{ version: string, violations: string[] }}
 */
export function verifyVersioning(options = {}) {
  const root = resolve(options.root ?? REPO_ROOT);
  const targets = resolveVersionTargets(root);
  /** @type {string[]} */
  const violations = [];

  const rootManifestPath = join(root, 'package.json');
  if (!existsSync(rootManifestPath)) {
    return { version: 'unknown', violations: ['missing root package.json'] };
  }

  const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'));
  const version = String(rootManifest.version ?? '');

  if (!parseSemver(version) || version === '0.0.0') {
    violations.push(
      `package.json carries invalid release version "${version}" (expected MAJOR.MINOR.PATCH != 0.0.0)`,
    );
  }

  for (const relManifest of targets.manifests) {
    const full = join(root, relManifest);
    if (!existsSync(full)) {
      violations.push(`missing manifest: ${relManifest}`);
      continue;
    }
    const pkg = JSON.parse(readFileSync(full, 'utf8'));
    if (pkg.version !== version) {
      violations.push(
        `version mismatch in ${relManifest}: found "${pkg.version}", expected "${version}"`,
      );
    }
  }

  const coreIndexPath = join(root, targets.coreIndex);
  if (!existsSync(coreIndexPath)) {
    violations.push(`missing core entrypoint: ${targets.coreIndex}`);
  } else {
    const coreIndexText = readFileSync(coreIndexPath, 'utf8');
    const coreConstMatch = /export const CORE_VERSION = '([^']+)'/.exec(coreIndexText);
    if (!coreConstMatch) {
      violations.push(`${targets.coreIndex} is missing "export const CORE_VERSION = '...'"`);
    } else if (coreConstMatch[1] !== version) {
      violations.push(
        `CORE_VERSION mismatch in ${targets.coreIndex}: found "${coreConstMatch[1]}", expected "${version}"`,
      );
    }
  }

  const changelogPath = join(root, targets.changelog);
  /** @type {ReturnType<typeof parseChangelogRelease>} */
  let latestRelease;
  if (!existsSync(changelogPath)) {
    violations.push(`missing changelog: ${targets.changelog}`);
  } else {
    const changelogText = readFileSync(changelogPath, 'utf8');
    const headerVersionMatch = /Release & Workspace Version \(`([^`]+)`\)/.exec(changelogText);
    if (!headerVersionMatch) {
      violations.push(
        `${targets.changelog} is missing the "Release & Workspace Version (\`${version}\`)" header`,
      );
    } else if (headerVersionMatch[1] !== version) {
      violations.push(
        `${targets.changelog} header version is "${headerVersionMatch[1]}", expected "${version}"`,
      );
    }

    latestRelease = parseChangelogRelease(changelogText);
    if (!latestRelease) {
      violations.push(`${targets.changelog} contains no "## [X.Y.Z] - YYYY-MM-DD" release entry`);
    } else {
      if (latestRelease.version !== version) {
        violations.push(
          `top release in ${targets.changelog} is "[${latestRelease.version}]", expected "[${version}]"`,
        );
      }
      if (!ISO_DATE_RE.test(latestRelease.date)) {
        violations.push(
          `top release [${latestRelease.version}] in ${targets.changelog} has invalid date "${latestRelease.date}"`,
        );
      }
      if (latestRelease.highlights.length === 0) {
        violations.push(
          `top release [${latestRelease.version}] in ${targets.changelog} lists no feature/fix bullet points`,
        );
      }
    }
  }

  for (const readme of targets.readmes) {
    const fullReadme = join(root, readme.path);
    if (!existsSync(fullReadme)) {
      violations.push(`missing README: ${readme.path}`);
      continue;
    }
    const readmeText = readFileSync(fullReadme, 'utf8');
    if (readme.requireBadgeAndTable) {
      if (!readmeText.includes(`**Version \`${version}\`**`)) {
        violations.push(`${readme.path} is missing header badge "**Version \`${version}\`**"`);
      }
      const tableMatch = /\|\s*\*\*Release & Workspace Version\*\*\s*\|\s*`([^`]+)`/.exec(
        readmeText,
      );
      if (!tableMatch) {
        violations.push(`${readme.path} is missing the "Release & Workspace Version" table row`);
      } else if (tableMatch[1] !== version) {
        violations.push(
          `${readme.path} Versioning table states "${tableMatch[1]}", expected "${version}"`,
        );
      }
    }

    const blockMatch = new RegExp(`${WHATS_NEW_START}([\\s\\S]*?)${WHATS_NEW_END}`).exec(
      readmeText,
    );
    if (!blockMatch) {
      violations.push(
        `${readme.path} is missing the synchronized ${WHATS_NEW_START}…${WHATS_NEW_END} release highlights block`,
      );
    } else if (latestRelease) {
      const expectedBlock = renderWhatsNewBlock(latestRelease, {
        changelogLink: readme.changelogLink,
      });
      const actualFullBlock = `${WHATS_NEW_START}${blockMatch[1]}${WHATS_NEW_END}`;
      if (normalizeMarkdownFragment(actualFullBlock) !== normalizeMarkdownFragment(expectedBlock)) {
        violations.push(
          `${readme.path} "What's new" block is out of sync with ${targets.changelog} [${latestRelease.version}] (run "pnpm version:sync-readme")`,
        );
      }
    }
  }

  if (options.expectedTag !== undefined && options.expectedTag.trim() !== '') {
    const normalizedTag = options.expectedTag.trim().replace(/^refs\/tags\//, '');
    const expected = `v${version}`;
    if (normalizedTag !== expected) {
      violations.push(`expected git tag "${expected}", but received "${normalizedTag}"`);
    }
  }

  if (options.checkGitMainTag) {
    const gitState = inspectGitTagState(root, version);
    if (
      gitState.isGitRepo &&
      gitState.tagExists &&
      gitState.tagCommit &&
      gitState.headCommit &&
      gitState.tagCommit !== gitState.headCommit
    ) {
      violations.push(
        `git tag "v${version}" already exists at commit ${gitState.tagCommit.slice(0, 7)} ` +
          `(HEAD is ${gitState.headCommit.slice(0, 7)}). Every update on main must bump the ` +
          'version tag and update README/CHANGELOG via "pnpm version:bump <patch|minor|major>".',
      );
    }
  }

  return { version, violations };
}

/**
 * Format a new release section for `CHANGELOG.md`.
 *
 * @param {{
 *   version: string,
 *   date: string,
 *   summary?: string,
 *   added?: string[],
 *   changed?: string[],
 *   fixed?: string[]
 * }} entry
 * @returns {string}
 */
export function formatChangelogSection(entry) {
  const summary = entry.summary?.trim() || `Release ${entry.version} of the datadosomething suite.`;
  const added = (entry.added ?? []).map((s) => s.trim()).filter(Boolean);
  const changed = (entry.changed ?? []).map((s) => s.trim()).filter(Boolean);
  const fixed = (entry.fixed ?? []).map((s) => s.trim()).filter(Boolean);

  if (added.length === 0 && changed.length === 0 && fixed.length === 0) {
    changed.push(`Synchronized workspace release \`v${entry.version}\`.`);
  }

  const lines = [`## [${entry.version}] - ${entry.date}`, '', summary];

  if (added.length > 0) {
    lines.push('', '### Added', '');
    for (const item of added) lines.push(`- ${item}`);
  }
  if (changed.length > 0) {
    lines.push('', '### Changed', '');
    for (const item of changed) lines.push(`- ${item}`);
  }
  if (fixed.length > 0) {
    lines.push('', '### Fixed', '');
    for (const item of fixed) lines.push(`- ${item}`);
  }

  return lines.join('\n');
}

/**
 * Bump the workspace version across all manifests, `CORE_VERSION`,
 * `CHANGELOG.md`, and synchronized `README.md` files.
 *
 * @param {{
 *   root?: string,
 *   target: string,
 *   date?: string,
 *   summary?: string,
 *   added?: string[],
 *   changed?: string[],
 *   fixed?: string[],
 *   createGitTag?: boolean
 * }} options
 * @returns {{ previousVersion: string, nextVersion: string, date: string, tagCreated: boolean }}
 */
export function bumpVersion(options) {
  const root = resolve(options.root ?? REPO_ROOT);
  const targets = resolveVersionTargets(root);
  const rootManifestPath = join(root, 'package.json');
  const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'));
  const previousVersion = String(rootManifest.version ?? '');
  const nextVersion = computeNextSemver(previousVersion, options.target);
  const date = options.date ?? new Date().toISOString().slice(0, 10);

  if (!ISO_DATE_RE.test(date)) {
    throw new Error(`Invalid release date "${date}". Expected YYYY-MM-DD.`);
  }

  // 1. Update all package.json manifests.
  for (const relManifest of targets.manifests) {
    const full = join(root, relManifest);
    if (!existsSync(full)) continue;
    const pkg = JSON.parse(readFileSync(full, 'utf8'));
    pkg.version = nextVersion;
    writeFileSync(full, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  // 2. Update CORE_VERSION in packages/core/src/index.ts.
  const coreIndexPath = join(root, targets.coreIndex);
  const coreIndexBefore = readFileSync(coreIndexPath, 'utf8');
  const coreIndexAfter = coreIndexBefore.replace(
    /export const CORE_VERSION = '[^']+' as const;/,
    `export const CORE_VERSION = '${nextVersion}' as const;`,
  );
  writeFileSync(coreIndexPath, coreIndexAfter);

  // 3. Update CHANGELOG.md header and prepend the new release section if absent.
  const changelogPath = join(root, targets.changelog);
  let changelogText = readFileSync(changelogPath, 'utf8');
  changelogText = changelogText.replace(
    /Release & Workspace Version \(`[^`]+`\)/,
    `Release & Workspace Version (\`${nextVersion}\`)`,
  );

  const existingSection = parseChangelogRelease(changelogText, nextVersion);
  if (!existingSection) {
    const sectionMarkdown = formatChangelogSection({
      version: nextVersion,
      date,
      summary: options.summary,
      added: options.added,
      changed: options.changed,
      fixed: options.fixed,
    });
    const firstReleaseIndex = changelogText.search(/^## \[\d+\.\d+\.\d+\]/m);
    if (firstReleaseIndex === -1) {
      changelogText = `${changelogText.trimEnd()}\n\n---\n\n${sectionMarkdown}\n`;
    } else {
      changelogText =
        `${changelogText.slice(0, firstReleaseIndex)}${sectionMarkdown}\n\n---\n\n` +
        changelogText.slice(firstReleaseIndex);
    }
  }
  writeFileSync(changelogPath, changelogText);

  // 4. Synchronize README.md files with the updated CHANGELOG.md.
  syncReadmeWithChangelog({ root });

  // 5. Optionally create annotated Git tag vX.Y.Z.
  let tagCreated = false;
  if (options.createGitTag) {
    execFileSync('git', ['tag', '-a', `v${nextVersion}`, '-m', `Release v${nextVersion}`], {
      cwd: root,
      stdio: 'inherit',
    });
    tagCreated = true;
  }

  return { previousVersion, nextVersion, date, tagCreated };
}

/**
 * Parse CLI arguments for `scripts/version.mjs`.
 *
 * @param {string[]} argv
 */
export function parseCliArgs(argv) {
  const [subcommand = 'check', ...rest] = argv;
  /** @type {string[]} */
  const positionals = [];
  /** @type {string | undefined} */
  let tag;
  /** @type {string | undefined} */
  let date;
  /** @type {string | undefined} */
  let summary;
  /** @type {string | undefined} */
  let version;
  /** @type {string[]} */
  const added = [];
  /** @type {string[]} */
  const changed = [];
  /** @type {string[]} */
  const fixed = [];
  let checkGitMainTag = false;
  let createGitTag = false;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--check-git-tag') {
      checkGitMainTag = true;
    } else if (arg === '--tag') {
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        tag = next;
        i += 1;
      } else {
        createGitTag = true;
      }
    } else if (arg === '--date') {
      date = rest[i + 1];
      i += 1;
    } else if (arg === '--summary') {
      summary = rest[i + 1];
      i += 1;
    } else if (arg === '--version') {
      version = rest[i + 1];
      i += 1;
    } else if (arg === '--added') {
      if (rest[i + 1]) added.push(rest[i + 1]);
      i += 1;
    } else if (arg === '--changed') {
      if (rest[i + 1]) changed.push(rest[i + 1]);
      i += 1;
    } else if (arg === '--fixed') {
      if (rest[i + 1]) fixed.push(rest[i + 1]);
      i += 1;
    } else {
      positionals.push(arg);
    }
  }

  return {
    subcommand,
    positionals,
    tag,
    date,
    summary,
    version,
    added,
    changed,
    fixed,
    checkGitMainTag,
    createGitTag,
  };
}

function main() {
  const args = parseCliArgs(process.argv.slice(2));

  try {
    if (args.subcommand === 'current') {
      const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
      process.stdout.write(`${pkg.version}\n`);
      return;
    }

    if (args.subcommand === 'release-notes') {
      const targets = resolveVersionTargets(REPO_ROOT);
      const changelogText = readFileSync(join(REPO_ROOT, targets.changelog), 'utf8');
      const release = parseChangelogRelease(changelogText, args.version);
      if (!release) {
        console.error(
          `version: no changelog release section found${args.version ? ` for ${args.version}` : ''}.`,
        );
        process.exit(1);
      }
      process.stdout.write(`${release.rawBody}\n`);
      return;
    }

    if (args.subcommand === 'sync-readme') {
      const result = syncReadmeWithChangelog({ root: REPO_ROOT });
      console.log(
        `version: synchronized README "What's new" block with v${result.version} ` +
          `(${result.updatedFiles.length} file(s) updated).`,
      );
      return;
    }

    if (args.subcommand === 'bump') {
      const target = args.positionals[0];
      if (!target) {
        console.error(
          'Usage: pnpm version:bump <patch|minor|major|X.Y.Z> [--date YYYY-MM-DD] ' +
            '[--summary "..."] [--added "..."] [--changed "..."] [--fixed "..."] [--tag]',
        );
        process.exit(1);
      }
      const bumped = bumpVersion({
        root: REPO_ROOT,
        target,
        date: args.date,
        summary: args.summary,
        added: args.added,
        changed: args.changed,
        fixed: args.fixed,
        createGitTag: args.createGitTag,
      });
      console.log(
        `version: bumped ${bumped.previousVersion} -> ${bumped.nextVersion} (${bumped.date}) ` +
          'and synchronized CHANGELOG.md + README.md.',
      );
      return;
    }

    if (args.subcommand === 'check') {
      const { version, violations } = verifyVersioning({
        root: REPO_ROOT,
        expectedTag: args.tag,
        checkGitMainTag: args.checkGitMainTag,
      });
      if (violations.length > 0) {
        console.error(`\nversion-check FAILED (v${version}):`);
        for (const v of violations) console.error(`  - ${v}`);
        process.exit(1);
      }
      console.log(
        `version-check passed: v${version} is synchronized across all manifests, CORE_VERSION, CHANGELOG.md, and README.md.`,
      );
      return;
    }

    console.error(
      `version: unknown subcommand "${args.subcommand}". Expected check | sync-readme | bump | current | release-notes.`,
    );
    process.exit(1);
  } catch (cause) {
    console.error(`version: ${cause instanceof Error ? cause.message : cause}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
