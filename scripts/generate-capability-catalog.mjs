#!/usr/bin/env node

/**
 * Generate capability-catalog.json from all extension manifest.json files.
 *
 * Scans every manifest.json under `packages/agentos-extensions/registry/curated/`
 * (or `CAPABILITY_CATALOG_EXTENSIONS_ROOT`) and extracts a compact catalog entry:
 * id, name, description, category, tools (from extensions[].id), and
 * requiredSecrets. The output file lives at `src/capability-catalog.json`
 * (or `CAPABILITY_CATALOG_OUTPUT`) and is imported by `capability-catalog.ts`.
 * When no manifests are found, the committed file is left untouched.
 *
 * Run manually:
 *   node scripts/generate-capability-catalog.mjs
 *
 * Also wired as a prebuild step in package.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const extensionsRoot = process.env.CAPABILITY_CATALOG_EXTENSIONS_ROOT
  ? path.resolve(process.env.CAPABILITY_CATALOG_EXTENSIONS_ROOT)
  : path.resolve(packageRoot, '..', 'agentos-extensions', 'registry', 'curated');
const outputPath = process.env.CAPABILITY_CATALOG_OUTPUT
  ? path.resolve(process.env.CAPABILITY_CATALOG_OUTPUT)
  : path.join(packageRoot, 'src', 'capability-catalog.json');

/**
 * Recursively find all manifest.json files under a directory.
 * @param {string} dir - Root directory to scan.
 * @returns {string[]} Absolute paths to manifest.json files.
 */
function findManifests(dir) {
  const results = [];

  if (!fs.existsSync(dir)) {
    console.warn(`Warning: extensions directory not found at ${dir}`);
    return results;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findManifests(fullPath));
    } else if (entry.name === 'manifest.json') {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Derive a dot-notation ID from the manifest's filesystem path relative to
 * the curated extensions root. For example:
 *   voice/amazon-polly/manifest.json → com.framers.voice.amazon-polly
 *
 * @param {string} manifestPath - Absolute path to manifest.json.
 * @returns {string} Derived ID.
 */
function deriveIdFromPath(manifestPath) {
  const rel = path.relative(extensionsRoot, path.dirname(manifestPath));
  const segments = rel.split(path.sep).filter(Boolean);
  return `com.framers.${segments.join('.')}`;
}

/**
 * Extract a compact catalog entry from a parsed manifest.
 * @param {object} manifest - Parsed manifest.json contents.
 * @param {string} manifestPath - Absolute path for fallback ID derivation.
 * @returns {object} Catalog entry with id, name, description, category, tools, requiredSecrets.
 */
function extractEntry(manifest, manifestPath) {
  // Use explicit id if present, otherwise derive from directory structure
  const id = manifest.id || deriveIdFromPath(manifestPath);
  const name = manifest.name || manifest.displayName || '';
  const description = manifest.description || '';

  // Pick the first category from the categories array; fall back to
  // singular `category` field or derive from parent directory
  const categories = Array.isArray(manifest.categories) ? manifest.categories : [];
  const category =
    categories[0] ||
    (typeof manifest.category === 'string' ? manifest.category : '') ||
    'uncategorized';

  // Extract tool IDs from the v1 schema `extensions` array
  const extensions = Array.isArray(manifest.extensions) ? manifest.extensions : [];
  let tools = extensions
    .map((ext) => ext.id)
    .filter((toolId) => typeof toolId === 'string' && toolId.length > 0);

  // Fallback: some older manifests use a flat `tools` array of strings
  if (tools.length === 0 && Array.isArray(manifest.tools)) {
    tools = manifest.tools.filter((t) => typeof t === 'string');
  }

  // requiredSecrets — always an array of strings
  const requiredSecrets = Array.isArray(manifest.requiredSecrets)
    ? manifest.requiredSecrets.filter((s) => typeof s === 'string')
    : [];

  return { id, name, description, category, tools, requiredSecrets };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const manifests = findManifests(extensionsRoot);
console.log(`Found ${manifests.length} manifest.json files under ${extensionsRoot}`);

// A standalone checkout (CI, the release job, an npm install that runs
// `prepare`) has no sibling agentos-extensions tree. Writing the empty result
// would publish an empty catalog, so the committed snapshot stays as it is.
if (manifests.length === 0) {
  console.log(`Keeping the committed catalog at ${outputPath}.`);
  process.exit(0);
}

const catalog = [];

for (const manifestPath of manifests.sort()) {
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    const entry = extractEntry(parsed, manifestPath);

    if (!entry.id) {
      console.warn(`  Skipping ${manifestPath} — could not derive ID`);
      continue;
    }

    catalog.push(entry);
  } catch (err) {
    console.warn(`  Skipping ${manifestPath} — ${err.message}`);
  }
}

// Sort by id for deterministic output
catalog.sort((a, b) => a.id.localeCompare(b.id));

fs.writeFileSync(outputPath, JSON.stringify(catalog, null, 2) + '\n');

console.log(`Wrote ${catalog.length} entries to ${outputPath}`);
