/**
 * Answers, under plain Node, whether `import` resolves each package to a file on disk.
 *
 * Takes the package names as a JSON array in its first argument and writes a JSON
 * object of name to boolean. `import.meta.resolve` applies the `import` conditions of
 * a package's `exports` map, as consumers' `import` does, and resolves an `exports`
 * target without checking that the file exists, so the file is checked here. Tests
 * run it as a child process: vitest's module runner does not define
 * `import.meta.resolve`.
 *
 * Run: node test/helpers/import-resolve.mjs '["@framers/agentos-ext-channel-email"]'
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const answers = {};
for (const name of JSON.parse(process.argv[2] ?? '[]')) {
  try {
    const url = import.meta.resolve(name);
    answers[name] = !url.startsWith('file:') || existsSync(fileURLToPath(url));
  } catch {
    answers[name] = false;
  }
}
process.stdout.write(JSON.stringify(answers));
