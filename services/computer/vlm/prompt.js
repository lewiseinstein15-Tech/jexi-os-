// computer/vlm/prompt.js
// Phase 29 Scope E — the COMPUTER_USE system prompt (JEXI variant).
//
// Ported from TARS (bytedance/UI-TARS-desktop, Apache 2.0) COMPUTER_USE
// system prompt, adapted to JEXI's frozen action space. Scope A discipline
// applies: the action space block is RENDERED from
// computer/action/space.js (ACTIONS / actionNames / SCROLL_DIRECTIONS) —
// the vocabulary is never hardcoded twice. Adding an action to Scope A
// automatically extends this prompt; nothing to sync by hand.
//
// Declared here:
//   ACTION_LINES        — the rendered one-line syntax per frozen action
//   COMPUTER_USE_PROMPT — the full system prompt string (static by
//                         construction: two evaluations -> identical bytes)
//   buildSystemPrompt() — explicit accessor for the same string
//
// The prompt is prose + rendered action syntax only. It never invents an
// action, an arg kind, or a scroll direction outside the Scope A table.

import { ACTIONS, ACTION_SPACE_VERSION, actionNames } from '../action/space.js';

const BOX_LITERAL = "<|box_start|>(x,y)<|box_end|>";

function renderArg(name, spec) {
  if (spec.kind === 'box') return `${name}='${BOX_LITERAL}'`;
  if (spec.kind === 'enum') return `${name}='${spec.values.join('|')}'`;
  return `${name}='...'`;
}

function renderAction(name) {
  const specs = ACTIONS[name].args;
  const args = Object.keys(specs).map((argName) => renderArg(argName, specs[argName]));
  return `${name}(${args.join(', ')})`;
}

export const ACTION_LINES = Object.freeze(actionNames().map(renderAction));

export const ACTION_SPACE_VERSION_LINE = `Action Space ${ACTION_SPACE_VERSION}`;

export const COMPUTER_USE_PROMPT = [
  'You are a GUI agent operating a computer. You are given the current screenshot and one task instruction. Decide the SINGLE next action to take.',
  '',
  '# Output Format',
  'Output exactly ONE action line from the action space below, optionally preceded by one short Thought line. No other text, no markdown, no numbering.',
  '',
  `# ${ACTION_SPACE_VERSION_LINE}`,
  ...ACTION_LINES,
  '',
  '# Rules',
  '- Execute the user request step by step. Exactly one action per step.',
  '- The screenshot is the current screen state. Ground every coordinate in what is actually visible.',
  '- Coordinates are emitted in the model coordinate space; the runtime normalizes them to screen pixels. Do not rescale manually.',
  '- Scroll to reveal content before claiming it is absent.',
  '- Use wait when the screen needs time to settle; repeat an action only when the screen changed in a way that justifies it.',
  '- Use finished exactly when the user request is fully satisfied.',
  '- If the next step is genuinely unclear, prefer wait over guessing an action.',
].join('\n');

export function buildSystemPrompt() {
  return COMPUTER_USE_PROMPT;
}
