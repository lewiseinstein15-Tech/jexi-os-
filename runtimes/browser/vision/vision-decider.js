/**
 * JEXI OS — Phase 17 Scope C — VISION / VISION DECIDER.
 *
 * A drop-in `decide` for the OpenHands agent-loop (agent-loop.js takes an
 * injected decide({snapshot, snapshot_text, task, step, history})). Priority:
 *
 *   1. DOM match      → delegate to the DOM decider (kept untouched). Vision
 *                       is an ALTERNATIVE, not a replacement.
 *   2. visual match   → screenshot, detector, map to viewport px, act on
 *                       coordinates.
 *   3. neither        → refuse with E_NO_TARGET (never a guessed click).
 *
 * Optional action that ships with this decider:
 *   vision_click ({hint}) — screenshot → detect → dpr-scale → click center.
 *                           Output carries the coordinate trace and the
 *                           durable key under the point (if any).
 *   capture_page ({name}) — screenshot the page, return dimensions + ms.
 *
 * The DOM decider contract assumed here: decide() resolves
 *   null                — "I cannot decide" (vision may try)
 *   {action, input, …}  — an executable plan
 * Anything thrown by the DOM decider is treated as "cannot decide" so vision
 * still gets its chance, and vice versa vision failures must not break DOM.
 */

import { captureScreenshot, cropPng } from './screenshot.js';
import { findTarget } from './element-detector.js';
import { scaleBoxToViewport, centerOf, keyAtPoint } from './coordinate-map.js';

export const E_NO_TARGET = 'E_NO_TARGET';

/** Decider refused: neither DOM nor pixels matched the hint. */
export class VisionNoTargetError extends Error {
  constructor(hint, { domReason = null, visionReason = null } = {}) {
    super(`no target for "${hint}" — no DOM match (${domReason ?? 'none'}) and no visual match (${visionReason ?? 'none'})`);
    this.name = 'VisionNoTargetError';
    this.code = E_NO_TARGET;
    this.hint = hint;
    this.domReason = domReason;
    this.visionReason = visionReason;
  }
}

/**
 * Compose a vision-augmented decider around a DOM decider.
 * @param {object} o
 * @param {Function} o.domDecider          the existing (untouched) decider
 * @param {Function} o.getSession          () → CdpSession (lazy — only on the visual path)
 * @param {object}   o.detector            element-detector instance (model or fixture)
 * @param {number}   [o.dpr]               devicePixelRatio (default 1; refetched if the session can)
 * @param {Function} [o.getHint]           (task, history) → visual hint string
 */
export function createVisionDecider(o) {
  const { domDecider, getSession, detector } = o;
  if (typeof domDecider !== 'function') throw new Error('createVisionDecider: domDecider is required');
  if (!getSession) throw new Error('createVisionDecider: getSession is required');
  if (!detector || typeof detector.detect !== 'function') throw new Error('createVisionDecider: detector is required');

  const getHint = o.getHint || ((task) => task);

  async function decide(ctx) {
    const hint = getHint(ctx.task, ctx);

    // 1 — DOM first (unchanged priority; the DOM decider owns index-based control).
    let domPlan = null, domReason = null;
    try {
      domPlan = await domDecider(ctx);
    } catch (e) {
      domReason = e.code || e.message;
    }
    if (domPlan) return { ...domPlan, decided_by: 'dom', vision: null };

    // 2 — visual path.
    if (!hint) throw new VisionNoTargetError('(no hint)', { domReason });
    const session = await getSession();
    const shot = await captureScreenshot(session);
    const t = await findTarget(detector, { png: shot.buffer, hint });
    if (!t.found) throw new VisionNoTargetError(hint, { domReason, visionReason: t.reason });

    const dpr = o.dpr ?? (await readDpr(session)) ?? 1;
    const viewportBox = scaleBoxToViewport(t.box, dpr);
    const click = centerOf(viewportBox);
    const under = await keyAtPoint(session, Math.round(click.x), Math.round(click.y)).catch(() => null);

    return {
      action: 'vision_click',
      input: { hint, box: viewportBox, center: click, dpr, detector: t.detector },
      reasoning: `DOM offered no target (${domReason ?? 'no match'}); visual match "${t.box.label ?? hint}" at viewport ${Math.round(click.x)},${Math.round(click.y)} (image ${Math.round(t.box.x)},${Math.round(t.box.y)} @dpr ${dpr}, detector ${t.detector}). Element under point: ${under && under.key ? under.key : 'none (likely in-canvas)'}.`,
      decided_by: 'vision',
      vision: { image_box: t.box, viewport_box: viewportBox, under_point: under, detector: t.detector, detector_ms: t.ms, screenshot_ms: shot.ms, screenshot_bytes: shot.bytes },
    };
  }

  return decide;
}

async function readDpr(session) {
  try {
    const v = await session.eval('window.devicePixelRatio || 1');
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch { return 1; }
}

/** Execute a vision_click plan against a live session (real Input events). */
export async function performVisionClick(session, plan) {
  const { center } = plan.input;
  const x = Math.round(center.x), y = Math.round(center.y);
  const common = { x, y, button: 'left', clickCount: 1 };
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...common });
  await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...common });
  const under = await keyAtPoint(session, x, y).catch(() => null);
  return { clicked: true, at: { x, y }, method: 'vision-mouse', under_point: under };
}

/**
 * vision_click action descriptor — register on an action registry so the loop
 * can execute vision plans through the same dispatch path as DOM actions.
 */
export function visionClickAction() {
  return {
    name: 'vision_click',
    description: 'Click by visual coordinates: screenshot → target detection → viewport mapping → real mouse events. Use when the target has no DOM presence (canvas, pixel UI) or the DOM decider refuses.',
    risk: 'medium',
    permissions: ['interact'],
    timeout_ms: 20_000,
    retries: 1,
    input_schema: {
      type: 'object',
      properties: {
        hint: { type: 'string', description: 'what the target looks like' },
        box: { type: 'object', description: 'viewport-space box from the decider' },
        center: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
        dpr: { type: 'number' },
        detector: { type: 'string' },
      },
      required: ['hint', 'center'],
      additionalProperties: true,
    },
    output_schema: {
      type: 'object',
      properties: {
        clicked: { type: 'boolean' }, method: { type: 'string' }, at: { type: 'object' }, under_point: { type: ['object', 'null'] },
      },
      required: ['clicked', 'method'],
    },
    /** The injected session (ctx.session) is a raw CDP session. */
    async handler(input, ctx) {
      return performVisionClick(ctx.session, { input });
    },
  };
}

/**
 * capture_page action — real screenshot, dimensions + timing returned, PNG
 * bytes optionally written to ctx.outputDir/<name>.png by the caller.
 */
export function capturePageAction() {
  return {
    name: 'capture_page',
    description: 'Capture a real screenshot of the page (returns PNG dimensions, byte size and wall time).',
    risk: 'low',
    permissions: ['read'],
    timeout_ms: 20_000,
    retries: 0,
    input_schema: { type: 'object', properties: { name: { type: 'string' }, clip: { type: 'object' } }, additionalProperties: false },
    output_schema: {
      type: 'object',
      properties: { width: { type: 'number' }, height: { type: 'number' }, bytes: { type: 'number' }, ms: { type: 'number' }, base64: { type: 'string' } },
      required: ['width', 'height', 'bytes'],
    },
    async handler(input, ctx) {
      const r = await captureScreenshot(ctx.session, input && input.clip ? { clip: input.clip } : {});
      const { width, height } = (() => { const b = r.buffer; return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; })();
      return { width, height, bytes: r.bytes, ms: r.ms, base64: r.base64 };
    },
  };
}

/** Crop helper re-exported for actions that need pixel work on results. */
export { cropPng };

export default { E_NO_TARGET, VisionNoTargetError, createVisionDecider, performVisionClick, visionClickAction, capturePageAction };
