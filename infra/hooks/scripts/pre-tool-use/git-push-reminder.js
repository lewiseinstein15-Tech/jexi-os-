#!/usr/bin/env node
/**
 * JEXI OS — Phase 7(B) hook — git-push-reminder (PreToolUse, warn-only).
 *
 * Fires when a `git push` is about to run and reminds the operator to review
 * what is being pushed. Never blocks (exit 0 always); stdout lands in the
 * hook log and is surfaced by the kernel runner.
 */

const raw = await new Promise((resolve) => {
  let buf = '';
  process.stdin.on('data', (c) => { buf += c; });
  process.stdin.on('end', () => resolve(buf));
});

let ctx = {};
try { ctx = JSON.parse(raw || '{}'); } catch { /* empty context */ }
const cmd = String(ctx?.args?.command ?? '');

const GIT_PUSH = /\bgit\b[^|;]*\bpush\b/;

if (GIT_PUSH.test(cmd)) {
  console.log(`[git-push-reminder] about to push — review before you ship:`);
  console.log(`[git-push-reminder]   git diff --cached --stat   # what's staged`);
  console.log(`[git-push-reminder]   git log --oneline origin/main..HEAD   # commits going out`);
  console.log(`[git-push-reminder]   git status --porcelain     # nothing unintended left behind`);
} else {
  console.log(`[git-push-reminder] "${cmd || '(no command)'}" — not a push, nothing to check.`);
}
process.exit(0);
