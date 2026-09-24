#!/usr/bin/env node
/**
 * JEXI OS — Phase 7(B) hook — tmux-reminder (PreToolUse, warn-only).
 *
 * Detects long-running commands and reminds the operator to run them inside
 * tmux. Never blocks (exit 0 always); its stdout lands in the hook log.
 */

const raw = await new Promise((resolve) => {
  let buf = '';
  process.stdin.on('data', (c) => { buf += c; });
  process.stdin.on('end', () => resolve(buf));
});

let ctx = {};
try { ctx = JSON.parse(raw || '{}'); } catch { /* empty context */ }
const cmd = String(ctx?.args?.command ?? '');

const LONG_RUNNING =
  /(^|[\s;&&(|])(sleep\s+\d+|watch\s|tail\s+-f|npm\s+(run\s+)?(dev|start)\b|pnpm\s+(run\s+)?dev\b|yarn\s+dev\b|vite\b|ping\s|top\b|htop\b|node\s+index\.js\b|python3?\s+-m\s+http\.server\b|docker\s+(logs\s+-f|attach)\b)/;

if (LONG_RUNNING.test(cmd)) {
  if (process.env.TMUX) {
    console.log(`[tmux-reminder] "${cmd}" is long-running — already inside tmux, good.`);
  } else {
    console.log(`[tmux-reminder] "${cmd}" looks long-running — consider tmux (tmux new -s <name>) so it survives disconnects.`);
  }
} else {
  console.log(`[tmux-reminder] "${cmd || '(no command)'}" — nothing to remind.`);
}
process.exit(0);
