// computer/screenshot/capture.js
// Phase 29 Scope D — capture source abstraction.
//
// Declared contract (Scope D):
//   capture(source) -> { image, width, height, dpi }
//
//   - source is INJECTED (pluggable: desktop / browser / remote — the
//     sandbox has no screen and none is pretended). Two source shapes are
//     accepted:
//       { name?, dpi?, grab()       -> PNG bytes }   native capture source
//       { name?, dpi?, screenshot() -> PNG bytes }   operator-style source
//                                                     (Phase 17 browser
//                                                     runtime / Scope B/C
//                                                     operators expose
//                                                     screenshot())
//   - dpi is the device pixel ratio (physical pixels per logical pixel,
//     e.g. 2 on a Retina-class display), declared by the source, default 1.
//     It is validated and echoed verbatim.
//   - width/height are decoded from the captured PNG's IHDR — the bytes are
//     authoritative, never the source's claims (a source that lies about
//     its dimensions still yields the true dims).
//   - The image bytes pass through untouched (real bytes in).
//   - This module NEVER fabricates image data. No source -> declared
//     refusal (E_NO_CAPTURE_SOURCE); a source that yields nothing or fails
//     mid-grab -> E_NO_CAPTURE_SOURCE; a source that yields non-PNG bytes
//     -> E_INVALID_IMAGE. Success is never faked.
//
// Errors (ComputerError codes):
//   E_NO_CAPTURE_SOURCE — no source given, source yields no data, or the
//                         source throws a non-ComputerError mid-grab (the
//                         cause message is preserved in details). A
//                         ComputerError thrown by the source (e.g.
//                         E_NO_DISPLAY / E_NO_BROWSER from an operator
//                         used as source) propagates UNCHANGED — the
//                         source's own declared code is the truth.
//   E_INVALID_ARGUMENT  — source is not an object, implements neither
//                         grab() nor screenshot(), or dpi is not a positive
//                         finite number
//   E_INVALID_IMAGE     — source returned bytes that are not decodable PNG

import { ComputerError } from '../errors.js';
import { decodePNG } from './optimize.js';

export function capture(source) {
  if (source === undefined || source === null) {
    throw new ComputerError(
      'E_NO_CAPTURE_SOURCE',
      'capture: no capture source available — inject a source implementing grab() or screenshot(); no image is ever fabricated',
      {}
    );
  }
  if (typeof source !== 'object' || Array.isArray(source)) {
    throw new ComputerError(
      'E_INVALID_ARGUMENT',
      'capture: source must be an object implementing grab() or screenshot()',
      { got: typeof source }
    );
  }
  const hasGrab = typeof source.grab === 'function';
  const hasShot = typeof source.screenshot === 'function';
  if (!hasGrab && !hasShot) {
    throw new ComputerError(
      'E_INVALID_ARGUMENT',
      'capture: source implements neither grab() nor screenshot()',
      { got: Object.keys(source).join(',') }
    );
  }
  if (
    source.dpi !== undefined &&
    (typeof source.dpi !== 'number' || !Number.isFinite(source.dpi) || source.dpi <= 0)
  ) {
    throw new ComputerError(
      'E_INVALID_ARGUMENT',
      `capture: source.dpi must be a positive finite number, got ${JSON.stringify(source.dpi)}`,
      { got: source.dpi }
    );
  }

  let bytes;
  try {
    bytes = hasGrab ? source.grab() : source.screenshot();
  } catch (err) {
    if (err instanceof ComputerError) throw err; // source's declared code propagates unchanged
    throw new ComputerError(
      'E_NO_CAPTURE_SOURCE',
      `capture: source failed mid-grab (${err && err.message ? err.message : String(err)})`,
      {}
    );
  }
  if (bytes === undefined || bytes === null) {
    throw new ComputerError('E_NO_CAPTURE_SOURCE', 'capture: source returned no image data', {});
  }

  const decoded = decodePNG(bytes); // E_INVALID_IMAGE on undecodable bytes
  return {
    image: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
    width: decoded.width,
    height: decoded.height,
    dpi: source.dpi === undefined ? 1 : source.dpi,
  };
}
