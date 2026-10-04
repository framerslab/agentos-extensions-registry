// @ts-nocheck
import { describe, expect, it } from 'vitest';

import { entryPathOf, inspectPack } from '../scripts/published-ranges-lib.mjs';

describe('entryPathOf', () => {
  it('reads the import condition of the "." export', () => {
    const manifest = {
      main: 'dist/index.cjs',
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' }, './package.json': './package.json' },
    };
    expect(entryPathOf(manifest)).toBe('dist/index.js');
  });

  it('follows nested conditions and fallback arrays', () => {
    expect(entryPathOf({ exports: { '.': { node: { import: './lib/node.mjs' } } } })).toBe('lib/node.mjs');
    expect(entryPathOf({ exports: { '.': [{ import: './esm/index.js' }, './cjs/index.js'] } })).toBe('esm/index.js');
  });

  it('treats exports without subpath keys as the root target', () => {
    expect(entryPathOf({ exports: './main.js' })).toBe('main.js');
    expect(entryPathOf({ exports: { import: './esm.js', require: './cjs.js' } })).toBe('esm.js');
  });

  it('falls back to main, then to index.js', () => {
    expect(entryPathOf({ main: './dist/index.js' })).toBe('dist/index.js');
    expect(entryPathOf({ exports: { './feature': './feature.js' }, main: 'lib/main.js' })).toBe('lib/main.js');
    expect(entryPathOf({})).toBe('index.js');
    expect(entryPathOf(undefined)).toBe('index.js');
  });
});

describe('inspectPack', () => {
  const manifest = { main: 'dist/index.js', exports: { '.': { import: './dist/index.js' } } };

  it('accepts a tarball that contains the entry point', () => {
    const files = ['LICENSE', 'README.md', 'dist/index.js', 'dist/index.d.ts', 'manifest.json', 'package.json'];
    expect(inspectPack({ files, manifest })).toEqual({ ok: true, entry: 'dist/index.js' });
  });

  it('rejects the three-file tarball the empty packs were published with', () => {
    const files = ['LICENSE', 'manifest.json', 'package.json'];
    expect(inspectPack({ files, manifest })).toEqual({ ok: false, reason: 'no-entry', entry: 'dist/index.js' });
  });

  it('rejects a tarball with five or more files and no code', () => {
    const files = ['CHANGELOG.md', 'LICENSE', 'README.md', 'manifest.json', 'package.json', 'tsconfig.json'];
    expect(inspectPack({ files, manifest })).toEqual({ ok: false, reason: 'no-entry', entry: 'dist/index.js' });
  });

  it('fails closed when the file list is missing, empty or malformed', () => {
    for (const files of [undefined, null, [], 'dist/index.js', [undefined], [{ path: 'dist/index.js' }]]) {
      expect(inspectPack({ files, manifest }), JSON.stringify(files)).toEqual({
        ok: false,
        reason: 'no-file-list',
        entry: 'dist/index.js',
      });
    }
  });
});
