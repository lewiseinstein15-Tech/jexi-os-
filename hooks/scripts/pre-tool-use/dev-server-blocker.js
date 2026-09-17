#!/usr/bin/env node
/**
 * JEXI OS — Phase 7(B) hook — dev-server-blocker (PreToolUse, BLOCKING).
 *
 * Blocks `npm run dev` (and equivalent dev-server launches) executed OUTSIDE
 * tmux. Dev servers are long-lived; without tmux they die with the session.
 * Exit 0 = allow, exit 2 = block (the kernel denies the tool call).
 *
 * Stdin context (JSON): { event, tool, args: { command }, sessionId, agentId }
 */

const raw = await new Promise((resolve) => {
  let buf = '';
  process.stdin.on('data', (c) => { buf += c; });
  process.stdin.on('end', () => resolve(buf));
});

let ctx = {};
try { ctx = JSON.parse(raw || '{}'); } catch { /* empty context */ }
const cmd = String(ctx?.args?.command ?? '');

const DEV_SERVER =
  /(^|[\s;&&(|])(npm\s+(run\s+)?dev\b|npm\s+run\s+dev:full\b|pnpm\s+(run\s+)?dev\b|yarn\s+dev\b|vite\b(?!\S*config)|npm\s+start\b)/;

const insideTmux = Boolean(process.env.TMUX);

if (DEV_SERVER.test(cmd) && !insideTmux) {
  console.log(`[dev-server-blocker] BLOCKED "${cmd}" — dev servers are long-running and must live inside tmux so they survive the session. Re-run inside tmux (tmux new -s dev) .`);
  process.exit(2); // nonzero + exitBehavior:block → kernel blocks the tool call
}

if (DEV_SERVER.test(cmd) && insideTmux) {
  console.log(`[dev-server-blocker] allow "${cmd}" (inside tmux — safe).`);
} else {
  console.log(`[dev-server-blocker] allow "${cmd || '(no command)'}" (not a dev server).`);
}
process.exit(0);
