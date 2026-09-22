// computer/events/index.js
// Phase 29 Scope K — EVENT STREAM facade.
//
//   events.map(guiEvent)  -> phase16Event   (pure; declared in map.js)
//   events.emit(guiEvent) -> { routed }     (via the Phase 16 router; emit.js)
//
// This facade does NOT create a parallel event system: it maps GUI-agent
// events INTO the existing Phase 16 taxonomy + router (read-only
// consumption of events/chat/taxonomy.js and ui/web/console/chat/router.js).
//
// Load-time drift checks (fail fast at import, not at 3am): every MAP_TABLE
// entry must name a kind in the closed GUI_EVENT_KINDS set AND a type that
// still exists in the Phase 16 taxonomy. If Phase 16 ever renames or removes
// a type, importing this module refuses loudly instead of mapping into a
// dead type.

import { ComputerError } from '../errors.js';
import { taxonomy } from '../../events/chat/taxonomy.js';
import {
  map,
  EVENT_CODES,
  GUI_EVENT_KINDS,
  MAP_TABLE,
  CHAT_EVENT_VERSION,
  GUI_TOOL_PREFIX,
  GUI_SCREENSHOT_TOOL,
  THINKING_GUI_TYPE,
  THINKING_NARRATION_TYPE,
  STOPPED_BY,
  STOPPED_BY_STATUS,
} from './map.js';
import { emit } from './emit.js';

// --- load-time drift checks ------------------------------------------------
const phase16Types = taxonomy.list();
for (const [kind, type] of Object.entries(MAP_TABLE)) {
  if (!GUI_EVENT_KINDS.includes(kind)) {
    throw new ComputerError('E_INVALID_ARGUMENT', `events: MAP_TABLE kind "${kind}" is not in the declared GUI_EVENT_KINDS closed set`, {
      kind,
    });
  }
  if (!phase16Types.includes(type)) {
    throw new ComputerError('E_INVALID_ARGUMENT', `events: MAP_TABLE maps "${kind}" to Phase 16 type "${type}" which no longer exists in the taxonomy (Phase 16 drift)`, {
      kind,
      type,
      phase16Types: phase16Types.length,
    });
  }
}
if (GUI_EVENT_KINDS.length !== Object.keys(MAP_TABLE).length) {
  throw new ComputerError('E_INVALID_ARGUMENT', 'events: GUI_EVENT_KINDS and MAP_TABLE disagree in size (Phase 29 Scope K drift)', {
    kinds: GUI_EVENT_KINDS.length,
    mapTable: Object.keys(MAP_TABLE).length,
  });
}

const events = Object.freeze({
  map,
  emit,
  // declared tables (frozen, machine-readable)
  EVENT_CODES,
  GUI_EVENT_KINDS,
  MAP_TABLE,
  CHAT_EVENT_VERSION,
  GUI_TOOL_PREFIX,
  GUI_SCREENSHOT_TOOL,
  THINKING_GUI_TYPE,
  THINKING_NARRATION_TYPE,
  STOPPED_BY,
  STOPPED_BY_STATUS,
});

export { events };
export {
  map,
  emit,
  EVENT_CODES,
  GUI_EVENT_KINDS,
  MAP_TABLE,
  CHAT_EVENT_VERSION,
  GUI_TOOL_PREFIX,
  GUI_SCREENSHOT_TOOL,
  THINKING_GUI_TYPE,
  THINKING_NARRATION_TYPE,
  STOPPED_BY,
  STOPPED_BY_STATUS,
};
export default events;
