// computer/action/coordinate.js
// Phase 29 Scope A — declared coordinate normalization formula.
//
// VLM grounding models emit coordinates in the model's own pixel space
// (UI-TARS family: typically 0..999 or the training resolution). The
// operator needs physical screen pixels. The mapping is a DECLARED
// formula, not a heuristic:
//
//   x' = clamp(round(x * (W_screen / W_model)), 0, W_screen)
//   y' = clamp(round(y * (H_screen / H_model)), 0, H_screen)
//
// - Pure integer arithmetic after the scaling factor: Math.round, then
//   clamped into the screen rect. Same inputs -> same outputs.
// - Rationale for Math.round (not floor/ceil): nearest-pixel mapping is
//   symmetric for both axes and preserves the center of a symmetric box.
// - The formula is applied per point; boxes are already reduced to their
//   center point at parse time (parser.js, declared).

import { ComputerError } from '../errors.js';

export const NORMALIZE_FORMULA =
  "x' = clamp(round(x * W_screen / W_model), 0, W_screen); " +
  "y' = clamp(round(y * H_screen / H_model), 0, H_screen)";

function requireSize(size, label) {
  if (
    !size ||
    typeof size !== 'object' ||
    typeof size.width !== 'number' ||
    typeof size.height !== 'number' ||
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  ) {
    throw new ComputerError('E_INVALID_ARGUMENT', `${label} must be { width, height } > 0`, {
      got: size,
    });
  }
  return size;
}

function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * Normalize a model-space point to screen-space pixels.
 * @param {{ x: number, y: number }} coord   point in model pixel space
 * @param {{ modelSize: {width,height}, screenSize: {width,height}} } opts
 * @returns {{ x: number, y: number }} integers in screen pixel space
 */
export function normalize(coord, opts) {
  if (
    !coord ||
    typeof coord !== 'object' ||
    typeof coord.x !== 'number' ||
    typeof coord.y !== 'number' ||
    !Number.isFinite(coord.x) ||
    !Number.isFinite(coord.y)
  ) {
    throw new ComputerError('E_INVALID_ARGUMENT', 'coord must be a finite { x, y } point', {
      got: coord,
    });
  }
  const { modelSize, screenSize } = opts ?? {};
  requireSize(modelSize, 'modelSize');
  requireSize(screenSize, 'screenSize');
  const x = clamp(
    Math.round((coord.x * screenSize.width) / modelSize.width),
    0,
    screenSize.width
  );
  const y = clamp(
    Math.round((coord.y * screenSize.height) / modelSize.height),
    0,
    screenSize.height
  );
  return { x, y };
}
