import { useState } from 'react';

/**
 * components/transcript/TerminalBlock.jsx (P11 B1/B7 — NEW)
 *
 * The INLINE terminal: every REAL shell execution streamed from /api/chat
 * `command` NDJSON events (CommandTrace relay: backendAgent → mount
 * command-use row family → this block) renders here, in order, as it
 * happens — the Arena/Freebuff-style working trace:
 *
 *   ┌─ TERMINAL / COMMAND ──────────────────────┐
 *   │ $ <command>                    DONE 1.2s  │
 *   ├───────────────────────────────────────────┤
 *   │ <stdout, monospace, pre-wrap, NO trunc>   │
 *   │ <stderr in danger color if present>       │
 *   └───────────────────────────────────────────┘
 *
 * States: running (pulse chip, live output grows) → done (exit 0: `DONE ✓
 * <ms>`) / failed (exit ≠ 0: `FAILED ✗ <exit>`). Every byte rendered comes
 * from a real event — nothing is fabricated; output is NOT truncated by the
 * UI (the executor's own bounded-output contract is the only cap).
 */

export default function TerminalBlock({ command, state, output, error, ms, exit, streaming }) {
  const [open, setOpen] = useState(true);
  if (!command && !output && !error) return null;

  const failed = state === 'failed' || (typeof exit === 'number' && exit !== 0);
  const running = state === 'running' && !failed;
  const secs = typeof ms === 'number'
    ? (ms >= 10000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)
    : null;

  const st = running
    ? { cls: 'run', label: 'RUNNING …' }
    : failed
      ? { cls: 'fail', label: `FAILED ✗${typeof exit === 'number' && exit !== 0 ? ` ${exit}` : ''}` }
      : { cls: 'done', label: `DONE ✓${secs ? ` ${secs}` : ''}${typeof exit === 'number' && exit !== 0 ? ` · exit ${exit}` : ''}` };

  return (
    <div className={`jx-term is-${st.cls}` + (streaming ? ' is-streaming' : '')} data-rowtype="terminal">
      <div className="jx-term-head">
        <button type="button" className="jx-term-toggle" onClick={() => setOpen(!open)} aria-expanded={open} title={open ? 'collapse' : 'expand'}>
          <span className="jx-term-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
        </button>
        <span className="jx-term-ps" aria-hidden="true">$</span>
        <code className="jx-term-line">{command}</code>
        <span className={`jx-term-state jx-num is-${st.cls}`}>{st.label}</span>
      </div>
      {open && (
        <div className="jx-term-body" data-streaming={streaming ? 'true' : 'false'}>
          {output ? <pre className="jx-term-out">{output}</pre> : null}
          {error ? <pre className="jx-term-err">{error}</pre> : null}
          {running ? <span className="jx-cursor" aria-hidden="true" /> : null}
        </div>
      )}
    </div>
  );
}
