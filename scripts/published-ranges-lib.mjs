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
 * What a target Node rejects resolves to: a string that does not start with
 * "./", or whose path has a ".", ".." or "node_modules" segment. Node throws
 * ERR_INVALID_PACKAGE_TARGET for it, and only the next item of an array
 * recovers from that.
 */
const INVALID_TARGET = Symbol('invalid package target');

/**
 * Node's own test for a target path with a ".", ".." or "node_modules"
 * segment, percent-encoded or not (`deprecatedInvalidSegmentRegEx` in
 * lib/internal/modules/esm/resolve.js). Node refuses such a target.
 */
const INVALID_SEGMENT =
  /(^|\\|\/)((\.|%2e)(\.|%2e)?|(n|%6e|%4e)(o|%6f|%4f)(d|%64|%44)(e|%65|%45)(_|%5f)(m|%6d|%4d)(o|%6f|%4f)(d|%64|%44)(u|%75|%55)(l|%6c|%4c)(e|%65|%45)(s|%73|%53))(\\|\/|$)/i;

/**
 * Follows an `exports` target down to a file path the way Node does
 * (`resolvePackageTarget` in lib/internal/modules/esm/resolve.js): a string
 * that starts with "./" and has no ".", ".." or "node_modules" segment is
 * the path, and a conditions object yields the first
 * key, in the package's own order, that is an active condition and resolves.
 * A `null` target blocks the path: Node stops there and does not try the
 * conditions after it. An array is a list of fallbacks tried in order: an
 * item that is invalid, blocked or resolves to nothing is passed over for
 * the next, and when no item gives a path the array resolves as its last
 * invalid or blocked item did. An empty array blocks the path.
 * @param {unknown} target
 * @param {number} depth how many levels of nesting are still followed
 * @returns {string | null | undefined | typeof INVALID_TARGET} a path, null
 *   when the path is blocked, undefined when nothing matched, INVALID_TARGET
 *   when Node would refuse the target
 */
function resolveTarget(target, depth) {
  if (typeof target === 'string') {
    return target.startsWith('./') && !INVALID_SEGMENT.test(target.slice(2)) ? target : INVALID_TARGET;
  }
  if (target === null) return null;
  if (depth === 0 || typeof target !== 'object') return undefined;
  if (Array.isArray(target)) {
    if (target.length === 0) return null;
    let last;
    for (const item of target) {
      const resolved = resolveTarget(item, depth - 1);
      if (resolved === undefined) continue;
      if (resolved === null || resolved === INVALID_TARGET) {
        last = resolved;
        continue;
      }
      return resolved;
    }
    return last;
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
