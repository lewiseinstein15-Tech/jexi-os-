/**
 * JEXI OS — Phase 17 Scope B — EXTRACTION, EVAL AND DOM-MUTATION ACTIONS.
 *
 * Reading the page (text, HTML, attributes, screenshot, links) and changing the
 * DOM (set attribute, remove element, insert HTML, eval JS).
 *
 * `eval_js` and the DOM-mutation actions are the sharp edge of the registry:
 * they can run arbitrary page JavaScript. They are gated behind the `eval` and
 * `write` permissions, marked `medium` risk, and never granted by the default
 * permission set — a caller has to ask for them explicitly.
 *
 * `solve_captcha` is deliberately ABSENT. See the note at the bottom of this
 * file for why it is not simply unimplemented but intentionally refused.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ActionError } from './registry.js';
import { TARGET_SCHEMA, describeTarget, buildLocatorJs } from './resolve.js';

function locatorFor(input, dom) {
  return buildLocatorJs(input, dom?.indexToKey?.get(input.index));
}

/** Guard: keep screenshot/HTML writes inside the runtime's output directory. */
function safeOutputPath(filePath, outputDir) {
  const resolved = path.resolve(filePath);
  const base = path.resolve(outputDir);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new ActionError('screenshot', `refusing to write outside the output directory — ${resolved} is not under ${base}`);
  }
  return resolved;
}

export function extractionActions() {
  return [
    {
      name: 'get_text',
      description: 'Read the visible text of the page, or of one element.',
      risk: 'low',
      permissions: ['read'],
      timeout_ms: 20_000,
      input_schema: {
        type: 'object',
        properties: {
          ...TARGET_SCHEMA,
          max_chars: { type: 'integer', minimum: 1, maximum: 200_000, description: 'Truncate the result (default 20000)' },
        },
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { text: { type: 'string' }, length: { type: 'integer' } }, required: ['text'] },
      handler: async (input, { session, dom }) => {
        const hasTarget = input.index !== undefined || input.selector || input.xpath || input.text;
        const limit = input.max_chars ?? 20_000;
        let text;
        if (hasTarget) {
          text = await session.eval(`(() => {
            const el = ${locatorFor(input, dom)};
            return el ? (el.innerText !== undefined ? el.innerText : el.textContent) : null;
          })()`);
          if (text === null) throw new ActionError('get_text', `${describeTarget(input)} — no matching element`, { code: 'E_ELEMENT_NOT_FOUND' });
        } else {
          text = await session.eval('document.body ? document.body.innerText : ""');
        }
        const str = String(text ?? '');
        return { text: str.slice(0, limit), length: str.length, truncated: str.length > limit, target: hasTarget ? describeTarget(input) : 'body' };
      },
    },
    {
      name: 'get_html',
      description: 'Read the HTML of the page or of one element.',
      risk: 'low',
      permissions: ['read'],
      timeout_ms: 20_000,
      input_schema: {
        type: 'object',
        properties: {
          ...TARGET_SCHEMA,
          outer: { type: 'boolean', description: 'Include the element itself (default true)' },
          max_chars: { type: 'integer', minimum: 1, maximum: 500_000 },
        },
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { html: { type: 'string' }, length: { type: 'integer' } }, required: ['html'] },
      handler: async (input, { session, dom }) => {
        const hasTarget = input.index !== undefined || input.selector || input.xpath || input.text;
        const limit = input.max_chars ?? 100_000;
        const prop = input.outer === false ? 'innerHTML' : 'outerHTML';
        let html;
        if (hasTarget) {
          html = await session.eval(`(() => { const el = ${locatorFor(input, dom)}; return el ? el.${prop} : null; })()`);
          if (html === null) throw new ActionError('get_html', `${describeTarget(input)} — no matching element`, { code: 'E_ELEMENT_NOT_FOUND' });
        } else {
          html = await session.eval('document.documentElement.outerHTML');
        }
        const str = String(html ?? '');
        return { html: str.slice(0, limit), length: str.length, truncated: str.length > limit };
      },
    },
    {
      name: 'get_attributes',
      description: 'Read all attributes of an element.',
      risk: 'low',
      permissions: ['read'],
      timeout_ms: 15_000,
      input_schema: { type: 'object', properties: { ...TARGET_SCHEMA }, additionalProperties: false },
      output_schema: { type: 'object', properties: { attributes: { type: 'object' }, tag: { type: 'string' } }, required: ['attributes'] },
      handler: async (input, { session, dom }) => {
        const r = await session.evalJson(`(() => {
          const el = ${locatorFor(input, dom)};
          if (!el) return null;
          const out = {};
          for (const a of el.attributes) out[a.name] = a.value;
          return { tag: el.tagName.toLowerCase(), attributes: out };
        })()`);
        if (!r) throw new ActionError('get_attributes', `${describeTarget(input)} — no matching element`, { code: 'E_ELEMENT_NOT_FOUND' });
        return r;
      },
    },
    {
      name: 'get_value',
      description: 'Read the current value of a form field.',
      risk: 'low',
      permissions: ['read'],
      timeout_ms: 15_000,
      input_schema: { type: 'object', properties: { ...TARGET_SCHEMA }, additionalProperties: false },
      output_schema: { type: 'object', properties: { value: { type: 'string' }, checked: { type: 'boolean' } }, required: ['value'] },
      handler: async (input, { session, dom }) => {
        const r = await session.evalJson(`(() => {
          const el = ${locatorFor(input, dom)};
          if (!el) return null;
          if (el.type === 'password') return { value: '(redacted)', checked: null, redacted: true };
          const v = el.value !== undefined ? String(el.value) : (el.textContent || '');
          return { value: v, checked: el.checked === undefined ? null : !!el.checked };
        })()`);
        if (!r) throw new ActionError('get_value', `${describeTarget(input)} — no matching element`, { code: 'E_ELEMENT_NOT_FOUND' });
        return r;
      },
    },
    {
      name: 'extract_links',
      description: 'List the links on the page with their text and href.',
      risk: 'low',
      permissions: ['read'],
      timeout_ms: 20_000,
      input_schema: {
        type: 'object',
        properties: { max_links: { type: 'integer', minimum: 1, maximum: 2000, description: 'Cap the result (default 200)' } },
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { count: { type: 'integer' }, links: { type: 'array' } }, required: ['count', 'links'] },
      handler: async ({ max_links = 200 }, { session }) => {
        const links = await session.evalJson(`(() => [...document.querySelectorAll('a[href]')].slice(0, ${max_links}).map((a) => ({
          text: (a.innerText || a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
          href: a.href,
          absolute: a.href,
        })))()`);
        return { count: links.length, links, url: await session.eval('location.href') };
      },
    },
    {
      name: 'screenshot',
      description: 'Capture a PNG screenshot of the page or a single element.',
      risk: 'low',
      permissions: ['read'],
      timeout_ms: 30_000,
      input_schema: {
        type: 'object',
        properties: {
          ...TARGET_SCHEMA,
          path: { type: 'string', description: 'Absolute path to write (must be inside the output directory)' },
          full_page: { type: 'boolean', description: 'Capture the whole scrollable page' },
          format: { type: 'string', enum: ['png', 'jpeg'], description: 'Image format (default png)' },
          quality: { type: 'integer', minimum: 1, maximum: 100, description: 'JPEG quality' },
        },
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { bytes: { type: 'integer' }, format: { type: 'string' } }, required: ['bytes'] },
      handler: async (input, { session, dom }) => {
        const hasTarget = input.index !== undefined || input.selector || input.xpath || input.text;
        const params = { format: input.format || 'png', captureBeyondViewport: input.full_page === true };
        if (input.quality && (input.format === 'jpeg')) params.quality = input.quality;
        if (hasTarget) {
          const box = await session.evalJson(`(() => {
            const el = ${locatorFor(input, dom)};
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), sx: window.scrollX, sy: window.scrollY };
          })()`);
          if (!box) throw new ActionError('screenshot', `${describeTarget(input)} — no matching element`, { code: 'E_ELEMENT_NOT_FOUND' });
          params.clip = { x: box.x + box.sx, y: box.y + box.sy, width: Math.max(1, box.width), height: Math.max(1, box.height), scale: 1 };
        }
        const r = await session.send('Page.captureScreenshot', params);
        const data = r.data;
        if (!data) throw new ActionError('screenshot', 'the engine returned no image data');
        const buffer = Buffer.from(data, 'base64');
        let written = null;
        if (input.path) {
          const outputDir = process.env.JEXI_OUTPUT_DIR || path.join(process.cwd(), 'output');
          const target = safeOutputPath(input.path, outputDir);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, buffer);
          written = target;
        }
        return { bytes: buffer.length, format: params.format, path: written, base64_prefix: written ? null : data.slice(0, 64), target: hasTarget ? describeTarget(input) : 'viewport' };
      },
    },
    {
      name: 'eval_js',
      description: 'Evaluate JavaScript in the page and return its value. Requires the eval permission.',
      risk: 'medium',
      permissions: ['eval'],
      timeout_ms: 30_000,
      input_schema: {
        type: 'object',
        properties: {
          expression: { type: 'string', minLength: 1, description: 'Expression or IIFE. Use an IIFE returning a JSON-serialisable value.' },
          timeout_ms: { type: 'integer', minimum: 100, maximum: 30_000 },
        },
        required: ['expression'],
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { result: { type: 'object' }, type: { type: 'string' } }, required: ['type'] },
      handler: async ({ expression, timeout_ms = 30_000 }, { session }) => {
        const raw = await session.send('Runtime.evaluate', {
          expression, awaitPromise: true, returnByValue: true, timeout: timeout_ms,
        });
        if (raw.exceptionDetails) {
          throw new ActionError('eval_js', `page threw — ${raw.exceptionDetails.exception?.description || raw.exceptionDetails.text}`, { code: 'E_PAGE_EXCEPTION' });
        }
        const res = raw.result ?? {};
        return { type: res.type || 'undefined', result: res.value === undefined ? { unserialisable: true, description: res.description || null } : res.value };
      },
    },
  ];
}

export function domMutationActions() {
  return [
    {
      name: 'set_attribute',
      description: 'Set an attribute on an element.',
      risk: 'medium',
      permissions: ['write'],
      timeout_ms: 15_000,
      input_schema: {
        type: 'object',
        properties: { ...TARGET_SCHEMA, name: { type: 'string', minLength: 1 }, attr_value: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { set: { type: 'boolean' }, value: { type: 'string' } }, required: ['set'] },
      handler: async (input, { session, dom }) => {
        const r = await session.eval(`(() => {
          const el = ${locatorFor(input, dom)};
          if (!el) return null;
          el.setAttribute(${JSON.stringify(input.name)}, ${JSON.stringify(input.attr_value ?? '')});
          return el.getAttribute(${JSON.stringify(input.name)});
        })()`);
        if (r === null) throw new ActionError('set_attribute', `${describeTarget(input)} — no matching element`, { code: 'E_ELEMENT_NOT_FOUND' });
        return { set: true, name: input.name, value: String(r) };
      },
    },
    {
      name: 'remove_attribute',
      description: 'Remove an attribute from an element.',
      risk: 'medium',
      permissions: ['write'],
      timeout_ms: 15_000,
      input_schema: {
        type: 'object',
        properties: { ...TARGET_SCHEMA, name: { type: 'string', minLength: 1 } },
        required: ['name'],
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { removed: { type: 'boolean' } }, required: ['removed'] },
      handler: async (input, { session, dom }) => {
        const r = await session.eval(`(() => {
          const el = ${locatorFor(input, dom)};
          if (!el) return null;
          el.removeAttribute(${JSON.stringify(input.name)});
          return !el.hasAttribute(${JSON.stringify(input.name)});
        })()`);
        if (r === null) throw new ActionError('remove_attribute', `${describeTarget(input)} — no matching element`, { code: 'E_ELEMENT_NOT_FOUND' });
        return { removed: !!r, name: input.name };
      },
    },
    {
      name: 'insert_html',
      description: 'Insert HTML relative to an element (or into the body when no target is given).',
      risk: 'medium',
      permissions: ['write'],
      timeout_ms: 15_000,
      input_schema: {
        type: 'object',
        properties: {
          ...TARGET_SCHEMA,
          html: { type: 'string', minLength: 1 },
          position: { type: 'string', enum: ['beforebegin', 'afterbegin', 'beforeend', 'afterend'], description: 'Where to insert relative to the element (default beforeend)' },
        },
        required: ['html'],
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { inserted: { type: 'boolean' } }, required: ['inserted'] },
      handler: async (input, { session, dom }) => {
        const position = input.position || 'beforeend';
        const hasTarget = input.index !== undefined || input.selector || input.xpath || input.text;
        const r = await session.eval(`(() => {
          const html = ${JSON.stringify(input.html)};
          if (!${hasTarget}) { document.body.insertAdjacentHTML('beforeend', html); return 'body'; }
          const el = ${locatorFor(input, dom)};
          if (!el) return null;
          el.insertAdjacentHTML(${JSON.stringify(position)}, html);
          return 'element';
        })()`);
        if (r === null) throw new ActionError('insert_html', `${describeTarget(input)} — no matching element`, { code: 'E_ELEMENT_NOT_FOUND' });
        return { inserted: true, into: r, position };
      },
    },
    {
      name: 'remove_element',
      description: 'Remove an element from the DOM.',
      risk: 'medium',
      permissions: ['write'],
      timeout_ms: 15_000,
      input_schema: { type: 'object', properties: { ...TARGET_SCHEMA }, additionalProperties: false },
      output_schema: { type: 'object', properties: { removed: { type: 'boolean' }, tag: { type: 'string' } }, required: ['removed'] },
      handler: async (input, { session, dom }) => {
        const r = await session.eval(`(() => {
          const el = ${locatorFor(input, dom)};
          if (!el) return null;
          const tag = el.tagName.toLowerCase();
          el.remove();
          return tag;
        })()`);
        if (r === null) throw new ActionError('remove_element', `${describeTarget(input)} — no matching element`, { code: 'E_ELEMENT_NOT_FOUND' });
        return { removed: true, tag: r };
      },
    },
    {
      name: 'scroll_into_view',
      description: 'Alias of scroll_element: bring an element into the viewport.',
      risk: 'low',
      permissions: ['interact'],
      timeout_ms: 15_000,
      input_schema: { type: 'object', properties: { ...TARGET_SCHEMA }, additionalProperties: false },
      output_schema: { type: 'object', properties: { scrolled: { type: 'boolean' } }, required: ['scrolled'] },
      handler: async (input, { session, dom }) => {
        const r = await session.evalJson(`(() => {
          const el = ${locatorFor(input, dom)};
          if (!el) return null;
          el.scrollIntoView({ block: 'center', inline: 'center' });
          const b = el.getBoundingClientRect();
          return { in_view: b.top >= 0 && b.left >= 0 && b.bottom <= innerHeight && b.right <= innerWidth };
        })()`);
        if (!r) throw new ActionError('scroll_into_view', `${describeTarget(input)} — no matching element`, { code: 'E_ELEMENT_NOT_FOUND' });
        return { scrolled: true, in_view: r.in_view };
      },
    },
    {
      name: 'set_viewport',
      description: 'Resize the emulated viewport.',
      risk: 'medium',
      permissions: ['write'],
      timeout_ms: 15_000,
      input_schema: {
        type: 'object',
        properties: {
          width: { type: 'integer', minimum: 100, maximum: 10000 },
          height: { type: 'integer', minimum: 100, maximum: 10000 },
          device_scale_factor: { type: 'number', minimum: 0.1, maximum: 10 },
          mobile: { type: 'boolean' },
        },
        required: ['width', 'height'],
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { width: { type: 'integer' }, height: { type: 'integer' } }, required: ['width', 'height'] },
      handler: async ({ width, height, device_scale_factor = 1, mobile = false }, { session }) => {
        await session.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: device_scale_factor, mobile });
        return { width, height, device_scale_factor, mobile };
      },
    },
    {
      name: 'set_user_agent',
      description: 'Override the User-Agent for the current session.',
      risk: 'medium',
      permissions: ['write'],
      timeout_ms: 15_000,
      input_schema: { type: 'object', properties: { user_agent: { type: 'string', minLength: 1 } }, required: ['user_agent'], additionalProperties: false },
      output_schema: { type: 'object', properties: { applied: { type: 'boolean' }, user_agent: { type: 'string' } }, required: ['applied', 'user_agent'] },
      handler: async ({ user_agent }, { session }) => {
        try {
          await session.send('Emulation.setUserAgentOverride', { userAgent: user_agent });
        } catch (e) {
          throw new ActionError('set_user_agent', `the engine refused the override — ${e.message}`, { code: 'E_ENGINE_UNSUPPORTED' });
        }
        const actual = await session.eval('navigator.userAgent');
        return { applied: actual === user_agent, user_agent: actual };
      },
    },
    {
      name: 'get_page_info',
      description: 'Read the current URL, title, ready state and viewport size.',
      risk: 'low',
      permissions: ['read'],
      timeout_ms: 15_000,
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      output_schema: { type: 'object', properties: { url: { type: 'string' }, title: { type: 'string' } }, required: ['url', 'title'] },
      handler: async (_i, { session }) => {
        const info = await session.pageInfo();
        const vp = await session.evalJson('return { width: innerWidth, height: innerHeight, scrollY: Math.round(scrollY), scrollHeight: document.documentElement.scrollHeight };');
        return { ...info, viewport: vp };
      },
    },
    {
      name: 'set_network_throttle',
      description: 'Enable the Network domain so requests are observable (Obscura has no bandwidth throttling).',
      risk: 'low',
      permissions: ['read'],
      timeout_ms: 15_000,
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      output_schema: { type: 'object', properties: { network_enabled: { type: 'boolean' }, throttling_available: { type: 'boolean' } }, required: ['network_enabled'] },
      handler: async (_i, { session }) => {
        await session.enable('Network');
        return {
          network_enabled: session.enabled.has('Network'),
          throttling_available: false,
          note: 'Obscura exposes Network.enable but not Network.emulateNetworkConditions, so bandwidth throttling is unavailable; this action only turns request observation on',
        };
      },
    },
  ];
}

/*
 * ── ON THE ABSENCE OF A CAPTCHA ACTION ─────────────────────────────────────
 * browser-use ships `solve_captcha`, which posts a screenshot to a commercial
 * CAPTCHA-solving service. That action is NOT ported, and not because of an
 * engine limitation.
 *
 * server/src/services/BrowserRouter.js refuses CAPTCHA and bot-challenge
 * handling as policy: JEXI does not defeat anti-bot systems. Porting
 * solve_captcha would route around that refusal — the registry would become
 * the policy hole the browser service deliberately closed. Obscura's stealth
 * is fingerprint CONSISTENCY, which is a different thing from challenge defeat;
 * scope A's stealth.js states this boundary explicitly.
 *
 * The registry makes the same boundary enforceable: any action that would do
 * this must be declared `risk: 'high'`, and high-risk actions are refused
 * unless the caller sets allowHighRisk. No such action is registered here.
 */

export default { extractionActions, domMutationActions };
