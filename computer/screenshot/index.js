// computer/screenshot/index.js
// Phase 29 Scope D — public surface of the screenshot module.
//
//   capture(source)                -> { image, width, height, dpi }
//   optimize(image, { maxWidth, maxHeight, format })
//                                  -> { image, width, height, bytes, ... }
//   diff(prev, next)               -> { changed, changedRatio, ... }
//
// Zero new dependencies (PNG codec hand-rolled on node:zlib inside
// optimize.js). All errors are ComputerError with the declared Scope D
// codes: E_NO_CAPTURE_SOURCE / E_INVALID_IMAGE / E_INVALID_ARGUMENT.
// No path in this module fabricates image data.

import { capture } from './capture.js';
import { optimize } from './optimize.js';
import { diff } from './diff.js';

export { capture, optimize, diff };
export default { capture, optimize, diff };
