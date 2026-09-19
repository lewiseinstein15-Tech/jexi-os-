/**
 * JEXI OS — Phase 17 Scope B — INTERACTION ACTIONS.
 *
 * Clicking, typing, keys, forms, and mouse gestures — ported from browser-use's
 * controller, implemented against real CDP `Input.*` and `Runtime.evaluate`.
 *
 * ── HOW CLICKS WORK HERE ───────────────────────────────────────────────────
 * Two layers, in order:
 *   1. A real CDP mouse press/release at the element's viewport centre
 *      (`Input.dispatchMouseEvent`). This is what a user does, and it is what
 *      fires pointer/mouse listeners, hover styles and framework handlers.
 *   2. `HTMLElement.click()` as a fallback when the synthetic event reports no
 *      effect and the element is a native control.
 *
 * `--stealth` hides nothing about clicks; Obscura dispatches them natively.
 * Where an element cannot be reached by a real mouse event (zero-size, covered,
 * off-viewport and unscrollable), the action reports which path it used instead
 * of claiming a user-level click happened.
 *
 * ── WHAT IS REFUSED ────────────────────────────────────────────────────────
 * No action here solves, bypasses or farms CAPTCHAs or bot-management
 * challenges. `solve_captcha` does not exist. Anything that would amount to
 * challenge defeat is absent by design, matching BrowserRouter policy.
 */

import { ActionError } from './registry.js';
import { TARGET_SCHEMA, describeTarget, buildLocatorJs } from './resolve.js';
import { centreOf } from './navigation.js';

/** Press-and-release a real mouse click at a point. */
async function realClick(session, x, y, { button = 'left', clickCount = 1, modifiers = 0 } = {}) {
  const common = { x, y, button, clickCount, modifiers };
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers });
  await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...common });
  await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...common });
}

/** Modifier bit flags, as CDP defines them. */
export const MODIFIERS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

/** Turn ['ctrl','shift'] into the CDP modifier bitmask. */
export function modifierMask(list = []) {
  return list.reduce((m, k) => m | (MODIFIERS[String(k).toLowerCase()] || 0), 0);
}

/** The locator expression for a target, using the DOM service's key map. */
function locatorFor(input, dom) {
  const key = dom?.indexToKey?.get(input.index);
  return buildLocatorJs(input, key);
}

/**
 * Click a target. Tries a real mouse click first, falls back to the native
 * `.click()` only when the element is unreachable by coordinates, and reports
 * which path was taken.
 */
export async function performClick(session, input, dom, { button = 'left', clickCount = 1, modifiers = [], nativeOnly = false } = {}) {
  const mask = modifierMask(modifiers);
  const locator = locatorFor(input, dom);

  if (!nativeOnly) {
    const pt = await centreOf(session, input, dom);
    if (pt.width > 0 && pt.height > 0) {
      await realClick(session, pt.x, pt.y, { button, clickCount, modifiers: mask });
      return { method: 'mouse', at: pt };
    }
  }

  // Unreachable by coordinates: use the DOM click, and say so.
  const clicked = await session.eval(`(() => {
    const el = ${locator};
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!clicked) {
    throw new ActionError('click', `${describeTarget(input)} — no matching element`, { code: 'E_ELEMENT_NOT_FOUND' });
  }
  return { method: 'dom-click', at: null, note: 'element had no clickable box; dispatched a DOM click instead of a real mouse event' };
}

export function interactionActions() {
  return [
    {
      name: 'click_element',
      description: 'Click an element with a real mouse event (falls back to a DOM click only when the element has no clickable box).',
      risk: 'medium',
      permissions: ['interact'],
      timeout_ms: 20_000,
      retries: 1,
      input_schema: { type: 'object', properties: { ...TARGET_SCHEMA }, additionalProperties: false },
      output_schema: { type: 'object', properties: { clicked: { type: 'boolean' }, method: { type: 'string' }, url: { type: 'string' } }, required: ['clicked', 'method'] },
      handler: async (input, { session, dom }) => {
        const before = await session.eval('location.href');
        const r = await performClick(session, input, dom);
        await session.waitForReady(10_000).catch(() => {});
        const after = await session.eval('location.href');
        return { clicked: true, method: r.method, note: r.note || null, url: after, navigated: before !== after, at: r.at, target: describeTarget(input) };
      },
    },
    {
      name: 'double_click',
      description: 'Double-click an element.',
      risk: 'medium',
      permissions: ['interact'],
      timeout_ms: 20_000,
      input_schema: { type: 'object', properties: { ...TARGET_SCHEMA }, additionalProperties: false },
      output_schema: { type: 'object', properties: { clicked: { type: 'boolean' }, click_count: { type: 'integer' } }, required: ['clicked'] },
      handler: async (input, { session, dom }) => {
        const pt = await centreOf(session, input, dom);
        await realClick(session, pt.x, pt.y, { clickCount: 2 });
        return { clicked: true, click_count: 2, at: pt, target: describeTarget(input) };
      },
    },
    {
      name: 'right_click',
      description: 'Right-click (context menu) an element.',
      risk: 'medium',
      permissions: ['interact'],
      timeout_ms: 20_000,
      input_schema: { type: 'object', properties: { ...TARGET_SCHEMA }, additionalProperties: false },
      output_schema: { type: 'object', properties: { clicked: { type: 'boolean' }, button: { type: 'string' } }, required: ['clicked'] },
      handler: async (input, { session, dom }) => {
        const pt = await centreOf(session, input, dom);
        await realClick(session, pt.x, pt.y, { button: 'right' });
        return { clicked: true, button: 'right', at: pt, target: describeTarget(input) };
      },
    },
    {
      name: 'ctrl_click',
      description: 'Ctrl-click an element (opens in a new tab in most browsers).',
      risk: 'medium',
      permissions: ['interact'],
      timeout_ms: 20_000,
      input_schema: { type: 'object', properties: { ...TARGET_SCHEMA, open_in_new_tab: { type: 'boolean' } }, additionalProperties: false },
      output_schema: { type: 'object', properties: { clicked: { type: 'boolean' }, modifiers: { type: 'array' }, new_tab: { type: 'boolean' } }, required: ['clicked'] },
      handler: async (input, { session, dom }) => {
        const before = await session.client.listTargets();
        const pt = await centreOf(session, input, dom);
        await realClick(session, pt.x, pt.y, { modifiers: MODIFIERS.ctrl });
        await new Promise((r) => setTimeout(r, 700));
        const after = await session.client.listTargets();
        return { clicked: true, modifiers: ['ctrl'], new_tab: after.length > before.length, at: pt, target: describeTarget(input) };
      },
    },
    {
      name: 'shift_click',
      description: 'Shift-click an element (range selection).',
      risk: 'medium',
      permissions: ['interact'],
      timeout_ms: 20_000,
      input_schema: { type: 'object', properties: { ...TARGET_SCHEMA }, additionalProperties: false },
      output_schema: { type: 'object', properties: { clicked: { type: 'boolean' }, modifiers: { type: 'array' } }, required: ['clicked'] },
      handler: async (input, { session, dom }) => {
        const pt = await centreOf(session, input, dom);
        await realClick(session, pt.x, pt.y, { modifiers: MODIFIERS.shift });
        return { clicked: true, modifiers: ['shift'], at: pt, target: describeTarget(input) };
      },
    },
    {
      name: 'type_text',
      description: 'Type text into an element (or the focused element). Fills the field, then fires input and change events.',
      risk: 'medium',
      permissions: ['interact'],
      timeout_ms: 30_000,
      retries: 1,
      input_schema: {
        type: 'object',
        properties: {
          ...TARGET_SCHEMA,
          text: { type: 'string', description: 'Text to enter' },
          clear: { type: 'boolean', description: 'Clear the field first (default true)' },
          press_enter: { type: 'boolean', description: 'Press Enter after typing' },
        },
        required: ['text'],
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { typed: { type: 'boolean' }, value: { type: 'string' }, method: { type: 'string' } }, required: ['typed'] },
      handler: async (input, { session, dom }) => {
        const { text, clear = true } = input;
        const hasTarget = input.index !== undefined || input.selector || input.xpath || input.text;

        if (hasTarget) {
          await performClick(session, input, dom, { nativeOnly: false });
        } else {
          await session.eval('(() => { const el = document.activeElement; if (el && el.blur) el.blur(); })()');
        }

        // Set the value through the prototype setter so React/Vue controlled
        // inputs observe the change, then dispatch the events they listen for.
        const result = await session.evalJson(`(() => {
          const el = ${hasTarget ? locatorFor(input, dom) : 'document.activeElement'};
          if (!el) return { ok: false, reason: 'no element' };
          el.focus();
          const isField = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
          if (${clear ? 'true' : 'false'} && isField) {
            const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) setter.call(el, ''); else el.value = '';
          }
          if (isField) {
            const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) setter.call(el, ${JSON.stringify(text)}); else el.value = ${JSON.stringify(text)};
          } else if (el.isContentEditable) {
            el.textContent = ${JSON.stringify(text)};
          } else {
            el.value = ${JSON.stringify(text)};
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, value: String(el.value !== undefined ? el.value : el.textContent || '') };
        })()`);

        if (!result?.ok) throw new ActionError('type_text', `${describeTarget(input)} — ${result?.reason || 'could not type'}`, { code: 'E_ELEMENT_NOT_FOUND' });

        if (input.press_enter) {
          await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
          await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
          await session.waitForReady(10_000).catch(() => {});
        }
        return { typed: true, value: result.value, method: 'prototype-setter + input/change events', target: describeTarget(input) };
      },
    },
    {
      name: 'send_keys',
      description: 'Dispatch a named key (Enter, Tab, Escape, ArrowDown, PageDown, …) to the page or a target.',
      risk: 'medium',
      permissions: ['interact'],
      timeout_ms: 20_000,
      input_schema: {
        type: 'object',
        properties: {
          ...TARGET_SCHEMA,
          key: { type: 'string', minLength: 1, description: 'Key name, e.g. Enter, Tab, Escape, ArrowDown' },
        },
        required: ['key'],
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { sent: { type: 'boolean' }, key: { type: 'string' } }, required: ['sent'] },
      handler: async (input, { session, dom }) => {
        const { key } = input;
        const hasTarget = input.index !== undefined || input.selector || input.xpath || input.text;
        if (hasTarget) await performClick(session, input, dom);
        const spec = KEY_SPECS[key] || { code: key, keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0 };
        await session.send('Input.dispatchKeyEvent', {
          type: 'keyDown', key, code: spec.code,
          windowsVirtualKeyCode: spec.keyCode, nativeVirtualKeyCode: spec.keyCode,
          text: spec.text ?? undefined,
        });
        await session.send('Input.dispatchKeyEvent', {
          type: 'keyUp', key, code: spec.code,
          windowsVirtualKeyCode: spec.keyCode, nativeVirtualKeyCode: spec.keyCode,
        });
        return { sent: true, key, target: hasTarget ? describeTarget(input) : 'focused element' };
      },
    },
    {
      name: 'key_press',
      description: 'Press a key combination, e.g. ctrl+a, ctrl+shift+t, meta+r.',
      risk: 'medium',
      permissions: ['interact'],
      timeout_ms: 20_000,
      input_schema: {
        type: 'object',
        properties: {
          keys: { type: 'string', minLength: 1, description: 'Combination like "ctrl+a" or "ctrl+shift+i"' },
        },
        required: ['keys'],
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { pressed: { type: 'boolean' }, keys: { type: 'string' }, modifiers: { type: 'array' } }, required: ['pressed'] },
      handler: async ({ keys }, { session }) => {
        const parts = keys.split('+').map((s) => s.trim().toLowerCase()).filter(Boolean);
        if (!parts.length) throw new ActionError('key_press', 'keys must not be empty');
        const main = parts[parts.length - 1];
        const mods = parts.slice(0, -1);
        const mask = modifierMask(mods);
        const spec = KEY_SPECS[main] || KEY_SPECS[main.toUpperCase()] || { code: `Key${main.toUpperCase()}`, keyCode: main.toUpperCase().charCodeAt(0), text: main };
        for (const m of mods) {
          await session.send('Input.dispatchKeyEvent', {
            type: 'keyDown', key: m === 'ctrl' ? 'Control' : m === 'shift' ? 'Shift' : m === 'meta' ? 'Meta' : 'Alt',
            code: m === 'ctrl' ? 'ControlLeft' : m === 'shift' ? 'ShiftLeft' : m === 'meta' ? 'MetaLeft' : 'AltLeft',
            windowsVirtualKeyCode: m === 'ctrl' ? 17 : m === 'shift' ? 16 : m === 'meta' ? 91 : 18,
            modifiers: mask,
          });
        }
        await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: main, code: spec.code, windowsVirtualKeyCode: spec.keyCode, nativeVirtualKeyCode: spec.keyCode, text: spec.text, modifiers: mask });
        await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: main, code: spec.code, windowsVirtualKeyCode: spec.keyCode, nativeVirtualKeyCode: spec.keyCode, modifiers: mask });
        for (const m of [...mods].reverse()) {
          await session.send('Input.dispatchKeyEvent', {
            type: 'keyUp', key: m === 'ctrl' ? 'Control' : m === 'shift' ? 'Shift' : m === 'meta' ? 'Meta' : 'Alt',
            code: m === 'ctrl' ? 'ControlLeft' : m === 'shift' ? 'ShiftLeft' : m === 'meta' ? 'MetaLeft' : 'AltLeft',
            windowsVirtualKeyCode: m === 'ctrl' ? 17 : m === 'shift' ? 16 : m === 'meta' ? 91 : 18,
            modifiers: mask,
          });
        }
        return { pressed: true, keys, modifiers: mods };
      },
    },
    {
      name: 'focus_element',
      description: 'Focus an element.',
      risk: 'low',
      permissions: ['interact'],
      timeout_ms: 15_000,
      input_schema: { type: 'object', properties: { ...TARGET_SCHEMA }, additionalProperties: false },
      output_schema: { type: 'object', properties: { focused: { type: 'boolean' }, active_element: { type: 'string' } }, required: ['focused'] },
      handler: async (input, { session, dom }) => {
        const active = await session.eval(`(() => { const el = ${locatorFor(input, dom)}; if (!el) return null; el.focus(); return document.activeElement === el ? (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')) : null; })()`);
        if (!active) throw new ActionError('focus_element', `${describeTarget(input)} — element not found or focus was refused`, { code: 'E_ELEMENT_NOT_FOUND' });
        return { focused: true, active_element: active, target: describeTarget(input) };
      },
    },
    {
      name: 'blur_element',
      description: 'Remove focus from an element (or from the currently focused element).',
      risk: 'low',
      permissions: ['interact'],
      timeout_ms: 15_000,
      input_schema: { type: 'object', properties: { ...TARGET_SCHEMA }, additionalProperties: false },
      output_schema: { type: 'object', properties: { blurred: { type: 'boolean' } }, required: ['blurred'] },
      handler: async (input, { session, dom }) => {
        const hasTarget = input.index !== undefined || input.selector || input.xpath || input.text;
        const expr = hasTarget
          ? `(() => { const el = ${locatorFor(input, dom)}; if (!el) return false; el.blur(); return true; })()`
          : '(() => { if (document.activeElement) document.activeElement.blur(); return true; })()';
        const ok = await session.eval(expr);
        if (!ok) throw new ActionError('blur_element', `${describeTarget(input)} — no matching element`, { code: 'E_ELEMENT_NOT_FOUND' });
        return { blurred: true };
      },
    },
    {
      name: 'drag_element',
      description: 'Drag one element onto another with real mouse events.',
      risk: 'medium',
      permissions: ['interact'],
      timeout_ms: 30_000,
      input_schema: {
        type: 'object',
        properties: {
          source_index: { type: 'integer', minimum: 0 }, source_selector: { type: 'string', minLength: 1 },
          target_index: { type: 'integer', minimum: 0 }, target_selector: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { dragged: { type: 'boolean' }, from: { type: 'object' }, to: { type: 'object' } }, required: ['dragged'] },
      handler: async (input, { session, dom }) => {
        const from = await centreOf(session, { index: input.source_index, selector: input.source_selector }, dom);
        const to = await centreOf(session, { index: input.target_index, selector: input.target_selector }, dom);
        await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
        await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 });
        const steps = 8;
        for (let i = 1; i <= steps; i++) {
          await session.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: Math.round(from.x + ((to.x - from.x) * i) / steps),
            y: Math.round(from.y + ((to.y - from.y) * i) / steps),
            button: 'left',
          });
        }
        await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 });
        return { dragged: true, from, to };
      },
    },
    {
      name: 'scroll_element',
      description: 'Scroll a specific element into view.',
      risk: 'low',
      permissions: ['interact'],
      timeout_ms: 15_000,
      input_schema: { type: 'object', properties: { ...TARGET_SCHEMA }, additionalProperties: false },
      output_schema: { type: 'object', properties: { scrolled: { type: 'boolean' }, in_view: { type: 'boolean' } }, required: ['scrolled'] },
      handler: async (input, { session, dom }) => {
        const r = await session.evalJson(`(() => {
          const el = ${locatorFor(input, dom)};
          if (!el) return null;
          el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
          const b = el.getBoundingClientRect();
          return { in_view: b.top >= 0 && b.left >= 0 && b.bottom <= innerHeight && b.right <= innerWidth };
        })()`);
        if (!r) throw new ActionError('scroll_element', `${describeTarget(input)} — no matching element`, { code: 'E_ELEMENT_NOT_FOUND' });
        return { scrolled: true, in_view: r.in_view, target: describeTarget(input) };
      },
    },
  ];
}

/** Named key specs, used by send_keys and key_press. */
export const KEY_SPECS = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9, text: '\t' },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  Space: { code: 'Space', keyCode: 32, text: ' ' },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
  F5: { code: 'F5', keyCode: 116 },
};

export default { interactionActions, performClick, modifierMask, MODIFIERS, KEY_SPECS };
