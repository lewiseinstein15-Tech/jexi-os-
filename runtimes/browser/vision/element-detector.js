/**
 * JEXI OS — Phase 17 Scope C — VISION / ELEMENT DETECTOR.
 *
 * The detector answers ONE question: given screenshot pixels and a hint, where
 * is the target on screen? The contract every detector implements:
 *
 *   detect({ png, hint }) →
 *     { available: true,  boxes: [{ x, y, w, h, label, confidence }], detector, ms }
 *     | { available: false, reason, detector }          // model absent — honest
 *
 * Three implementations:
 *   createNoModelDetector()     — reports honestly that no image model exists.
 *   createImageModelDetector()  — wraps an INJECTED async model function; the
 *                                 runtime never fakes one. If you have a local
 *                                 vision model, this is where it plugs in.
 *   createFixtureDetector()     — a FIXTURE with hard-coded ground truth for
 *                                 probe pages. Labeled `fixture` everywhere it
 *                                 appears; NEVER ships as a real detector.
 *
 * Score/confidence semantics: the detector's own scale, passed through as-is.
 * The decider only requires confidence > 0 for a visual match.
 */

/**
 * The honest default in a runtime without a vision model.
 */
export function createNoModelDetector({ reason = 'no image model available in this runtime' } = {}) {
  return {
    name: 'no-model',
    kind: 'none',
    async detect() {
      return { available: false, reason, boxes: [], detector: 'no-model' };
    },
  };
}

/**
 * Wrap a real (injected) image model. `modelFn({ png, hint })` must resolve to
 * [{ x, y, w, h, label, confidence }] in IMAGE pixels.
 */
export function createImageModelDetector(modelFn, { name = 'injected-image-model' } = {}) {
  if (typeof modelFn !== 'function') throw new Error('createImageModelDetector: a model function is required');
  return {
    name,
    kind: 'model',
    async detect({ png, hint }) {
      const started = Date.now();
      const boxes = (await modelFn({ png, hint })) || [];
      return {
        available: true,
        boxes: boxes.map((b) => ({
          x: b.x, y: b.y, w: b.w, h: b.h,
          label: b.label ?? hint ?? 'target',
          confidence: b.confidence ?? 1,
        })),
        detector: name,
        ms: Date.now() - started,
      };
    },
  };
}

/**
 * FIXTURE detector for probe pages (labeled). Ground truth is supplied by the
 * probe; detection = a labeled lookup, NOT a model. It exists so the decider's
 * priority, coordinate mapping, and refusal paths are testable end-to-end in a
 * runtime without a vision model — the model step itself stays NOT VERIFIED.
 */
export function createFixtureDetector(groundTruth) {
  const entries = new Map();
  for (const [label, box] of Object.entries(groundTruth || {})) {
    entries.set(String(label).toLowerCase(), { ...box, label });
  }
  return {
    name: 'fixture',
    kind: 'fixture',
    /** count of real detections attempted — lets probes prove a FIXTURE was used */
    calls: 0,
    async detect({ hint }) {
      this.calls += 1;
      const started = Date.now();
      const key = String(hint || '').toLowerCase();
      let best = null;
      for (const [label, box] of entries) {
        if (key.includes(label) || label.includes(key)) {
          if (!best || label.length > best.label.length) best = box;
        }
      }
      return {
        available: true,
        boxes: best ? [{ ...best, confidence: 0.99 }] : [],
        detector: 'fixture (FIXTURE — not a model)',
        ms: Date.now() - started,
      };
    },
  };
}

/**
 * Run a detector and pick the best box for a hint.
 * @returns {Promise<{found: true, box: object, detector: string, ms: number}
 *                 |{found: false, reason: string, detector: string}>}
 */
export async function findTarget(detector, { png, hint }) {
  const r = await detector.detect({ png, hint });
  if (!r.available) return { found: false, reason: r.reason, detector: r.detector || detector.name };
  const best = (r.boxes || []).slice().sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
  if (!best) return { found: false, reason: `detector found no candidate for "${hint}"`, detector: r.detector };
  return { found: true, box: best, detector: r.detector, ms: r.ms ?? null };
}

export default { createNoModelDetector, createImageModelDetector, createFixtureDetector, findTarget };
