/**
 * JEXI OS — Phase 17 Scope C — VISION / COORDINATE MAP.
 *
 * Bridges the two coordinate systems and closes the loop back to the DOM:
 *
 *   image px   — what the screenshot (and the detector) speak. The capture is
 *                devicePixelRatio × viewport, so image = viewport × dpr.
 *   viewport px— what CDP Input.dispatchMouseEvent speaks.
 *   durable key— the stable element identity from dom-service
 *                ('data-jexi-id:…', 'id:…', 'testid:…', 'aria:…').
 *
 * The mapping back to a durable key runs IN THE PAGE (elementFromPoint at the
 * box center, then the nearest ancestor carrying a durable attribute), so the
 * key a vision click lands on is asserted, not assumed.
 */

/** Scale a box from image pixels to viewport (CSS) pixels. */
export function scaleBoxToViewport(box, dpr = 1) {
  if (dpr === 1) return { ...box };
  return {
    x: box.x / dpr, y: box.y / dpr, w: box.w / dpr, h: box.h / dpr,
    ...(box.label !== undefined ? { label: box.label } : {}),
    ...(box.confidence !== undefined ? { confidence: box.confidence } : {}),
  };
}

/** Scale a viewport (CSS) box to image pixels. */
export function scaleBoxToImage(box, dpr = 1) {
  if (dpr === 1) return { ...box };
  return {
    x: box.x * dpr, y: box.y * dpr, w: box.w * dpr, h: box.h * dpr,
    ...(box.label !== undefined ? { label: box.label } : {}),
    ...(box.confidence !== undefined ? { confidence: box.confidence } : {}),
  };
}

/** Center of a box (any coordinate system — returns the same system). */
export function centerOf(box) {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/** A CDP captureScreenshot clip for a viewport box. */
export function boxToClip(viewportBox) {
  return { x: viewportBox.x, y: viewportBox.y, width: viewportBox.w, height: viewportBox.h, scale: 1 };
}

/**
 * Page-side expression: what durable element sits at a viewport point?
 * Returns a JSON string: {key, tag, id, text} | {key: null}.
 * The marker comment is the fixture/test contract — a stable signature for
 * test endpoints to recognise this probe without parsing the whole script.
 */
export function elementFromPointSource(cx, cy) {
  return `/*__JEXI_VISION_PT__*/ (() => {
    const el = document.elementFromPoint(${JSON.stringify(cx)}, ${JSON.stringify(cy)});
    if (!el) return JSON.stringify({ key: null, tag: null, text: '' });
    const owner = el.closest('[data-jexi-id],[id],[data-testid],[data-test],[data-qa],[name]') || el;
    let key = null;
    if (owner.getAttribute('data-jexi-id')) key = 'data-jexi-id:' + owner.getAttribute('data-jexi-id');
    else if (owner.id) key = 'id:' + owner.id;
    else if (owner.getAttribute('data-testid')) key = 'testid:' + owner.getAttribute('data-testid');
    else if (owner.getAttribute('data-test')) key = 'testid:' + owner.getAttribute('data-test');
    else if (owner.getAttribute('data-qa')) key = 'qa:' + owner.getAttribute('data-qa');
    else if (owner.getAttribute('name')) key = 'name:' + owner.getAttribute('name');
    return JSON.stringify({ key, tag: owner.tagName ? owner.tagName.toLowerCase() : null, text: (owner.textContent || '').trim().slice(0, 80) });
  })()`;
}

/** Parse the JSON a elementFromPointSource evaluation returns. */
export function parsePointResult(raw) {
  if (raw === null || raw === undefined) return { key: null, tag: null, text: '' };
  if (typeof raw === 'object') return raw; // some runtimes returnByValue objects directly
  try { return JSON.parse(raw); } catch { return { key: null, tag: null, text: String(raw) }; }
}

/**
 * Resolve the durable key under a viewport point through a live session.
 * @param {import('../cdp.js').CdpSession} session
 */
export async function keyAtPoint(session, cx, cy) {
  const raw = await session.eval(elementFromPointSource(cx, cy));
  return parsePointResult(raw);
}

/**
 * Pure helper: which snapshot element (if any) does a viewport box overlap the
 * most? Snapshot elements need a `rect` (viewport px) — the decider uses this
 * only when the page supplies element rects; without rects the answer is null
 * (the elementFromPoint path is the authoritative one).
 */
export function bestOverlappingSnapshotElement(box, snapshotElements) {
  let best = null, bestFrac = 0;
  for (const el of snapshotElements || []) {
    const r = el.rect;
    if (!r) continue;
    const ix = Math.max(0, Math.min(box.x + box.w, r.x + r.w) - Math.max(box.x, r.x));
    const iy = Math.max(0, Math.min(box.y + box.h, r.y + r.h) - Math.max(box.y, r.y));
    const frac = (ix * iy) / (box.w * box.h || 1);
    if (frac > bestFrac) { bestFrac = frac; best = el; }
  }
  return bestFrac >= 0.5 ? { element: best, overlap: bestFrac } : null;
}

export default { scaleBoxToViewport, scaleBoxToImage, centerOf, boxToClip, elementFromPointSource, parsePointResult, keyAtPoint, bestOverlappingSnapshotElement };
