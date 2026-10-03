import { describe, expect, it } from 'vitest';

import { CAPABILITY_CATALOG } from '../src/capability-catalog';
import { createCuratedManifest } from '../src/index';
import { getSecretEnvVar } from '../src/secret-env-map';
import { TOOL_CATALOG } from '../src/tool-registry';

/** Loads only the tool group so the assertions do not depend on other categories. */
function toolsOnly(tools: string[] | 'all') {
  return createCuratedManifest({
    channels: 'none',
    voice: 'none',
    productivity: 'none',
    cloud: 'none',
    domains: 'none',
    tools,
    logger: {},
  });
}

describe('committed capability catalog', () => {
  it('holds the curated entries, including the research packs', () => {
    expect(CAPABILITY_CATALOG.length).toBeGreaterThanOrEqual(100);
    const ids = new Set(CAPABILITY_CATALOG.map((entry) => entry.id));
    expect(ids.has('com.framers.research.web-search')).toBe(true);
    expect(ids.has('com.framers.research.deep-research')).toBe(true);
    expect(ids.has('com.framers.research.content-extraction')).toBe(true);
  });
});

describe('research-category catalog entries', () => {
  it('load when they are named in tools', async () => {
    const manifest = await toolsOnly(['citation-verifier']);
    const identifiers = manifest.packs.map((pack: any) => pack.identifier);
    expect(identifiers).toContain('registry:citation-verifier');
  });

  it('are not part of tools: all', async () => {
    const manifest = await toolsOnly('all');
    const identifiers = manifest.packs.map((pack: any) => pack.identifier);
    expect(identifiers).not.toContain('registry:citation-verifier');
    expect(identifiers).not.toContain('registry:trulia-search');
  });
});

describe('secret map', () => {
  it('maps the search, rerank and SMS secrets to their environment variables', () => {
    expect(getSecretEnvVar('tavily.apiKey')).toBe('TAVILY_API_KEY');
    expect(getSecretEnvVar('firecrawl.apiKey')).toBe('FIRECRAWL_API_KEY');
    expect(getSecretEnvVar('serpapi.apiKey')).toBe('SERPAPI_API_KEY');
    expect(getSecretEnvVar('cohere.apiKey')).toBe('COHERE_API_KEY');
    expect(getSecretEnvVar('twilio.phoneNumber')).toBe('TWILIO_PHONE_NUMBER');
  });
});

describe('web-search catalog entry', () => {
  it('lists every environment variable the pack reads', () => {
    const entry = TOOL_CATALOG.find((tool) => tool.name === 'web-search');
    expect(entry?.envVars).toEqual(
      expect.arrayContaining(['SERPER_API_KEY', 'BRAVE_API_KEY', 'TAVILY_API_KEY', 'FIRECRAWL_API_KEY', 'SERPAPI_API_KEY']),
    );
  });
});
