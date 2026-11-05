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
import { EXTENSION_KIND_GUARDRAIL, EXTENSION_KIND_TOOL, ExtensionManager } from '@framers/agentos/extensions';
import { TOOL_CATALOG } from '../src/tool-registry';

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

  it('loads the self-harm referral guard by name, and the pack it builds answers a person with the referral', async () => {
    const warnings: string[] = [];
    const manifest = await createCuratedManifest({
      channels: 'none',
      tools: ['self-harm-referral'],
      voice: 'none',
      productivity: 'none',
      cloud: 'none',
      domains: 'none',
      logger: { warn: (line: string) => void warnings.push(line) },
    });

    expect(manifest.packs.map((pack) => pack.identifier)).toEqual(['registry:self-harm-referral']);
    expect(warnings).toEqual([]);

    const manager = new ExtensionManager({ manifest });
    await manager.loadManifest();
    const active = manager.getRegistry<any>(EXTENSION_KIND_GUARDRAIL).listActive() as Array<{ id: string; payload: any }>;
    const guard = active.find((entry) => entry.id === 'self-harm-referral')?.payload;
    expect(guard, `active guards: ${active.map((entry) => entry.id).join(', ')}`).toBeDefined();
    // AgentOS runs a guard with canSanitize in its first phase, where a BLOCK ends the evaluation; from 0.1.1 the guard
    // runs there, so no classifier can take the answer from the referral.
    expect(guard.config.canSanitize).toBe(true);

    const verdict = await guard.evaluateInput({
      input: { userId: 'user-1', sessionId: 'session-1', textInput: 'I want to die' },
      context: { userId: 'user-1', sessionId: 'session-1' },
    });
    expect(verdict.action).toBe('block');
    expect(verdict.reasonCode).toBe('SELF_HARM_REFERRAL');
    expect(verdict.replacementText).toContain('988');
  });

  it('registers the self-harm referral guard before the other guards the catalog names, so a person gets the lines first', () => {
    const position = (name: string) => TOOL_CATALOG.findIndex((entry) => entry.name === name);
    expect(position('self-harm-referral')).toBeGreaterThanOrEqual(0);
    for (const other of ['pii-redaction', 'ml-classifiers', 'topicality', 'code-safety', 'grounding-guard', 'content-policy-rewriter']) {
      expect(position('self-harm-referral'), other).toBeLessThan(position(other));
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
