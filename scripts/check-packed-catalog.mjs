#!/usr/bin/env node

/**
 * Packs the registry exactly as a release would and asserts that the tarball's
 * capability catalog is populated.
 *
 * Version 0.18.3 was published with an empty catalog because the generator ran
 * in a checkout without the extension sources. Reading the built file out of
 * the packed tarball checks the artifact that consumers install, not the
 * source tree.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_ENTRIES = 100;
const REQUIRED_IDS = [
  'com.framers.research.web-search',
  'com.framers.research.deep-research',
  'com.framers.research.content-extraction',
];

const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-pack-'));
// The build has already run; `--ignore-scripts` keeps `prepare` from running it again.
execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', destination], {
  cwd: packageRoot,
  stdio: ['ignore', 'ignore', 'inherit'],
});
const tarballName = fs.readdirSync(destination).find((file) => file.endsWith('.tgz'));
if (!tarballName) {
  console.error('npm pack produced no tarball');
  process.exit(1);
}
const tarball = path.join(destination, tarballName);

let catalog;
try {
  catalog = JSON.parse(
    execFileSync('tar', ['-xzOf', tarball, 'package/dist/capability-catalog.json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
} catch (error) {
  console.error(`The tarball has no readable dist/capability-catalog.json: ${error.message.split('\n')[0]}`);
  process.exit(1);
}

const problems = [];
if (!Array.isArray(catalog)) {
  problems.push('the catalog is not an array');
} else {
  if (catalog.length < MIN_ENTRIES) {
    problems.push(`the catalog has ${catalog.length} entries, expected at least ${MIN_ENTRIES}`);
  }
  const ids = new Set(catalog.map((entry) => entry.id));
  for (const id of REQUIRED_IDS) {
    if (!ids.has(id)) problems.push(`the catalog is missing ${id}`);
  }
}

if (problems.length > 0) {
  console.error(`${tarballName} would publish a broken capability catalog:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`${tarballName}: capability catalog has ${catalog.length} entries.`);
