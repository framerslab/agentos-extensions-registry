#!/usr/bin/env node

/**
 * Asserts that every optional dependency range resolves to a version that is
 * on npm and ships code.
 *
 * The registry installs its extension packs through `optionalDependencies`, so
 * a range that points at nothing, or at a tarball without build output, is a
 * pack that silently never loads. Packs listed in `known-empty-packs.json` are
 * the ones already published without code; a new empty pack fails the check,
 * and a listed pack that has been republished with code only warns, so the
 * list can be trimmed without blocking a release.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
const knownEmpty = new Set(
  JSON.parse(fs.readFileSync(path.join(packageRoot, 'scripts', 'known-empty-packs.json'), 'utf8')),
);

/** A tarball with fewer files than this holds only package.json, a manifest and a licence. */
const MIN_FILES_WITH_CODE = 5;
const CONCURRENCY = 8;

/**
 * Resolves one range against npm.
 * @returns {Promise<{name: string, range: string, version?: string, fileCount?: number, error?: string}>}
 */
async function resolveRange(name, range) {
  try {
    const { stdout } = await execFileAsync(
      'npm',
      ['view', `${name}@${range}`, 'version', 'dist.fileCount', '--json'],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    if (!stdout.trim()) return { name, range, error: 'no published version satisfies the range' };
    const parsed = JSON.parse(stdout);
    // One match is an object; several matches are an array in ascending order.
    const newest = Array.isArray(parsed) ? parsed[parsed.length - 1] : parsed;
    return { name, range, version: newest.version, fileCount: newest['dist.fileCount'] };
  } catch (error) {
    const text = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    return {
      name,
      range,
      error: text.includes('E404') ? 'package is not on npm' : text.trim().split('\n')[0] || String(error),
    };
  }
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
  const empty = typeof result.fileCount === 'number' && result.fileCount < MIN_FILES_WITH_CODE;
  if (empty && !knownEmpty.has(result.name)) {
    failures.push(`${label}: resolves to ${result.version}, which ships ${result.fileCount} files and no code`);
  }
  if (!empty && knownEmpty.has(result.name)) {
    console.log(`::warning::${result.name} ${result.version} now ships code; remove it from scripts/known-empty-packs.json`);
  }
}
for (const name of knownEmpty) {
  if (!(name in (pkg.optionalDependencies ?? {}))) {
    console.log(`::warning::${name} is in scripts/known-empty-packs.json but is not an optional dependency`);
  }
}

console.log(`Checked ${results.length} optional dependency ranges.`);
if (failures.length > 0) {
  console.error(`${failures.length} range(s) do not resolve to a published version with code:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
