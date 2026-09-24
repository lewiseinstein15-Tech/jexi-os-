/**
 * JEXI OS — Phase 17 Scope B — ELEMENT RESOLUTION.
 *
 * Every interaction action needs to turn "what the model asked for" into "a
 * specific element in the live page". The model may name an element by:
 *
 *   index   — the stable id from dom-service ('[3]' in the snapshot)
 *   selector— a CSS selector
 *   text    — visible/accessible text to match
 *   xpath   — an XPath expression
 *
 * Resolution runs IN THE PAGE, so it sees the real layout. When several
 * strategies could match, the caller picks; the helper resolves exactly one
 * and reports WHICH strategy matched, so a probe or log can show it.
 *
 * Elements are re-resolved at action time rather than holding a node handle:
 * Obscura does not implement DOM.setFileInputFiles-backed node references
 * reliably across navigations, and a stale handle is a worse failure than a
 * fresh lookup. The durable key from dom-service is the anchor.
 */

import { ActionError } from './registry.js';

/** Selector strategies, in the order the resolver tries them. */
export const RESOLUTION_ORDER = ['index', 'selector', 'xpath', 'text'];

/**
 * Page-side resolver. Returns a description of the match, not a handle.
 * @param {object} input one of {index, selector, xpath, text}
 * @param {Map<number,string>} keyByIndex stable index → durable key
 */
export function buildResolveExpression(input, keyByIndex) {
  const { index, selector, xpath, text } = input;

  if (index !== undefined && index !== null) {
    const key = keyByIndex instanceof Map ? keyByIndex.get(index) : undefined;
    if (!key) {
      throw new ActionError('resolve', `index ${index} is not in the current snapshot — take a fresh snapshot (the element may have been removed)`, { code: 'E_ELEMENT_UNKNOWN_INDEX' });
    }
    const [kind, ...rest] = String(key).split(':');
    const value = rest.join(':');
    // Re-find by the same durable attribute the index was issued for.
    const attrMap = {
      'data-jexi-id': 'data-jexi-id', id: 'id', 'data-testid': 'data-testid',
      'data-test': 'data-test', 'data-qa': 'data-qa', name: 'name',
    };
    if (attrMap[kind]) {
      return {
        strategy: 'index',
        expression: `(() => {
          const el = document.querySelector(${JSON.stringify(`[${attrMap[kind]}="${CSS.escape(value)}"]`)});
          return el ? 'found' : 'missing';
        })()`,
        describe: `index ${index} → [${kind}="${value}"]`,
        key,
      };
    }
    if (kind === 'aria' || kind === 'role+name') {
      const attr = kind === 'aria' ? 'aria-label' : 'aria-label';
      return {
        strategy: 'index',
        expression: `(() => {
          const els = [...document.querySelectorAll('[${attr}]')];
          const el = els.find((e) => e.getAttribute('${attr}') === ${JSON.stringify(value)});
          return el ? 'found' : 'missing';
        })()`,
        describe: `index ${index} → [${attr}="${value}"]`,
        key,
      };
    }
    // Signature keys cannot be re-found by attribute; fall through to text.
    return {
      strategy: 'index-signature',
      expression: `(() => {
        const els = [...document.querySelectorAll('*')];
        const hit = els.find((e) => (e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40) === ${JSON.stringify(value)});
        return hit ? 'found' : 'missing';
      })()`,
      describe: `index ${index} → signature text match`,
      key,
    };
  }

  if (selector) {
    return {
      strategy: 'selector',
      expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? 'found' : 'missing'; })()`,
      describe: `selector ${selector}`,
      key: null,
    };
  }

  if (xpath) {
    return {
      strategy: 'xpath',
      expression: `(() => {
        const r = document.evaluate(${JSON.stringify(xpath)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        return r.singleNodeValue ? 'found' : 'missing';
      })()`,
      describe: `xpath ${xpath}`,
      key: null,
    };
  }

  if (text !== undefined && text !== null && String(text) !== '') {
    const needle = String(text);
    return {
      strategy: 'text',
      expression: `(() => {
        const needle = ${JSON.stringify(needle)}.toLowerCase();
        const els = [...document.querySelectorAll('a,button,input,select,textarea,label,option,summary,[role],[onclick]')];
        const hit = els.find((e) => {
          const t = ((e.textContent || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('placeholder') || '') + ' ' + (e.getAttribute('value') || '')).replace(/\\s+/g, ' ').toLowerCase();
          return t.includes(needle);
        });
        return hit ? 'found' : 'missing';
      })()`,
      describe: `text "${needle}"`,
      key: null,
    };
  }

  throw new ActionError('resolve', 'one of index, selector, xpath or text is required', { code: 'E_ELEMENT_NO_TARGET' });
}

/**
 * Resolve a target to a DOM nodeId (used by actions needing a real node, such
 * as file upload and DOM mutations). Throws a specific error when not found.
 *
 * @param {import('../cdp.js').CdpSession} session
 * @param {object} input
 * @param {Map<number,string>} keyByIndex
 * @returns {Promise<{nodeId: number, describe: string, strategy: string}>}
 */
export async function resolveNode(session, input, keyByIndex) {
  const resolved = buildResolveExpression(input, keyByIndex);

  const root = await session.send('DOM.getDocument', { depth: -1, pierce: true });
  const nodeId = await findNodeIdInPage(session, input, keyByIndex);
  if (!nodeId) {
    throw new ActionError('resolve', `${resolved.describe} — no matching element (it may not exist, or may not be visible)`, { code: 'E_ELEMENT_NOT_FOUND' });
  }
  void root;
  return { nodeId, describe: resolved.describe, strategy: resolved.strategy };
}

/**
 * Find a DOM nodeId for the target. Runs the page-side match first (to confirm
 * the element exists), then locates the same element through DOM.querySelector
 * using a temporary marker attribute — reliable and independent of internal
 * node id allocation.
 */
export async function findNodeIdInPage(session, input, keyByIndex) {
  const marker = `jexi-resolve-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const resolved = buildResolveExpression(input, keyByIndex);
  const key = resolved.key;

  const marked = await session.eval(`(() => {
    const el = ${buildLocatorJs(input, key)};
    if (!el) return null;
    el.setAttribute('data-jexi-resolve', ${JSON.stringify(marker)});
    return el.tagName.toLowerCase();
  })()`);
  if (!marked) return null;

  try {
    const root = await session.send('DOM.getDocument', { depth: 1, pierce: true });
    const found = await session.send('DOM.querySelector', { nodeId: root.root.nodeId, selector: `[data-jexi-resolve="${marker}"]` });
    return found.nodeId || null;
  } finally {
    // Always clear the marker so the page is left as we found it.
    try { await session.eval(`(() => { const el = document.querySelector('[data-jexi-resolve="${marker}"]'); if (el) el.removeAttribute('data-jexi-resolve'); })()`); } catch { /* navigation already replaced the DOM */ }
  }
}

/**
 * The page-side locator expression for a target. Shared by resolveNode and by
 * actions that act through Runtime.evaluate rather than DOM node ids.
 */
export function buildLocatorJs(input, key = null) {
  const { index, selector, xpath, text } = input;

  if (index !== undefined && index !== null && key) {
    const [kind, ...rest] = String(key).split(':');
    const value = rest.join(':');
    const attrMap = { 'data-jexi-id': 'data-jexi-id', id: 'id', 'data-testid': 'data-testid', 'data-test': 'data-test', 'data-qa': 'data-qa', name: 'name' };
    if (attrMap[kind]) {
      return `document.querySelector('[${attrMap[kind]}="' + CSS.escape(${JSON.stringify(value)}) + '"]')`;
    }
    if (kind === 'aria' || kind === 'role+name') {
      return `[...document.querySelectorAll('[aria-label]')].find((e) => e.getAttribute('aria-label') === ${JSON.stringify(value)})`;
    }
    return `[...document.querySelectorAll('*')].find((e) => (e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40) === ${JSON.stringify(value)})`;
  }
  if (index !== undefined && index !== null) {
    return `null /* index ${index} without a known key */`;
  }
  if (selector) return `document.querySelector(${JSON.stringify(selector)})`;
  if (xpath) return `document.evaluate(${JSON.stringify(xpath)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue`;
  if (text !== undefined && text !== null && String(text) !== '') {
    const needle = String(text);
    return `([...document.querySelectorAll('a,button,input,select,textarea,label,option,summary,[role],[onclick]')].find((e) => {
      const t = ((e.textContent || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('placeholder') || '') + ' ' + (e.getAttribute('value') || '')).replace(/\\s+/g, ' ').toLowerCase();
      return t.includes(${JSON.stringify(needle)}.toLowerCase());
    }))`;
  }
  return 'null';
}

/** Human-readable name for a target input, for logs and reports. */
export function describeTarget(input) {
  if (input.index !== undefined && input.index !== null) return `index ${input.index}`;
  if (input.selector) return `selector "${input.selector}"`;
  if (input.xpath) return `xpath "${input.xpath}"`;
  if (input.text) return `text "${input.text}"`;
  return '(no target)';
}

/** Schema fragment shared by every action that targets an element. */
export const TARGET_SCHEMA = {
  index: { type: 'integer', minimum: 0, description: 'Stable element index from the latest snapshot (preferred)' },
  selector: { type: 'string', minLength: 1, description: 'CSS selector' },
  xpath: { type: 'string', minLength: 1, description: 'XPath expression' },
  text: { type: 'string', minLength: 1, description: 'Visible or accessible text to match' },
};

export default { resolveNode, findNodeIdInPage, buildLocatorJs, buildResolveExpression, describeTarget, TARGET_SCHEMA, RESOLUTION_ORDER };
