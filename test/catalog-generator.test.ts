import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../scripts/generate-capability-catalog.mjs', import.meta.url));

/** Runs the generator with its input and output redirected to a temp directory. */
function runGenerator(extensionsRoot: string, output: string) {
  return spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CAPABILITY_CATALOG_EXTENSIONS_ROOT: extensionsRoot,
      CAPABILITY_CATALOG_OUTPUT: output,
    },
  });
}

describe('generate-capability-catalog', () => {
  it('keeps the existing catalog when no extension manifests are available', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-keep-'));
    const output = path.join(dir, 'capability-catalog.json');
    const snapshot = `${JSON.stringify([{ id: 'com.framers.research.web-search' }], null, 2)}\n`;
    fs.writeFileSync(output, snapshot);

    const result = runGenerator(path.join(dir, 'no-such-checkout'), output);

    expect(result.status).toBe(0);
    expect(fs.readFileSync(output, 'utf8')).toBe(snapshot);
  });

  it('rewrites the catalog from the manifests when they are available', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-write-'));
    const output = path.join(dir, 'capability-catalog.json');
    fs.writeFileSync(output, '[]\n');
    const packDir = path.join(dir, 'curated', 'research', 'demo');
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(
      path.join(packDir, 'manifest.json'),
      JSON.stringify({ name: 'Demo', description: 'A demo pack', categories: ['research'], requiredSecrets: ['demo.apiKey'] }),
    );

    const result = runGenerator(path.join(dir, 'curated'), output);

    expect(result.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toEqual([
      {
        id: 'com.framers.research.demo',
        name: 'Demo',
        description: 'A demo pack',
        category: 'research',
        tools: [],
        requiredSecrets: ['demo.apiKey'],
      },
    ]);
  });
});
