/**
 * JEXI OS — HUD STATUS CONTRACT — facade (Phase 7 F).
 *
 *   events/hud/index.js     ← everything imports THIS
 *   events/hud/schema.js    ← jexi.hud-status.v1 declared as data
 *   events/hud/validator.js ← one validator for producer AND consumers
 *   events/hud/producer.js  ← gathers all subsystems → ONE payload per change
 *   events/hud/consumer.js  ← the read side (GET /api/hud, SSE /api/hud/stream)
 *
 * Transport wiring (Express) lives in server/src/routes/hud.js; the kernel
 * seams (tool executor, provider walk, self-ping) live in
 * server/src/kernel/hooks/hud-seam.js. This facade is the stable surface.
 */

export { HUD_VERSION, HUD_SCHEMA, IDENTITY_KEYS, SECTION_KEYS, TOP_LEVEL_KEYS, emptyPayload } from './schema.js';
export { validateHud, acceptHudOrThrow, isCompleteHud } from './validator.js';
export {
  build, publish, schedulePublish, snapshot, onPublish,
  noteToolPending, recordToolCall, noteSpend, noteCheck, noteRisk,
  producerState, _reset as _resetProducer,
} from './producer.js';
export { wireHud, currentPayload, subscribe, bindProducer, consume, hudInfo, _reset as _resetConsumer } from './consumer.js';

import * as producer from './producer.js';
import * as consumer from './consumer.js';

/** One-stop default export for transport layers. */
export default { ...producer, ...consumer };
