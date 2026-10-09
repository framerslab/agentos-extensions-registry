// @ts-nocheck
import { describe, expect, it } from 'vitest';

import { compareVersions, entryPathOf, inspectPack, newestVersion } from '../scripts/published-ranges-lib.mjs';

describe('entryPathOf', () => {
  it('reads the import condition of the "." export', () => {
    const manifest = {
      main: 'dist/index.cjs',
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' }, './package.json': './package.json' },
    };
    expect(entryPathOf(manifest)).toBe('dist/index.js');
  });

  it('takes conditions in the order the package declares them', () => {
    expect(entryPathOf({ exports: { node: './node.js', default: './fallback.js' } })).toBe('node.js');
    expect(entryPathOf({ exports: { default: './fallback.js', node: './node.js' } })).toBe('fallback.js');
  });

  it('follows nested conditions and fallback arrays', () => {
    expect(entryPathOf({ exports: { '.': { node: { import: './lib/node.mjs' } } } })).toBe('lib/node.mjs');
    expect(entryPathOf({ exports: { '.': [{ import: './esm/index.js' }, './cjs/index.js'] } })).toBe('esm/index.js');
  });

  it('reads an exports array as Node does', () => {
    expect(entryPathOf({ exports: ['./first.js', './second.js'] })).toBe('first.js');
    // A target that does not start with "./" is invalid, and the next item is tried.
    expect(entryPathOf({ exports: ['not-relative.js', './index.js'] })).toBe('index.js');
    // A null is passed over too, and kept only when no later item resolves.
    expect(entryPathOf({ exports: [null, './index.js'] })).toBe('index.js');
    expect(entryPathOf({ exports: [null] })).toBeNull();
    expect(entryPathOf({ exports: ['not-relative.js'] })).toBeNull();
    // An empty array blocks the path like a null: the conditions after it are not tried.
    expect(entryPathOf({ exports: { import: [], default: './fallback.js' } })).toBeNull();
    // Outside an array nothing recovers from an invalid target: Node cannot import the package.
    expect(entryPathOf({ exports: 'not-relative.js' })).toBeNull();
    expect(entryPathOf({ exports: { import: 'not-relative.js', default: './fallback.js' } })).toBeNull();
  });

  it('refuses a target with a ".", ".." or node_modules segment, as Node does', () => {
    expect(entryPathOf({ exports: './../outside.js' })).toBeNull();
    expect(entryPathOf({ exports: './node_modules/dep/index.js' })).toBeNull();
    expect(entryPathOf({ exports: './dist/./index.js' })).toBeNull();
    expect(entryPathOf({ exports: './dist/%2e%2e/index.js' })).toBeNull();
    // In an array the next item is tried.
    expect(entryPathOf({ exports: ['./../outside.js', './index.js'] })).toBe('index.js');
    expect(entryPathOf({ exports: ['./node_modules/dep/index.js', './index.js'] })).toBe('index.js');
    // A name that only starts with a dot is an ordinary segment.
    expect(entryPathOf({ exports: './.build/index.js' })).toBe('.build/index.js');
  });

  it('treats exports without subpath keys as the root target', () => {
    expect(entryPathOf({ exports: './main.js' })).toBe('main.js');
    expect(entryPathOf({ exports: { require: './cjs.js', import: './esm.js' } })).toBe('esm.js');
  });

  it('gives no entry when exports has no root entry that import can load, even with a main', () => {
    expect(entryPathOf({ exports: { './feature': './feature.js' }, main: 'lib/main.js' })).toBeNull();
    expect(entryPathOf({ exports: { '.': { require: './cjs.js' } }, main: 'cjs.js' })).toBeNull();
  });

  it('treats a null target as a blocked path and does not try later conditions', () => {
    expect(entryPathOf({ exports: { '.': { import: null, default: './fallback.js' } } })).toBeNull();
    // In an array a null is passed over for the next item, as Node does.
    expect(entryPathOf({ exports: { '.': [null, './fallback.js'] } })).toBe('fallback.js');
  });

  it('uses main, then index.js, only when there is no exports field', () => {
    expect(entryPathOf({ main: './dist/index.js' })).toBe('dist/index.js');
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

  it('rejects a package whose exports map has no root entry, whatever the tarball holds', () => {
    const files = ['feature.js', 'lib/main.js', 'package.json'];
    expect(inspectPack({ files, manifest: { exports: { './feature': './feature.js' }, main: 'lib/main.js' } })).toEqual({
      ok: false,
      reason: 'no-root-export',
      entry: null,
    });
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

describe('newestVersion', () => {
  it('picks the highest version whatever the order of the list', () => {
    expect(newestVersion(['0.9.9', '0.10.0', '0.1.0'])).toBe('0.10.0');
    expect(newestVersion(['1.2.0', '1.1.1'])).toBe('1.2.0');
    expect(newestVersion(['2.0.0'])).toBe('2.0.0');
    expect(newestVersion([])).toBeUndefined();
  });

  it('ranks a release above its own pre-releases', () => {
    expect(newestVersion(['1.0.0-beta.2', '1.0.0', '1.0.0-beta.1'])).toBe('1.0.0');
    expect(compareVersions('1.0.0-beta.1', '1.0.0-beta.2')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('compares pre-release identifiers by SemVer precedence', () => {
    expect(newestVersion(['1.0.0-beta.2', '1.0.0-beta.11'])).toBe('1.0.0-beta.11');
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBe(-1);
    expect(compareVersions('1.0.0-rc.1+build.5', '1.0.0-rc.1')).toBe(0);
  });
});
