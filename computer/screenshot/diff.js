// computer/screenshot/diff.js
// Phase 29 Scope D — exact pixel diff: "has the screen changed?".
// The agent loop uses this to skip VLM calls and no-op actions when the
// screen is static. Exactness is a hard rule: every pixel of both images
// is compared — never sampled, never thresholded.
//
// Declared contract (Scope D):
//   diff(prev, next) -> { changed, changedRatio,          (contract fields)
//                         changedPixels, totalPixels }    (declared audit)
//
//   - A pixel counts as changed when ANY of its 4 RGBA channels differs.
//   - Identical images -> { changed: false, changedRatio: 0 }.
//   - changedRatio = changedPixels / (width * height) — exact integer
//     division, no sampling. One differing pixel in an 8x6 image is
//     exactly 1/48.
//   - Determinism: same pair in -> same result out.
//
// Errors (ComputerError codes):
//   E_INVALID_IMAGE     — either side is not decodable PNG
//   E_INVALID_ARGUMENT  — an operand is missing, or the two decoded images
//                         have different dimensions (pixel-exact diff is
//                         undefined across sizes; it is never faked with
//                         an implicit resize)

import { ComputerError } from '../errors.js';
import { decodePNG } from './optimize.js';

export function diff(prev, next) {
  if (prev === undefined || prev === null || next === undefined || next === null) {
    throw new ComputerError('E_INVALID_ARGUMENT', 'diff: requires two images (prev, next)', {});
  }
  const a = decodePNG(prev);
  const b = decodePNG(next);
  if (a.width !== b.width || a.height !== b.height) {
    throw new ComputerError(
      'E_INVALID_ARGUMENT',
      `diff: dimension mismatch ${a.width}x${a.height} vs ${b.width}x${b.height} — pixel-exact diff requires equal sizes`,
      { prev: `${a.width}x${a.height}`, next: `${b.width}x${b.height}` }
    );
  }
  const pa = a.pixels;
  const pb = b.pixels;
  let changed = 0;
  for (let i = 0; i < pa.length; i += 4) {
    if (
      pa[i] !== pb[i] ||
      pa[i + 1] !== pb[i + 1] ||
      pa[i + 2] !== pb[i + 2] ||
      pa[i + 3] !== pb[i + 3]
    ) {
      changed += 1;
    }
  }
  const total = a.width * a.height;
  return {
    changed: changed > 0,
    changedRatio: changed / total,
    changedPixels: changed,
    totalPixels: total,
  };
}
