/**
 * B138 — TMUX CONTEXT (DeepSeek Harness `packages/context/tmux-context`
 * mirror, JEXI-branded).
 *
 * When JEXI runs inside a tmux session, the model gets a small context block
 * describing the session/pane so it understands its terminal home. Outside
 * tmux the block is empty (never injected). Environment-only: reads TMUX and
 * TMUX_PANE, never runs tmux commands (no child processes for context).
 */

/** Whether the current process lives inside a tmux session. */
export function inTmux(env = process.env) {
  return !!(env.TMUX && env.TMUX_PANE);
}

/** Render the tmux context block ('' when not inside tmux). */
export function tmuxContextBlock(env = process.env) {
  if (!inTmux(env)) return '';
  const session = String(env.TMUX || '').slice(0, 120);
  const pane = String(env.TMUX_PANE || '').slice(0, 40);
  return `\n\n[Terminal context: this server runs inside a tmux session (${session}, pane ${pane}). ` +
    'The user may be watching this terminal; long-running commands keep the session alive.]';
}

/** Status for diagnostics. */
export function tmuxStatus(env = process.env) {
  return {
    ok: true,
    inTmux: inTmux(env),
    session: inTmux(env) ? String(env.TMUX || '').slice(0, 120) : null,
    pane: inTmux(env) ? String(env.TMUX_PANE || '').slice(0, 40) : null,
  };
}
