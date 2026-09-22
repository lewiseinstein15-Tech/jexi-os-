// computer/action/space.js
// Phase 29 Scope A — the unified action space.
//
// Ported from TARS (bytedance/UI-TARS-desktop, Apache 2.0), COMPUTER_USE
// system prompt. FROZEN in v1: exactly these nine actions, in this order.
// There is no runtime extension path — adding an action is a versioned
// schema change, not a patch. Everything downstream (parser, serializer,
// VLM prompt template, GUI loop) reads this table; nothing hardcodes the
// vocabulary twice.
//
// Arg kinds:
//   'box'    coordinate argument; the literal may be EITHER accepted form:
//            (1) tagged point  <|box_start|>(x,y)<|box_end|>
//            (2) bracket box   [x1,y1,x2,y2]  -> normalized to its center
//   'string' plain string, no escape processing (hotkey key names)
//   'text'   escaped string; serializer escapes \ -> \\, ' -> \', " -> \",
//            newline -> \n (TARS type() discipline); parser reverses it
//   'enum'   membership-validated string (scroll direction)
//   optional:true  the arg may be absent (finished.content defaults to '')

export const ACTION_SPACE_VERSION = 'v1-frozen';

export const SCROLL_DIRECTIONS = Object.freeze(['up', 'down', 'left', 'right']);

export const ACTIONS = Object.freeze({
  click: Object.freeze({
    args: Object.freeze({ start_box: Object.freeze({ kind: 'box' }) }),
  }),
  left_double: Object.freeze({
    args: Object.freeze({ start_box: Object.freeze({ kind: 'box' }) }),
  }),
  right_single: Object.freeze({
    args: Object.freeze({ start_box: Object.freeze({ kind: 'box' }) }),
  }),
  drag: Object.freeze({
    args: Object.freeze({
      start_box: Object.freeze({ kind: 'box' }),
      end_box: Object.freeze({ kind: 'box' }),
    }),
  }),
  hotkey: Object.freeze({
    args: Object.freeze({ key: Object.freeze({ kind: 'string', minLength: 1 }) }),
  }),
  type: Object.freeze({
    args: Object.freeze({ content: Object.freeze({ kind: 'text' }) }),
  }),
  scroll: Object.freeze({
    args: Object.freeze({
      start_box: Object.freeze({ kind: 'box' }),
      direction: Object.freeze({ kind: 'enum', values: SCROLL_DIRECTIONS }),
    }),
  }),
  wait: Object.freeze({
    args: Object.freeze({}),
  }),
  finished: Object.freeze({
    args: Object.freeze({
      content: Object.freeze({ kind: 'text', optional: true, default: '' }),
    }),
  }),
});

/** The frozen vocabulary, in declaration order. */
export function actionNames() {
  return Object.keys(ACTIONS);
}

/** Arg schema for one action (or undefined for unknown names). */
export function actionSchema(name) {
  return ACTIONS[name];
}
