// computer/events/emit.js
// Phase 29 Scope K — emit a GUI-agent event through the Phase 16 router.
//
// READ-ONLY consumption of Phase 16 (declared): this module imports the
// router (ui/web/console/chat/router.js) and route()s mapped events through
// it. No Phase 16 file is edited; the router keeps owning validation
// (taxonomy.validate gates everything), modes application, surface dispatch,
// history, and queueing. This module owns NOTHING except the mapping gate
// and the receipt projection.
//
// Contract:
//   emit(guiEvent) -> { routed }
//     1. map(guiEvent)  — the Scope K pure map; an unknown GUI event kind
//        THROWS E_UNKNOWN_GUI_EVENT here, BEFORE the router is involved
//        (nothing is silently dropped: a refused emit leaves zero trace in
//        the router's history because route() is never reached).
//     2. route(event.sessionId, event) — the real Phase 16 router path.
//     3. return { routed: <boolean> } — the receipt the Scope K contract
//        declares. routed:true means the event validated, was claimed by at
//        least one surface, and was delivered or queued. routed:false means
//        the router refused it (E_INVALID_EVENT / E_UNMAPPED_EVENT — only
//        reachable for callers that bypass map()); the full verdict is in
//        the router's history(sessionId).
//
// Determinism: emit adds no clock and no randomness of its own (map() adds
// none either). Delivery ordering is the router's monotonic per-session seq.

import { route } from '../../ui/web/console/chat/router.js';
import { map } from './map.js';

export function emit(guiEvent) {
  const event = map(guiEvent); // E_UNKNOWN_GUI_EVENT / E_INVALID_ARGUMENT propagate
  const receipt = route(event.sessionId, event);
  return { routed: receipt.routed === true };
}

export default emit;
