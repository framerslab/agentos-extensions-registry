#!/usr/bin/env node

/**
 * Under plain Node, checks the built registry against the installed packages:
 * a catalog entry is reported as available exactly when its pack can load.
 *
 * The unit tests run under vitest, whose module runner has no
 * `import.meta.resolve`, so they exercise the fallback lookup. Consumers run
 * plain Node, where `import.meta.resolve` answers, and it resolves a package's
 * entry without checking that the file exists. This script runs that path: for
 * every catalog entry whose package is installed, `available` must equal
 * "the entry file is on disk, or the entry carries a factory that can run".
 *
 * Run after the build: node scripts/check-availability.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { entryPathOf } from './published-ranges-lib.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = path.join(packageRoot, 'dist', 'index.js');
if (!fs.existsSync(built)) {
  console.error('check-availability: dist/index.js is missing; build first.');
  process.exit(1);
}
if (typeof import.meta.resolve !== 'function') {
  console.error('check-availability: this runtime has no import.meta.resolve; run it under plain Node 20.6 or later.');
  process.exit(1);
}

const { getAvailableExtensions } = await import(pathToFileURL(built).href);
const extensions = await getAvailableExtensions();

const wrong = [];
let compared = 0;
let installedWithoutEntry = 0;
for (const extension of extensions) {
  const dir = path.join(packageRoot, 'node_modules', ...String(extension.packageName).split('/'));
  const manifestFile = path.join(dir, 'package.json');
  if (!fs.existsSync(manifestFile)) continue; // not installed here: nothing to compare against
  const entry = entryPathOf(JSON.parse(fs.readFileSync(manifestFile, 'utf8')));
  const entryOnDisk = entry !== null && fs.existsSync(path.join(dir, entry));
  if (!entryOnDisk) installedWithoutEntry += 1;
  const factory = extension.createPack;
  const localFactory = typeof factory === 'function' && (typeof factory.isAvailable === 'function' ? factory.isAvailable() : true);
  const expected = entryOnDisk || localFactory;
  compared += 1;
  if (extension.available !== expected) {
    wrong.push(
      `${extension.name} (${extension.packageName}): available=${extension.available}, but its entry file ${entryOnDisk ? 'exists' : 'is missing'} and it has ${localFactory ? 'a' : 'no'} usable built-in factory`,
    );
  }
}

console.log(
  `check-availability: compared ${compared} installed catalog entries; ${installedWithoutEntry} are installed without their entry file.`,
);
// A run that compared almost nothing would pass for the wrong reason.
if (compared < 40) {
  console.error(`check-availability: only ${compared} catalog entries are installed; the optional dependencies did not install.`);
  process.exit(1);
}
if (wrong.length > 0) {
  console.error(`${wrong.length} catalog entries report an availability that does not match what can load:`);
  for (const line of wrong) console.error(`  - ${line}`);
  process.exit(1);
}
