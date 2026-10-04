#!/usr/bin/env node

/**
 * Asserts that every optional dependency range resolves to a version that is
 * on npm and whose tarball contains the package's entry point.
 *
 * The registry installs its extension packs through `optionalDependencies`, so
 * a range that points at nothing, or at a tarball without build output, is a
 * pack that silently never loads. For each range this script asks npm for the
 * newest matching version and its `main` and `exports`, lists the files of that
 * version's tarball, and checks that the entry point is among them. A pack
 * whose file list cannot be read fails: it has not been shown to ship code.
 *
 * Packs listed in `known-empty-packs.json` are the ones already published
 * without code; a new empty pack fails the check, and a listed pack that has
 * been republished with its entry point only warns, so the list can be trimmed
 * without blocking a release.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { inspectPack, newestVersion } from './published-ranges-lib.mjs';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
const knownEmpty = new Set(
  JSON.parse(fs.readFileSync(path.join(packageRoot, 'scripts', 'known-empty-packs.json'), 'utf8')),
);

const CONCURRENCY = 8;

/** Runs an npm command that prints JSON and parses its output. */
async function npmJson(args) {
  const { stdout } = await execFileAsync('npm', [...args, '--json'], { maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim() ? JSON.parse(stdout) : undefined;
}

/** The first line npm printed for a failed command. */
function firstLine(error) {
  const text = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  if (text.includes('E404')) return 'package is not on npm';
  return text.trim().split('\n')[0] || String(error.message ?? error);
}

/**
 * Resolves one range against npm and reads the tarball's file list.
 * @returns {Promise<{name: string, range: string, version?: string, files?: string[] | null, manifest?: object, error?: string}>}
 */
async function resolveRange(name, range) {
  let view;
  try {
    view = await npmJson(['view', `${name}@${range}`, 'version', 'main', 'exports']);
  } catch (error) {
    return { name, range, error: firstLine(error) };
  }
  if (view === undefined) return { name, range, error: 'no published version satisfies the range' };
  // One match is an object; several matches are an array in the order the
  // registry lists them, so the newest is picked by version, not by position.
  // npm prints the bare value when a version carries only one of the fields.
  const matches = (Array.isArray(view) ? view : [view]).map((item) => (typeof item === 'string' ? { version: item } : item));
  const highest = newestVersion(matches.map((item) => item?.version));
  const newest = matches.find((item) => item?.version === highest);
  if (!newest || typeof newest.version !== 'string') {
    return { name, range, error: 'npm returned no version for the range' };
  }

  let files = null;
  try {
    const packed = await npmJson(['pack', `${name}@${newest.version}`, '--dry-run']);
    const listing = (Array.isArray(packed) ? packed[0] : packed)?.files;
    files = Array.isArray(listing) ? listing.map((file) => file?.path) : null;
  } catch (error) {
    return { name, range, version: newest.version, error: `the tarball's file list could not be read (${firstLine(error)})` };
  }
  return { name, range, version: newest.version, files, manifest: { main: newest.main, exports: newest.exports } };
}

const entries = Object.entries(pkg.optionalDependencies ?? {});
const results = [];
for (let index = 0; index < entries.length; index += CONCURRENCY) {
  const batch = entries.slice(index, index + CONCURRENCY);
  results.push(...(await Promise.all(batch.map(([name, range]) => resolveRange(name, range)))));
}

const failures = [];
for (const result of results) {
  const label = `${result.name}@${result.range}`;
  if (result.error) {
    failures.push(`${label}: ${result.error}`);
    continue;
  }
  const inspection = inspectPack(result);
  const listed = knownEmpty.has(result.name);
  if (inspection.ok) {
    if (listed) {
      console.log(`::warning::${result.name} ${result.version} now ships its entry point; remove it from scripts/known-empty-packs.json`);
    }
    continue;
  }
  if (inspection.reason === 'no-file-list') {
    failures.push(`${label}: resolves to ${result.version}, whose file list npm did not return, so it is not shown to ship code`);
    continue;
  }
  if (inspection.reason === 'no-root-export') {
    // Not something a republish of the same source fixes, so the known-empty
    // list does not excuse it.
    failures.push(`${label}: resolves to ${result.version}, whose exports map has no root entry for import, so the package cannot be imported by name`);
    continue;
  }
  if (!listed) {
    failures.push(
      `${label}: resolves to ${result.version}, which ships ${result.files.length} files and not its entry point ${inspection.entry}`,
    );
  }
}
for (const name of knownEmpty) {
  if (!(name in (pkg.optionalDependencies ?? {}))) {
    console.log(`::warning::${name} is in scripts/known-empty-packs.json but is not an optional dependency`);
  }
}

console.log(`Checked ${results.length} optional dependency ranges.`);
if (failures.length > 0) {
  console.error(`${failures.length} range(s) do not resolve to a published version with its entry point:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
