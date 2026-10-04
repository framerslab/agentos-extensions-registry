/**
 * Pure helpers for `check-published-ranges.mjs` and `check-availability.mjs`:
 * which file a published package names as its entry point, whether its
 * tarball contains it, and which of several versions is the newest.
 */

/**
 * The conditions Node applies when a package is loaded with `import`, which is
 * how the registry loads a pack. `require` is not among them.
 */
const ACTIVE_CONDITIONS = new Set(['import', 'node', 'module-sync', 'node-addons', 'default']);

/**
 * Follows an `exports` target down to a file path the way Node does: a string
 * is the path, an array is a list of fallbacks, and a conditions object yields
 * the first key, in the package's own order, that is an active condition and
 * resolves. A `null` target blocks the path: Node stops there and does not try
 * the conditions after it.
 * @param {unknown} target
 * @param {number} depth how many levels of nesting are still followed
 * @returns {string | null | undefined} a path, null when the path is blocked,
 *   undefined when nothing matched
 */
function resolveTarget(target, depth) {
  if (typeof target === 'string') return target;
  if (target === null) return null;
  if (depth === 0 || typeof target !== 'object') return undefined;
  if (Array.isArray(target)) {
    for (const item of target) {
      const resolved = resolveTarget(item, depth - 1);
      if (resolved !== undefined) return resolved;
    }
    return undefined;
  }
  for (const [condition, value] of Object.entries(target)) {
    if (!ACTIVE_CONDITIONS.has(condition)) continue;
    const resolved = resolveTarget(value, depth - 1);
    if (resolved !== undefined) return resolved;
  }
  return undefined;
}

/**
 * The file `import '<package>'` loads, relative to the package root and
 * without a leading "./".
 *
 * A package with an `exports` field is resolved through it alone: Node does
 * not fall back to `main`, so a map without a root entry for `import` means
 * the package cannot be imported by name, and this returns null. Without
 * `exports` the entry is `main`, then `index.js`.
 * @param {{ main?: unknown, exports?: unknown }} manifest
 * @returns {string | null}
 */
export function entryPathOf(manifest) {
  const exported = manifest?.exports;
  if (exported !== undefined && exported !== null) {
    let target = exported;
    if (typeof exported === 'object' && !Array.isArray(exported)) {
      const hasSubpaths = Object.keys(exported).some((key) => key.startsWith('.'));
      if (hasSubpaths) target = exported['.'];
    }
    const resolved = resolveTarget(target, 4);
    return typeof resolved === 'string' && resolved ? resolved.replace(/^\.\//, '') : null;
  }
  const entry = typeof manifest?.main === 'string' && manifest.main ? manifest.main : 'index.js';
  return entry.replace(/^\.\//, '');
}

/**
 * Checks that a published tarball contains the file `import` would load.
 *
 * A file count cannot answer that: a tarball with a README, a licence, a
 * changelog, a manifest and package.json has five files and no code.
 * @param {{ files?: unknown, manifest: { main?: unknown, exports?: unknown } }} pack
 *   `files` is the tarball's file list (paths relative to the package root).
 * @returns {{ ok: true, entry: string }
 *   | { ok: false, reason: 'no-file-list' | 'no-entry', entry: string }
 *   | { ok: false, reason: 'no-root-export', entry: null }}
 */
export function inspectPack({ files, manifest }) {
  const entry = entryPathOf(manifest);
  if (entry === null) return { ok: false, reason: 'no-root-export', entry: null };
  if (!Array.isArray(files) || files.length === 0 || files.some((file) => typeof file !== 'string')) {
    return { ok: false, reason: 'no-file-list', entry };
  }
  const listed = new Set(files.map((file) => file.replace(/^\.\//, '')));
  return listed.has(entry) ? { ok: true, entry } : { ok: false, reason: 'no-entry', entry };
}

/**
 * Orders two pre-release tags by SemVer precedence: identifiers are compared
 * left to right, numeric ones as numbers (beta.11 is above beta.2), a numeric
 * identifier sorts below a textual one, and a tag that runs out first sorts
 * lower.
 * @returns {-1 | 0 | 1}
 */
function comparePrerelease(a, b) {
  const [left, right] = [a.split('.'), b.split('.')];
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] === undefined) return -1;
    if (right[index] === undefined) return 1;
    const [leftNumeric, rightNumeric] = [/^\d+$/.test(left[index]), /^\d+$/.test(right[index])];
    if (leftNumeric && rightNumeric) {
      const difference = Number(left[index]) - Number(right[index]);
      if (difference !== 0) return difference < 0 ? -1 : 1;
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    } else if (left[index] !== right[index]) {
      return left[index] < right[index] ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Orders two versions of the form x.y.z or x.y.z-tag by SemVer precedence. A
 * release sorts above its own pre-releases; build metadata is ignored.
 * @returns {-1 | 0 | 1}
 */
export function compareVersions(a, b) {
  const parse = (version) => {
    const [core, ...tag] = String(version ?? '').split('+')[0].split('-');
    return { parts: core.split('.').map((part) => Number.parseInt(part, 10) || 0), tag: tag.join('-') };
  };
  const [left, right] = [parse(a), parse(b)];
  for (let index = 0; index < 3; index += 1) {
    const difference = (left.parts[index] ?? 0) - (right.parts[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  if (left.tag === right.tag) return 0;
  if (!left.tag) return 1;
  if (!right.tag) return -1;
  return comparePrerelease(left.tag, right.tag);
}

/**
 * The highest version in a list. npm returns the versions that match a range
 * in the order the registry lists them, which is not guaranteed to be version
 * order.
 * @param {string[]} versions
 * @returns {string | undefined}
 */
export function newestVersion(versions) {
  let newest;
  for (const version of versions) {
    if (typeof version !== 'string') continue;
    if (newest === undefined || compareVersions(version, newest) > 0) newest = version;
  }
  return newest;
}
