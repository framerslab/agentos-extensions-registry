// @ts-nocheck
/**
 * End-to-end-ish integration: curated manifest -> AgentOS ExtensionManager.
 *
 * This ensures manifest-builder threads `options.secrets` so AgentOS can evaluate
 * `requiredSecrets` gating without relying on environment variables.
 */

import { describe, it, expect } from 'vitest';

import { createCuratedManifest, getAvailableExtensions } from '../src/index';
// The published package is the contract a standalone checkout and every
// consumer resolve, so the integration test uses it too.
import { EXTENSION_KIND_TOOL, ExtensionManager } from '@framers/agentos/extensions';

describe('AgentOS integration', () => {
  it('loads secret-gated tools when secrets are provided in the manifest', async () => {
    const prev = process.env.GIPHY_API_KEY;
    // Avoid env fallback masking failures.
    delete process.env.GIPHY_API_KEY;

    try {
      const manifest = await createCuratedManifest({
        channels: 'none',
        tools: ['giphy'],
        voice: 'none',
        productivity: 'none',
        secrets: { 'giphy.apiKey': 'test-giphy-key' },
      });

      const manager = new ExtensionManager({ manifest });
      await manager.loadManifest();

      // Descriptors are keyed by their id, which the published 1.0.0 pack sets
      // to 'giphySearch' and the source sets to the tool name; the tool itself
      // is 'giphy_search' in both.
      const toolRegistry = manager.getRegistry<any>(EXTENSION_KIND_TOOL);
      const active = toolRegistry.listActive() as Array<{ id: string; payload?: { name?: string } }>;
      const giphy = active.find((entry) => entry.id === 'giphy_search' || entry.payload?.name === 'giphy_search');
      expect(giphy, `active tools: ${active.map((entry) => entry.id).join(', ')}`).toBeDefined();
    } finally {
      if (prev === undefined) {
        delete process.env.GIPHY_API_KEY;
      } else {
        process.env.GIPHY_API_KEY = prev;
      }
    }
  });

  it('loads a research pack that is named in tools and installed', async () => {
    const manifest = await createCuratedManifest({
      channels: 'none',
      tools: ['trulia-search'],
      voice: 'none',
      productivity: 'none',
      cloud: 'none',
      domains: 'none',
      logger: {},
    });
    expect(manifest.packs.map((pack) => pack.identifier)).toContain('registry:trulia-search');

    const manager = new ExtensionManager({ manifest });
    await manager.loadManifest();

    const active = manager.getRegistry<any>(EXTENSION_KIND_TOOL).listActive() as Array<{ id: string }>;
    expect(active.map((entry) => entry.id)).toContain('trulia_search');
  });

  it('skips a named pack that cannot load here, names the package to install, and still loads the manifest', async () => {
    // In the monorepo a sibling checkout provides citation-verifier; a
    // standalone install has neither that checkout nor the npm package.
    const loadable = (await getAvailableExtensions()).find((entry) => entry.name === 'citation-verifier')!.available;
    const warnings: string[] = [];
    const manifest = await createCuratedManifest({
      channels: 'none',
      tools: ['citation-verifier'],
      voice: 'none',
      productivity: 'none',
      cloud: 'none',
      domains: 'none',
      logger: { warn: (...args: unknown[]) => warnings.push(args.join(' ')) },
    });

    const registered = manifest.packs.some((pack) => pack.identifier === 'registry:citation-verifier');
    expect(registered).toBe(loadable);
    if (!loadable) {
      expect(warnings.join('\n')).toContain('@framers/agentos-ext-citation-verifier');
    }

    // Before this rule the manifest carried a factory that threw on activation.
    const manager = new ExtensionManager({ manifest });
    await manager.loadManifest();
    const active = manager.getRegistry<any>(EXTENSION_KIND_TOOL).listActive() as Array<{ id: string }>;
    expect(active.some((entry) => entry.id === 'verify_citations')).toBe(loadable);
  });
});
