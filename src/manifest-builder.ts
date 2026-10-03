// @ts-nocheck
/**
 * @fileoverview Manifest builder — creates pre-configured ExtensionManifest
 * instances from the curated extension catalog.
 *
 * This is the primary API of the registry package. Instead of manually wiring
 * each extension pack in the backend, consumers call `createCuratedManifest()`
 * with their desired configuration.
 *
 * @module @framers/agentos-extensions-registry/manifest-builder
 */

import type { RegistryOptions, ExtensionInfo, RegistryLogger } from './types.js';
import { CHANNEL_CATALOG, getChannelEntries } from './channel-registry.js';
import { PROVIDER_CATALOG, getProviderEntries } from './provider-registry.js';
import { TOOL_CATALOG } from './tool-registry.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface ExtensionPackManifestEntry {
  package?: string;
  module?: string;
  factory?: () => Promise<unknown> | unknown;
  priority?: number;
  enabled?: boolean;
  options?: Record<string, unknown>;
  identifier?: string;
}

interface ExtensionManifest {
  packs: ExtensionPackManifestEntry[];
  overrides?: {
    tools?: Record<string, { enabled?: boolean; priority?: number }>;
  };
}
/**
 * Whether a package can be resolved from this module.
 *
 * Node defines `import.meta.resolve` (20.6+), which honours the package's
 * `exports` map and handles packages that only export an "import" condition.
 * Test runners that transform modules (vitest's vite-node) do not define it;
 * there the lookup walks up the directory tree for
 * `node_modules/<name>/package.json`, which is how Node locates a package.
 */
function isPackageInstalled(packageName: string): boolean {
  if (!packageName) return false;

  if (typeof import.meta.resolve === 'function') {
    try {
      import.meta.resolve(packageName);
      return true;
    } catch {
      return false;
    }
  }
  return findInstalledPackageJson(packageName) !== null;
}

/**
 * Walks up from this module's directory looking for an installed package whose
 * entry file exists, which is what `import.meta.resolve` checks: a package that
 * was published without its build output is not installed in any useful sense.
 */
function findInstalledPackageJson(packageName: string): string | null {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(dir, 'node_modules', ...packageName.split('/'), 'package.json');
    if (fs.existsSync(candidate)) {
      return fs.existsSync(path.join(path.dirname(candidate), entryFileOf(candidate))) ? candidate : null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The relative entry file a package's manifest points at (exports ".", then main, then index.js). */
function entryFileOf(packageJsonPath: string): string {
  let manifest: any = {};
  try {
    manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch {
    return 'index.js';
  }
  let target: unknown = manifest.exports?.['.'] ?? manifest.exports;
  // Conditions nest at most one level in the packs this registry lists.
  for (let depth = 0; depth < 2 && target && typeof target === 'object'; depth += 1) {
    const conditions = target as Record<string, unknown>;
    target = conditions.import ?? conditions.default ?? conditions.require ?? conditions.node;
  }
  if (typeof target === 'string') return target;
  return typeof manifest.main === 'string' ? manifest.main : 'index.js';
}

function isEntryAvailable(entry: ExtensionInfo): boolean {
  if (typeof entry.createPack === 'function') return true;
  return isPackageInstalled(entry.packageName);
}

/**
 * Attempt to dynamically import a package. Returns the module if available,
 * or `null` if the package is not installed.
 */
async function tryImport(packageName: string): Promise<any | null> {
  try {
    return await import(packageName);
  } catch {
    return null;
  }
}

/**
 * Check which extensions from the catalog are actually installed
 * and mark them as available.
 */
export async function getAvailableExtensions(): Promise<ExtensionInfo[]> {
  const allEntries: ExtensionInfo[] = [...TOOL_CATALOG, ...CHANNEL_CATALOG, ...PROVIDER_CATALOG];
  // Prefer pure resolution checks. Dynamic-importing every optional dependency
  // can be very slow in bundler/test runtimes that shim `import.meta`.
  return allEntries.map((entry) => ({
    ...entry,
    available: isEntryAvailable(entry),
  }));
}

/**
 * Get available channel extensions.
 */
export async function getAvailableChannels(): Promise<ExtensionInfo[]> {
  return CHANNEL_CATALOG.map((entry) => ({
    ...entry,
    available: isEntryAvailable(entry),
  }));
}

/**
 * Creates a pre-configured `ExtensionManifest` with all available curated
 * extensions. Missing optional dependencies are silently skipped.
 *
 * @example
 * ```typescript
 * import { createCuratedManifest } from '@framers/agentos-extensions-registry';
 *
 * // Enable all available extensions
 * const manifest = await createCuratedManifest();
 *
 * // Selective: only Telegram + Discord channels, all tools
 * const manifest = await createCuratedManifest({
 *   channels: ['telegram', 'discord'],
 *   tools: 'all',
 *   secrets: {
 *     'telegram.botToken': process.env.TELEGRAM_BOT_TOKEN!,
 *     'discord.botToken': process.env.DISCORD_BOT_TOKEN!,
 *   },
 * });
 *
 * // Pass to AgentOS config
 * const agentOS = new AgentOS({ extensionManifest: manifest });
 * ```
 */
export async function createCuratedManifest(options?: RegistryOptions): Promise<ExtensionManifest> {
  const basePriority = options?.basePriority ?? 0;
  const secrets = options?.secrets;
  const logger: RegistryLogger | undefined = options?.logger ?? console;
  const packs: ExtensionPackManifestEntry[] = [];

  // Helper to load and push a catalog entry
  const loadEntry = async (entry: ExtensionInfo) => {
    const override = options?.overrides?.[entry.name];
    if (override?.enabled === false) return;

    const effectivePriority = override?.priority ?? basePriority + entry.defaultPriority;
    const effectiveOptions = {
      ...override?.options,
      secrets,
      // Most curated packs accept `options.priority` and map it onto descriptor priorities.
      priority:
        (override?.options as Record<string, unknown> | undefined)?.priority ?? effectivePriority,
    };

    // Prefer the npm package when it is installed AND exports a pack factory;
    // a package that is installed but is not an extension pack (the built-in
    // AgentOS packs point at '@framers/agentos' and carry their own
    // `createPack`) or whose entry cannot be loaded falls back to the local
    // factory.
    const mod = entry.packageName && isPackageInstalled(entry.packageName)
      ? await tryImport(entry.packageName)
      : null;
    const factory = mod?.createExtensionPack ?? mod?.default?.createExtensionPack ?? mod?.default;

    if (typeof factory !== 'function') {
      if (!entry.createPack) return;
      packs.push({
        factory: () =>
          entry.createPack?.({
            options: effectiveOptions,
            getSecret: (secretId: string) => secrets?.[secretId],
            logger,
          }) as Promise<any>,
        priority: effectivePriority,
        enabled: true,
        identifier: `registry:${entry.name}`,
        options: effectiveOptions,
      });
      return;
    }

    packs.push({
      factory: () =>
        factory({
          options: effectiveOptions,
          getSecret: (secretId: string) => secrets?.[secretId],
          logger,
        }),
      // Priority applied to descriptors unless they override it individually.
      priority: effectivePriority,
      enabled: true,
      identifier: `registry:${entry.name}`,
      // Populate manifest entry options so AgentOS can evaluate `requiredSecrets` gating.
      options: effectiveOptions,
    });
  };

  // Split TOOL_CATALOG by category
  const toolOnlyEntries = TOOL_CATALOG.filter(
    (t) => t.category === 'tool' || t.category === 'integration'
  );
  const voiceEntries = TOOL_CATALOG.filter((t) => t.category === 'voice');
  const productivityEntries = TOOL_CATALOG.filter((t) => t.category === 'productivity');
  const cloudEntries = TOOL_CATALOG.filter((t) => t.category === 'cloud');
  const domainEntries = TOOL_CATALOG.filter((t) => t.category === 'domain');
  // Research-category packs (citation-verifier, trulia-search) are opt-in:
  // they load when a caller names them in `tools`, and stay out of `'all'`.
  const researchEntries = TOOL_CATALOG.filter((t) => (t.category as string) === 'research');

  // ── Tool Extensions ──
  const toolFilter = options?.tools ?? 'all';
  const filteredTools =
    toolFilter === 'none'
      ? []
      : toolFilter === 'all'
        ? toolOnlyEntries
        : [...toolOnlyEntries, ...researchEntries].filter((t) => toolFilter.includes(t.name));

  for (const entry of filteredTools) {
    await loadEntry(entry);
  }

  // ── Voice Provider Extensions ──
  const voiceFilter = options?.voice ?? 'all';
  const filteredVoice =
    voiceFilter === 'none'
      ? []
      : voiceFilter === 'all'
        ? voiceEntries
        : voiceEntries.filter((t) => voiceFilter.includes(t.name));

  for (const entry of filteredVoice) {
    await loadEntry(entry);
  }

  // ── Productivity Extensions ──
  const prodFilter = options?.productivity ?? 'all';
  const filteredProd =
    prodFilter === 'none'
      ? []
      : prodFilter === 'all'
        ? productivityEntries
        : productivityEntries.filter((t) => prodFilter.includes(t.name));

  for (const entry of filteredProd) {
    await loadEntry(entry);
  }

  // ── Cloud Provider Extensions ──
  const cloudFilter = options?.cloud ?? 'all';
  const filteredCloud =
    cloudFilter === 'none'
      ? []
      : cloudFilter === 'all'
        ? cloudEntries
        : cloudEntries.filter((t) => cloudFilter.includes(t.name));

  for (const entry of filteredCloud) {
    await loadEntry(entry);
  }

  // ── Domain Registrar Extensions ──
  const domainFilter = options?.domains ?? 'all';
  const filteredDomains =
    domainFilter === 'none'
      ? []
      : domainFilter === 'all'
        ? domainEntries
        : domainEntries.filter((t) => domainFilter.includes(t.name));

  for (const entry of filteredDomains) {
    await loadEntry(entry);
  }

  // ── Channel Extensions ──
  const channelEntries = getChannelEntries(options?.channels);

  for (const entry of channelEntries) {
    await loadEntry(entry);
  }

  // ── Build Overrides ──
  const manifestOverrides = options?.overrides
    ? {
        tools: Object.fromEntries(
          Object.entries(options.overrides)
            .filter(([, v]) => v.enabled !== undefined || v.priority !== undefined)
            .map(([k, v]) => [k, { enabled: v.enabled, priority: v.priority }])
        ),
      }
    : undefined;

  return {
    packs,
    overrides: manifestOverrides,
  };
}
