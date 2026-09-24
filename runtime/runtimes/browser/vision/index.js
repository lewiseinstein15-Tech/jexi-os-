/**
 * JEXI OS — Phase 17 Scope C — VISION (public surface).
 *
 * Vision-based browser control as an ALTERNATIVE decider for the OpenHands
 * browser runtime: DOM first, pixels second, honest refusal (E_NO_TARGET)
 * when neither matches.
 *
 *   import * as vision from '../runtimes/browser/vision/index.js';
 */

export {
  captureScreenshot, encodePng, decodePng, cropPng, pngInfo,
} from './screenshot.js';

export {
  createNoModelDetector, createImageModelDetector, createFixtureDetector, findTarget,
} from './element-detector.js';

export {
  scaleBoxToViewport, scaleBoxToImage, centerOf, boxToClip,
  elementFromPointSource, parsePointResult, keyAtPoint, bestOverlappingSnapshotElement,
} from './coordinate-map.js';

export {
  E_NO_TARGET, VisionNoTargetError,
  createVisionDecider, performVisionClick, visionClickAction, capturePageAction,
} from './vision-decider.js';

import * as screenshot from './screenshot.js';
import * as elementDetector from './element-detector.js';
import * as coordinateMap from './coordinate-map.js';
import * as visionDecider from './vision-decider.js';

export default { screenshot, elementDetector, coordinateMap, visionDecider };
