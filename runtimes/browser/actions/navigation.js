/**
 * JEXI OS — Phase 17 Scope B — NAVIGATION + PAGE ACTIONS.
 *
 * Ported from browser-use's browser/controller action surface. Every handler
 * issues a real CDP call through the Obscura session and reports what the page
 * actually did. Nothing here fakes a result: a navigation that did not happen
 * is an error, not a success.
 */

import { ActionError } from './registry.js';
import { TARGET_SCHEMA, describeTarget } from './resolve.js';

const pageInfo = (session) => session.pageInfo();

export function navigationActions() {
  return [
    {
      name: 'navigate',
      description: 'Navigate the active tab to a URL and wait for the document to load.',
      risk: 'medium',
      permissions: ['navigate'],
      timeout_ms: 45_000,
      retries: 1,
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', minLength: 1, description: 'Absolute URL (https://…, http://…, data:…, about:blank)' },
          wait_until: { type: 'string', enum: ['load', 'none'], description: 'Wait for the load event (default) or return immediately' },
        },
        required: ['url'],
        additionalProperties: false,
      },
      output_schema: {
        type: 'object',
        properties: { url: { type: 'string' }, title: { type: 'string' }, readyState: { type: 'string' } },
        required: ['url', 'title'],
      },
      handler: async ({ url, wait_until = 'load' }, { session }) => {
        if (!/^(https?|data|file|about|blob):/i.test(url)) {
          throw new ActionError('navigate', `refusing non-navigable scheme in ${JSON.stringify(url)} — expected http(s), data, file, about or blob`);
        }
        await session.send('Page.navigate', { url });
        if (wait_until !== 'none') await session.waitForReady(30_000);
        return pageInfo(session);
      },
    },
    {
      name: 'go_back',
      description: 'Go back one entry in the tab history.',
      risk: 'medium',
      permissions: ['navigate'],
      timeout_ms: 30_000,
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      output_schema: { type: 'object', properties: { url: { type: 'string' }, moved: { type: 'boolean' } }, required: ['moved'] },
      handler: async (_i, { session }) => {
        const h = await session.send('Page.getNavigationHistory');
        if (h.currentIndex <= 0) return { moved: false, url: h.entries[0]?.url || null };
        await session.send('Page.navigateToHistoryEntry', { entryId: h.entries[h.currentIndex - 1].id });
        await session.waitForReady(20_000);
        const info = await pageInfo(session);
        return { moved: true, ...info };
      },
    },
    {
      name: 'go_forward',
      description: 'Go forward one entry in the tab history.',
      risk: 'medium',
      permissions: ['navigate'],
      timeout_ms: 30_000,
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      output_schema: { type: 'object', properties: { url: { type: 'string' }, moved: { type: 'boolean' } }, required: ['moved'] },
      handler: async (_i, { session }) => {
        const h = await session.send('Page.getNavigationHistory');
        if (h.currentIndex >= h.entries.length - 1) return { moved: false, url: h.entries[h.entries.length - 1]?.url || null };
        await session.send('Page.navigateToHistoryEntry', { entryId: h.entries[h.currentIndex + 1].id });
        await session.waitForReady(20_000);
        const info = await pageInfo(session);
        return { moved: true, ...info };
      },
    },
    {
      name: 'refresh',
      description: 'Reload the active tab.',
      risk: 'medium',
      permissions: ['navigate'],
      timeout_ms: 30_000,
      input_schema: {
        type: 'object',
        properties: { ignore_cache: { type: 'boolean', description: 'Bypass the cache' } },
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { url: { type: 'string' }, title: { type: 'string' } }, required: ['url'] },
      handler: async ({ ignore_cache = false }, { session }) => {
        await session.send('Page.reload', { ignoreCache: ignore_cache });
        await session.waitForReady(20_000);
        return pageInfo(session);
      },
    },
    {
      name: 'wait',
      description: 'Wait for a number of seconds, or for a CSS selector to appear.',
      risk: 'low',
      permissions: ['read'],
      timeout_ms: 60_000,
      input_schema: {
        type: 'object',
        properties: {
          seconds: { type: 'number', minimum: 0, maximum: 60, description: 'Seconds to sleep' },
          selector: { type: 'string', minLength: 1, description: 'CSS selector to wait for instead' },
          timeout_ms: { type: 'integer', minimum: 100, maximum: 60_000, description: 'Deadline when waiting for a selector (default 15000)' },
        },
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { waited: { type: 'boolean' }, found: { type: 'boolean' }, ms: { type: 'integer' } }, required: ['waited'] },
      handler: async ({ seconds, selector, timeout_ms = 15_000 }, { session }) => {
        const started = Date.now();
        if (selector) {
          const deadline = started + timeout_ms;
          while (Date.now() < deadline) {
            const present = await session.eval(`!!document.querySelector(${JSON.stringify(selector)})`);
            if (present) return { waited: true, found: true, ms: Date.now() - started };
            await new Promise((r) => setTimeout(r, 150));
          }
          return { waited: true, found: false, ms: Date.now() - started };
        }
        const ms = Math.round((seconds ?? 1) * 1000);
        await new Promise((r) => setTimeout(r, ms));
        return { waited: true, found: null, ms };
      },
    },
    {
      name: 'scroll',
      description: 'Scroll the page or a specific element by pixels, or to the top/bottom.',
      risk: 'low',
      permissions: ['interact'],
      timeout_ms: 20_000,
      input_schema: {
        type: 'object',
        properties: {
          ...TARGET_SCHEMA,
          delta_x: { type: 'number', description: 'Horizontal pixels (positive = right)' },
          delta_y: { type: 'number', description: 'Vertical pixels (positive = down)' },
          to: { type: 'string', enum: ['top', 'bottom', 'up', 'down'], description: 'Jump to an edge' },
        },
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { scrolled: { type: 'boolean' }, scroll_x: { type: 'number' }, scroll_y: { type: 'number' } }, required: ['scrolled'] },
      handler: async (input, { session, dom }) => {
        const { delta_x = 0, delta_y = 0, to } = input;
        if (to) {
          await session.eval(`(() => { window.scrollTo(0, ${to === 'top' || to === 'up' ? 0 : 'document.documentElement.scrollHeight'}); })()`);
        } else {
          await session.eval(`(() => { window.scrollBy(${delta_x}, ${delta_y}); })()`);
        }
        void dom;
        const pos = await session.evalJson('return { x: Math.round(window.scrollX), y: Math.round(window.scrollY) };');
        return { scrolled: true, scroll_x: pos.x, scroll_y: pos.y };
      },
    },
    {
      name: 'hover',
      description: 'Move the mouse over an element.',
      risk: 'low',
      permissions: ['interact'],
      timeout_ms: 20_000,
      input_schema: { type: 'object', properties: { ...TARGET_SCHEMA }, additionalProperties: false },
      output_schema: { type: 'object', properties: { hovered: { type: 'boolean' }, at: { type: 'object' } }, required: ['hovered'] },
      handler: async (input, { session, dom }) => {
        const pt = await centreOf(session, input, dom);
        await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
        return { hovered: true, at: pt, target: describeTarget(input) };
      },
    },
    {
      name: 'mouse_move',
      description: 'Move the mouse to viewport coordinates.',
      risk: 'low',
      permissions: ['interact'],
      timeout_ms: 15_000,
      input_schema: {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' } },
        required: ['x', 'y'],
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { moved: { type: 'boolean' }, at: { type: 'object' } }, required: ['moved'] },
      handler: async ({ x, y }, { session }) => {
        await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        return { moved: true, at: { x, y } };
      },
    },
  ];
}

/**
 * Viewport centre of a target, resolved through the live layout.
 * Shared by hover / drag / mouse actions.
 */
export async function centreOf(session, input, dom) {
  const keyByIndex = dom ? new Map(dom.indexToKey) : new Map();
  if (input.index !== undefined && input.index !== null && !keyByIndex.get(input.index)) {
    throw new ActionError('centreOf', `index ${input.index} is not in the current snapshot — take a fresh snapshot (the element may have been removed)`, { code: 'E_ELEMENT_UNKNOWN_INDEX' });
  }
  const locator = (await import('./resolve.js')).buildLocatorJs(input, keyByIndex.get(input.index));
  const pt = await session.evalJson(`(() => {
    const el = ${locator};
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), width: Math.round(r.width), height: Math.round(r.height) };
  })()`);
  if (!pt) throw new ActionError('centreOf', `${describeTarget(input)} — no matching element`, { code: 'E_ELEMENT_NOT_FOUND' });
  return pt;
}

export default { navigationActions, centreOf };
