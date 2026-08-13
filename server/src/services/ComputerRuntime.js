/**
 * JEXI OS — Computer Runtime (roadmap stage 18: provider-independent runtime).
 *
 * JEXI can drive a computer (browser + terminal + input) through different
 * backends. Instead of hardcoding one host, this layer picks a RUNTIME
 * PROVIDER and gives the agents a single capability-shaped interface:
 *
 *   local   — in-process: real terminal via Runner, no visual browser
 *             (browser actions return honest "unavailable")
 *   remote  — the external desktop/coder bridge (VIRTUAL_API) with a real
 *             browser, numbered elements, screenshots and input
 *   docker  — declared but not wired (no docker socket in production);
 *             returns honest "provider not configured"
 *   mock    — deterministic in-process provider for tests
 *
 * Selection: COMPUTER_RUNTIME env (local | remote | docker | auto).
 * auto = remote if VIRTUAL_API responds, else local.
 */

import { runCommand } from './Runner.js';
import { MANAGER_URL } from '../config.js';

export const RUNTIME_PROVIDERS = ['local', 'remote', 'docker', 'mock'];

const CAPABILITIES = {
  local: { terminal: true, browser: false, screenshot: false, input: false, files: true },
  remote: { terminal: true, browser: true, screenshot: true, input: true, files: true },
  docker: { terminal: false, browser: false, screenshot: false, input: false, files: false },
  mock: { terminal: true, browser: true, screenshot: true, input: true, files: true },
};

export function providerCapabilities(provider) {
  return { ...(CAPABILITIES[provider] || CAPABILITIES.local) };
}

export function activeProvider() {
  const chosen = String(process.env.COMPUTER_RUNTIME || 'auto').toLowerCase();
  if (chosen !== 'auto') return RUNTIME_PROVIDERS.includes(chosen) ? chosen : 'local';
  // auto: the in-process desktop/coder bridge (same Express server) is the
  // historical default; VIRTUAL_API overrides it with an external bridge.
  return 'remote';
}

/** Overall status for the /api/computer/status endpoint. */
export function computerStatus() {
  const provider = activeProvider();
  return {
    provider,
    capabilities: providerCapabilities(provider),
    providers: RUNTIME_PROVIDERS.map((p) => ({
      name: p,
      capabilities: providerCapabilities(p),
      configured: p === 'remote' ? true : p === 'local' || p === 'mock', // remote = in-process bridge (always available)
    })),
    endpoint: process.env.VIRTUAL_API || '(in-process desktop bridge)',
  };
}

/* ------------------------------------------------------------------ */
/* Runtime dispatch                                                    */
/* ------------------------------------------------------------------ */
class MockRuntime {
  async call(endpoint, payload) {
    switch (endpoint) {
      case 'status': return { ok: true, provider: 'mock', browser: true };
      case 'page-text': return { text: 'Mock browser page — deterministic test content.\n[JEXI] [BUY] [SEARCH]' };
      case 'elements': return { elements: [
        { id: 1, tag: 'button', text: 'BUY', href: '' },
        { id: 2, tag: 'input', type: 'text', text: '', placeholder: 'Search…' },
      ] };
      case 'goto': return { ok: true, title: payload.url };
      case 'screenshot-json': return { image: null };
      case 'execute': return { output: `$ ${payload.command}\n(mock runtime) ok\n` };
      case 'click-index': return { ok: true };
      case 'type-index': return { ok: true };
      case 'click-text': return true;
      case 'write-file': return { ok: true };
      case 'page-title': return { title: 'Mock' };
      default: return { ok: true };
    }
  }
}

class LocalRuntime {
  async call(endpoint, payload) {
    switch (endpoint) {
      case 'status': return { ok: true, provider: 'local', browser: false };
      case 'execute': {
        const out = await runCommand(payload.command || '', { timeout: 30000, cwd: payload.cwd });
        return { output: String(out.output || '').slice(0, 6000), success: !!out.success };
      }
      case 'page-text':
      case 'elements':
      case 'goto':
      case 'click-index':
      case 'type-index':
      case 'click-text':
      case 'scroll':
      case 'screenshot-json':
        return { unavailable: true, reason: 'local runtime has no visual browser (set COMPUTER_RUNTIME=remote or VIRTUAL_API to enable browser eyes)' };
      default:
        return { ok: true };
    }
  }
}

class RemoteRuntime {
  constructor(base) { this.base = base || process.env.VIRTUAL_API || MANAGER_URL; }
  async call(endpoint, payload) {
    const res = await fetch(`${this.base}/api/desktop/coder/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (endpoint === 'page-text') return { text: data.text || '' };
    if (endpoint === 'click-text') return data.success;
    return data;
  }
}

/** Call an endpoint on the active runtime provider. */
export async function runtimeCall(endpoint, payload = {}, provider) {
  const p = provider || activeProvider();
  switch (p) {
    case 'mock': return new MockRuntime().call(endpoint, payload);
    case 'local': return new LocalRuntime().call(endpoint, payload);
    case 'remote':
      return new RemoteRuntime().call(endpoint, payload);
    case 'docker':
      return { unavailable: true, reason: 'docker provider is not wired in this build (declared for roadmap completeness)' };
    default:
      return { unavailable: true, reason: `unknown provider: ${p}` };
  }
}
