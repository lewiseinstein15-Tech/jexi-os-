/**
 * JEXI OS — Phase 17 Scope B — DOM EXTRACTION SERVICE.
 *
 * Turns a live page into the compact indexed list a model can reason about:
 *
 *   [0]<a href=https://example.com/more> More information.../>
 *   [1]*<button id=submit> Submit />
 *
 * Ported from browser-use's serializer (dom/serializer/{clickable_elements,
 * serializer}.py), deliberately kept simple:
 *   - interactive elements only, plus scroll containers and iframes
 *   - a stable id per element, derived from a DURABLE KEY (see below)
 *   - a leading `*` on elements not seen in the previous snapshot
 *
 * ── STABILITY MODEL (the part browser-use leaves to index allocation) ───────
 * browser-use allocates indices fresh on every snapshot (`_allocate_selector_
 * index`) and marks new nodes by comparing CDP backendNodeIds. Indices drift
 * whenever the DOM changes, which makes a model's "[7] click" ambiguous across
 * turns.
 *
 * This port keeps indices stable by keying identity on the element's durable
 * attributes, in priority order:
 *
 *   1. data-jexi-id  — our own attribute, written on high-confidence matches
 *   2. id            — an HTML id
 *   3. data-testid / data-test / data-qa  — test hooks, stable by convention
 *   4. aria-label / name + type
 *   5. role + accessible name
 *   6. tag + normalized text + index among same-signature siblings
 *
 * A key maps to the same index across snapshots, so "navigate away and back"
 * yields identical ids. Keys that disappear are dropped, and keys that return
 * are treated as NEW (matching browser-use, where a fresh backendNodeId is new).
 * The key is exposed on the element as `jexi_key` for debugging.
 */

/** Tags treated as interactive on sight. */
export const INTERACTIVE_TAGS = [
  'a', 'button', 'input', 'select', 'textarea', 'option', 'details', 'summary',
  'label', 'audio', 'video', 'embed', 'iframe', 'frame',
  // Forms are targets in their own right: submit_form accepts a <form>, so it
  // has to be discoverable in the snapshot the model reads.
  'form',
];

/** ARIA roles treated as interactive. */
export const INTERACTIVE_ROLES = [
  'button', 'link', 'checkbox', 'radio', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'option', 'tab', 'switch', 'slider', 'spinbutton',
  'textbox', 'searchbox', 'combobox', 'listbox', 'treeitem', 'gridcell',
];

/**
 * The page-side extractor, injected with Runtime.evaluate.
 * Kept as a single self-contained function so it needs no bundler.
 */
export const DOM_EXTRACTOR_SOURCE = `(() => {
  const INTERACTIVE_TAGS = new Set(${JSON.stringify(INTERACTIVE_TAGS)});
  const INTERACTIVE_ROLES = new Set(${JSON.stringify(INTERACTIVE_ROLES)});

  // Walk the ancestor chain rather than trusting this element's own computed
  // style: display:none on a parent leaves the child's own display at its
  // specified value, so an element hidden by an ancestor looks identical to a
  // visible one when only the element itself is inspected.
  const isHidden = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.tagName === 'HTML' || n.tagName === 'BODY') continue;
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || cs.opacity === '0') return true;
    }
    return false;
  };

  const isVisible = (el) => {
    if (el.tagName === 'INPUT' && el.type === 'file') return !isHidden(el);
    // A zero-width/height box is NOT treated as hidden. This engine reports a
    // 0x0 rect for static inline elements (e.g. a bare <a> that is actually
    // rendered and clickable), so rejecting zero-size elements drops real
    // links from the snapshot. Visibility is decided by the ancestor chain.
    return !isHidden(el);
  };

  const accessibleName = (el) => {
    const aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) return aria.trim();
    const labelled = el.getAttribute && el.getAttribute('aria-labelledby');
    if (labelled) {
      const t = labelled.split(/\\s+/).map((id) => {
        const n = document.getElementById(id);
        return n ? n.textContent.trim() : '';
      }).filter(Boolean).join(' ');
      if (t) return t;
    }
    if (el.labels && el.labels.length) return Array.from(el.labels).map((l) => l.textContent.trim()).filter(Boolean).join(' ');
    const ph = el.getAttribute && el.getAttribute('placeholder');
    if (ph) return ph.trim();
    const title = el.getAttribute && el.getAttribute('title');
    if (title) return title.trim();
    if (el.tagName === 'INPUT' && el.type !== 'password' && el.value) return String(el.value).trim();
    return (el.textContent || '').replace(/\\s+/g, ' ').trim();
  };

  const DURABLE_ATTRS = ['data-jexi-id', 'id', 'data-testid', 'data-test', 'data-qa', 'name'];
  const siblingSignature = (el) => {
    const cls = (el.getAttribute('class') || '').split(/\\s+/).filter(Boolean).slice(0, 2).join('.');
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + '|' + (el.getAttribute('type') || '');
  };

  const durableKey = (el) => {
    for (const a of DURABLE_ATTRS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v && v.trim()) return a + ':' + v.trim();
    }
    const aria = el.getAttribute && el.getAttribute('aria-label');
    const name = el.getAttribute && el.getAttribute('name');
    const type = el.getAttribute && el.getAttribute('type');
    if (type && name) return 'type+name:' + type + ':' + name;
    if (aria) return 'aria:' + aria.trim();
    const role = el.getAttribute && el.getAttribute('role');
    const acc = accessibleName(el);
    if (role && acc) return 'role+name:' + role + ':' + acc.slice(0, 60);
    // Last resort: tag + text + ordinal among same-signature siblings.
    const parent = el.parentElement;
    let ordinal = 0;
    if (parent) {
      let seen = 0;
      for (const sib of parent.children) {
        if (sib === el) { ordinal = seen; break; }
        if (siblingSignature(sib) === siblingSignature(el)) seen++;
      }
    }
    return 'sig:' + siblingSignature(el) + ':' + acc.slice(0, 40) + ':' + ordinal;
  };

  const attrsOf = (el) => {
    const out = {};
    for (const a of ['id', 'name', 'type', 'role', 'placeholder', 'value', 'href', 'src', 'alt', 'title', 'aria-label', 'checked', 'disabled', 'readonly', 'multiple', 'for']) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v !== null && v !== undefined && v !== '') out[a] = String(v).slice(0, 200);
    }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      if (el.type === 'checkbox' || el.type === 'radio') out.checked = String(!!el.checked);
      if (el.type === 'password') out.value = '(redacted)';
    }
    if (el.tagName === 'SELECT') out.value = String(el.value);
    return out;
  };

  const scrollable = (el) => {
    const cs = getComputedStyle(el);
    const oy = cs.overflowY, ox = cs.overflowX;
    const canY = (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 4;
    const canX = (ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 4;
    return canX || canY;
  };

  const candidates = new Set();
  for (const el of document.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const hasClick = !!el.onclick;
    const tabindex = el.getAttribute('tabindex');
    const contentEditable = el.isContentEditable;
    const pointer = (() => { try { return getComputedStyle(el).cursor === 'pointer'; } catch { return false; } })();

    const hit = INTERACTIVE_TAGS.has(tag)
      || INTERACTIVE_ROLES.has(role)
      || hasClick
      || contentEditable
      || (tabindex !== null && tabindex !== '-1')
      || ((tag === 'div' || tag === 'span') && pointer && (el.textContent || '').trim().length > 0)
      || (tag === 'iframe' || tag === 'frame')
      || scrollable(el);

    if (!hit) continue;
    if (tag === 'html' || tag === 'body') continue;
    if (!isVisible(el)) continue;
    if (el.disabled) continue;
    candidates.add(el);
  }

  const elements = [];
  let ordinal = 0;
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    const acc = accessibleName(el);
    elements.push({
      jexi_key: durableKey(el),
      tag: el.tagName.toLowerCase(),
      attributes: attrsOf(el),
      text: acc.slice(0, 300),
      is_scrollable: scrollable(el),
      is_iframe: el.tagName === 'IFRAME' || el.tagName === 'FRAME',
      is_contenteditable: !!el.isContentEditable,
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      ordinal: ordinal++,
    });
  }
  return JSON.stringify({ url: location.href, title: document.title, elements });
})()`;

/**
 * Render an element entry as one text line for the model.
 */
export function formatElement(index, el, { isNew = false } = {}) {
  const star = isNew ? '*' : '';
  const attrs = Object.entries(el.attributes || {})
    .filter(([k]) => k !== 'value' || el.tag === 'input' || el.tag === 'textarea' || el.tag === 'select')
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  const text = (el.text || '').replace(/\s+/g, ' ').trim();
  const flags = [];
  if (el.is_scrollable) flags.push('scroll');
  if (el.is_iframe) flags.push('iframe');
  if (el.is_contenteditable) flags.push('editable');
  const flagStr = flags.length ? ` (${flags.join(',')})` : '';
  const body = text ? ` ${text}` : '';
  return `${star}[${index}]<${el.tag}${attrs ? ` ${attrs}` : ''}${flagStr}>${body} </${el.tag}>`;
}

/**
 * Serialise a whole snapshot to the text block a model reads.
 */
export function formatSnapshot(snapshot, { maxElements = 400 } = {}) {
  const lines = [];
  lines.push(`URL: ${snapshot.url}`);
  lines.push(`TITLE: ${snapshot.title}`);
  lines.push(`INTERACTIVE ELEMENTS (${Math.min(snapshot.elements.length, maxElements)}${snapshot.elements.length > maxElements ? ` of ${snapshot.elements.length}` : ''}):`);
  if (snapshot.elements.length === 0) {
    lines.push('(none detected)');
  }
  snapshot.elements.slice(0, maxElements).forEach((el) => {
    lines.push(formatElement(el.index, el, { isNew: el.is_new }));
  });
  return lines.join('\n');
}

/**
 * The extractor + index assigner. Holds the key→index map that gives ids
 * their stability across snapshots.
 */
export class DomService {
  constructor({ maxElements = 400 } = {}) {
    this.maxElements = maxElements;
    this.keyToIndex = new Map();   // durable key → stable index
    this.indexToKey = new Map();
    this.seenKeys = new Set();     // keys present in the previous snapshot
    this.nextIndex = 0;
    this.snapshots = 0;
  }

  /**
   * Extract the current page through a CDP session.
   * @param {import('./cdp.js').CdpSession} session
   * @returns {Promise<object>} snapshot with stable indices and is_new flags
   */
  async extract(session) {
    const raw = await session.eval(DOM_EXTRACTOR_SOURCE);
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return this.index(parsed);
  }

  /**
   * Assign stable indices to a raw extraction. Separated from extraction so it
   * can be tested without a browser.
   */
  index(parsed) {
    const currentKeys = new Set();
    const elements = [];

    for (const el of parsed.elements) {
      const key = el.jexi_key;
      currentKeys.add(key);
      let index = this.keyToIndex.get(key);
      if (index === undefined) {
        // A key we have never issued, or one that vanished and came back.
        index = this.nextIndex++;
        this.keyToIndex.set(key, index);
        this.indexToKey.set(index, key);
      }
      const isNew = !this.seenKeys.has(key) && this.snapshots > 0;
      elements.push({ ...el, index, is_new: isNew });
    }

    // Drop keys that are gone so a returning element is reported as new,
    // matching browser-use's backendNodeId comparison.
    for (const key of this.keyToIndex.keys()) {
      if (!currentKeys.has(key)) this.keyToIndex.delete(key);
    }

    this.seenKeys = currentKeys;
    this.snapshots++;
    const out = {
      url: parsed.url,
      title: parsed.title,
      elements,
      snapshot_number: this.snapshots,
      new_count: elements.filter((e) => e.is_new).length,
    };
    out.text = formatSnapshot(out, { maxElements: this.maxElements });
    return out;
  }

  /** Resolve a stable index back to the durable key it was issued for. */
  keyFor(index) {
    return this.indexToKey.get(index) || null;
  }

  /** Reset identity tracking (e.g. after a hard navigation to a new origin). */
  reset() {
    this.keyToIndex.clear();
    this.indexToKey.clear();
    this.seenKeys.clear();
    this.nextIndex = 0;
    this.snapshots = 0;
  }
}

export default { DomService, formatSnapshot, formatElement, DOM_EXTRACTOR_SOURCE, INTERACTIVE_TAGS, INTERACTIVE_ROLES };
