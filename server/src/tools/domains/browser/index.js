/**
 * JEXI OS — tools — browser domain.
 *
 * navigate, click, type, extract — browser automation. Executors are injected; definitions are always registered so the
 * capability surface stays stable and provider-independent.
 *
 * DOMAIN ENGINE: DesktopManager (the permanent real-browser runtime adopted in
 * Phase 4 Scope E). The engines below drive the shared Chromium instance
 * through DesktopManager (agent-scoped tabs) for navigate/click/type/extract.
 * DesktopManager is a singleton engine (one shared browser; agents use named
 * tabs), so every engine call routes through the same `dm` instance.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';
import { DesktopManager, ensureBrowser } from '../../../services/DesktopManager.js';

const AGENT = 'browser-domain'; // named tab/agent inside DesktopManager
const dm = new DesktopManager('playwright');

export function registerBrowserTools() {
  const defs = [
    defineTool({ name: 'nav_navigate', description: 'Open a URL in the real browser and report the resulting title + page text.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }, sideEffects: ['nav'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'nav_click', description: 'Click the numbered interactive element on the live page.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { index: { type: 'integer', minimum: 1 } }, required: ['index'] }, sideEffects: ['nav'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'nav_type', description: 'Type text into the numbered input on the live page.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { index: { type: 'integer', minimum: 1 }, text: { type: 'string' } }, required: ['index', 'text'] }, sideEffects: ['nav'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'nav_extract', description: 'Extract the current page text (visible content) from the live browser.', riskLevel: 'medium', runtimeRing: 2, parameters: { type: 'object', properties: { }, required: [] }, sideEffects: [], failureTypes: ['tool_error'], idempotent: true })
  ];
  const unreg = registerToolBatch(defs);
  const engines = {
    nav_navigate: async ({ url }) => {
      const ready = await ensureBrowser();
      if (!ready.ok) return { ok: false, error: `browser unavailable: ${ready.error}` };
      const r = await dm.goto(AGENT, url);
      const text = await dm.pageText(AGENT).catch(() => '');
      return { ok: true, url: r.url, title: r.title, text: String(text).slice(0, 2000) };
    },
    nav_click: async ({ index }) => {
      const ready = await ensureBrowser();
      if (!ready.ok) return { ok: false, error: `browser unavailable: ${ready.error}` };
      await dm.clickIndex(AGENT, index);
      const text = await dm.pageText(AGENT).catch(() => '');
      return { ok: true, clicked: index, text: String(text).slice(0, 2000) };
    },
    nav_type: async ({ index, text }) => {
      const ready = await ensureBrowser();
      if (!ready.ok) return { ok: false, error: `browser unavailable: ${ready.error}` };
      await dm.typeIndex(AGENT, index, text);
      return { ok: true, typedInto: index, text };
    },
    nav_extract: async () => {
      const ready = await ensureBrowser();
      if (!ready.ok) return { ok: false, error: `browser unavailable: ${ready.error}` };
      const text = await dm.pageText(AGENT).catch(() => '');
      return { ok: true, text: String(text).slice(0, 6000) };
    }
  };
  return { unreg, engines };
}
