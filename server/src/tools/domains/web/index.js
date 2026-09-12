/**
 * JEXI OS — tools — web domain.
 *
 * fetch (URL read) + search. Executors are injected; the definitions are
 * always registered so capability surfaces remain stable.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';

export function registerWebTools() {
  const fetch = defineTool({
    name: 'web_fetch', description: 'Fetch a URL and return its visible text.',
    riskLevel: 'medium', runtimeRing: 2,
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    sideEffects: ['network'], idempotent: true,
    failureTypes: ['network_error', 'http_error'],
  });
  const search = defineTool({
    name: 'web_search', description: 'Search the web and return ranked snippets.',
    riskLevel: 'medium', runtimeRing: 2,
    parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] },
    sideEffects: ['network'], idempotent: true,
    failureTypes: ['network_error'],
  });
  const unreg = registerToolBatch([fetch, search]);

  const engines = {
    web_fetch: async (args) => ({ fetched: false, url: args.url, note: 'web_fetch engine not configured' }),
    web_search: async (args) => ({ results: [], query: args.query }),
  };
  return { unreg, engines };
}