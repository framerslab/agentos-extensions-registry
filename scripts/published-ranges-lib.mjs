/**
 * Pure helpers for `check-published-ranges.mjs`: which file a published
 * package names as its entry point, and whether its tarball contains it.
 */

/** Conditions tried, in order, when an `exports` target is a conditions object. */
const CONDITIONS = ['import', 'default', 'require', 'node'];

/**
 * Follows an `exports` target down to a file path.
 * @param {unknown} target a string, a conditions object, or a fallback array
 * @param {number} depth how many levels of nesting are still followed
 * @returns {string | undefined}
 */
function resolveTarget(target, depth) {
  if (typeof target === 'string') return target;
  if (depth === 0 || !target || typeof target !== 'object') return undefined;
  if (Array.isArray(target)) {
    for (const item of target) {
      const resolved = resolveTarget(item, depth - 1);
      if (resolved) return resolved;
    }
    return undefined;
  }
  for (const condition of CONDITIONS) {
    if (condition in target) {
      const resolved = resolveTarget(target[condition], depth - 1);
      if (resolved) return resolved;
    }
  }
  return undefined;
}

/**
 * The file a package manifest names as its entry point, relative to the
 * package root and without a leading "./". The order is the one Node follows:
 * the "." entry of `exports` (or `exports` itself when it has no subpath keys),
 * then `main`, then `index.js`.
 * @param {{ main?: unknown, exports?: unknown }} manifest
 * @returns {string}
 */
export function entryPathOf(manifest) {
  const exported = manifest?.exports;
  let target;
  if (typeof exported === 'string' || Array.isArray(exported)) {
    target = exported;
  } else if (exported && typeof exported === 'object') {
    const hasSubpaths = Object.keys(exported).some((key) => key.startsWith('.'));
    target = hasSubpaths ? exported['.'] : exported;
  }
  const fromExports = resolveTarget(target, 3);
  const entry = fromExports ?? (typeof manifest?.main === 'string' && manifest.main ? manifest.main : 'index.js');
  return entry.replace(/^\.\//, '');
}

/**
 * Checks that a published tarball contains the package's entry point.
 *
 * A file count cannot answer that: a tarball with a README, a licence, a
 * changelog, a manifest and package.json has five files and no code.
 * @param {{ files?: unknown, manifest: { main?: unknown, exports?: unknown } }} pack
 *   `files` is the tarball's file list (paths relative to the package root).
 * @returns {{ ok: true, entry: string } | { ok: false, reason: 'no-file-list' | 'no-entry', entry: string }}
 */
export function inspectPack({ files, manifest }) {
  const entry = entryPathOf(manifest);
  if (!Array.isArray(files) || files.length === 0 || files.some((file) => typeof file !== 'string')) {
    return { ok: false, reason: 'no-file-list', entry };
  }
  const listed = new Set(files.map((file) => file.replace(/^\.\//, '')));
  return listed.has(entry) ? { ok: true, entry } : { ok: false, reason: 'no-entry', entry };
}
