/**
 * B102 — AGENT PRESETS (mirror of DeepSeek Harness `agent-presets`:
 * Standard / PTC / Minimal / Creator).
 *
 * A preset is the agent's default presentation:
 *   standard — native tool-calling only (no run_code SDK)
 *   ptc      — code mode: native tools + run_code + the generated TS SDK
 *   minimal  — direct answers, no planner, no tools (ChatGPT-style)
 *   creator  — code mode + a creative-expressiveness flavor line
 *
 * The chat/agent routes resolve the `x-jexi-preset` header (an explicit
 * x-jexi-mode / x-jexi-code-mode header always overrides the preset).
 */

/** The four DSH presets, with their JEXI mappings. */
export const PRESETS = {
  standard: {
    label: 'Standard',
    description: 'Native tool-calling loop — the model calls tools directly, one call per action.',
    mode: 'agent',
    codeMode: false,
    flavor: '',
  },
  ptc: {
    label: 'PTC',
    description: 'Code Mode — the model may write ONE TypeScript program composing the tools (DeepSeek Harness PTC preset).',
    mode: 'agent',
    codeMode: true,
    flavor: 'You are in PTC (program-to-code) mode: for multi-step work you may write a single run_code program instead of many separate tool calls.',
  },
  minimal: {
    label: 'Minimal',
    description: 'Direct answers only — no planner, no tools, no agent team.',
    mode: 'normal',
    codeMode: false,
    flavor: '',
  },
  creator: {
    label: 'Creator',
    description: 'Code Mode + creative expressiveness — bold, vivid, original output.',
    mode: 'agent',
    codeMode: true,
    flavor: 'You are in Creator mode: be vivid, expressive and original in your answers while staying accurate; structure creative output for impact.',
  },
};

export const DEFAULT_PRESET = 'ptc';
export const PRESET_NAMES = Object.keys(PRESETS);

/** Resolve a preset name (safe — unknown/empty → the default). */
export function resolvePreset(name) {
  const key = String(name || '').trim().toLowerCase();
  return PRESETS[key] || PRESETS[DEFAULT_PRESET];
}

/** Resolve the preset from the request header, returning its full mapping. */
export function presetFromHeader(header) {
  return resolvePreset(String(header || ''));
}

/** The flavor line to inject into the system prompt for a preset. */
export function presetFlavor(name) {
  return resolvePreset(name).flavor;
}
