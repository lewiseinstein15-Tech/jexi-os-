/**
 * CommandTrace — shell-command execution → chat narration seam (P11 B3/B4).
 *
 * When the agent runs ANY shell command (term_execute, the persistent bash,
 * the capability runners' script exec, any NativeCommand call), the
 * execution is traced here and /api/chat relays it to the browser as
 * NDJSON `command` events, rendered INLINE by the TerminalBlock:
 *
 *   { type: 'command', status: 'running', id, cmd, source }
 *   { type: 'command', status: 'delta',  id, stream: 'stdout'|'stderr', chunk }
 *   { type: 'command.done', id, exit, duration_ms, stdout, stderr, source }
 *
 * Honest rules: events are emitted ONLY around real process executions —
 * nothing is synthesized for paths that never ran a shell. The seam is
 * fail-soft: a missing subscriber or a throwing listener can never break
 * the command itself.
 *
 * Scoping: /api/chat subscribes for the duration of one turn and
 * unsubscribes at the terminal event. Commands fired by background jobs
 * while no turn is open are simply not streamed (no fake narration).
 */

import crypto from 'crypto';

const listeners = new Set();

/** Subscribe to command traces. Returns an unsubscribe function. */
export function onCommandTrace(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(evt) {
  for (const fn of listeners) {
    try { fn(evt); } catch { /* a broken listener never breaks the command */ }
  }
}

/** A stable short id so running/delta/done events pair up in the UI. */
export function newCommandId() {
  return `cmd-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Wrap a real spawn-style execution: emits running → deltas → done around
 * the child's stdout/stderr. The caller owns the actual process; this only
 * narrates what really happened. `run` receives the trace callbacks.
 */
export async function traceCommand({ cmd, source = 'shell', run }) {
  const id = newCommandId();
  const t0 = Date.now();
  emit({ status: 'running', id, cmd: String(cmd || ''), source });
  let stdout = '';
  let stderr = '';
  const push = (stream, chunk) => {
    const text = String(chunk || '');
    if (!text) return;
    if (stream === 'stdout') stdout += text; else stderr += text;
    emit({ status: 'delta', id, stream, chunk: text });
  };
  try {
    const res = await run({ onStdout: (c) => push('stdout', c), onStderr: (c) => push('stderr', c) });
    const exit = res && typeof res.exit === 'number' ? res.exit : (res && res.ok === false ? 1 : 0);
    const out = res && typeof res.stdout === 'string' ? res.stdout : stdout;
    const err = res && typeof res.stderr === 'string' ? res.stderr : stderr;
    emit({ status: 'done', id, exit, duration_ms: Date.now() - t0, stdout: out, stderr: err, source });
    return res;
  } catch (e) {
    emit({ status: 'done', id, exit: 1, duration_ms: Date.now() - t0, stdout, stderr: String((e && e.message) || e), source });
    throw e;
  }
}

/** Simplest trace: narrate an already-buffered execution (runNativeCommand
 * style). `exec` must return { ok, stdout, stderr, code, durationMs }. */
export async function traceBufferedCommand({ cmd, source = 'shell', exec }) {
  const id = newCommandId();
  const t0 = Date.now();
  emit({ status: 'running', id, cmd: String(cmd || ''), source });
  try {
    const res = await exec();
    const ok = Boolean(res && (res.ok === true || res.code === 0));
    const stdout = String((res && res.stdout) || '');
    const stderr = String((res && res.stderr) || '');
    emit({ status: 'done', id, exit: res && typeof res.code === 'number' ? res.code : (ok ? 0 : 1), duration_ms: typeof (res && res.durationMs) === 'number' ? res.durationMs : Date.now() - t0, stdout, stderr, source });
    return res;
  } catch (e) {
    emit({ status: 'done', id, exit: 1, duration_ms: Date.now() - t0, stdout: '', stderr: String((e && e.message) || e), source });
    throw e;
  }
}
