/**
 * components/transcript/CommandBlock.jsx (ui-rebuild-premium-v2)
 *
 * Terminal-style command block. Rendered ONLY from real rows: the /gui
 * chat-command dispatch path (mount.js guiDispatch) pushes a tool-use row
 * carrying {command: '/gui', ...} plus its real result/error row. A plain
 * /api/chat turn streams NO command events, so this block simply does not
 * render there — no fabricated shells.
 *
 *   ┌─────────────────────────────────────────┐
 *   │ $ <command>                  DONE ✓ 1.2s│
 *   ├─────────────────────────────────────────┤
 *   │ <output — mono, tabular>                │
 *   │ <stderr in --jx-danger>                 │
 *   └─────────────────────────────────────────┘
 */

export default function CommandBlock({ command, state, output, error, ms }) {
  if (!command) return null;
  const st =
    state === 'failed' ? { cls: 'fail', label: 'FAILED ✗' } :
    state === 'running' ? { cls: 'run', label: 'RUNNING …' } :
    { cls: 'done', label: `DONE ✓${ms ? ` ${ms}s` : ''}` };

  return (
    <div className={`jx-cmd is-${st.cls}`}>
      <div className="jx-cmd-head">
        <span className="jx-cmd-ps" aria-hidden="true">$</span>
        <code className="jx-cmd-line">{command}</code>
        <span className={`jx-cmd-state jx-num is-${st.cls}`}>{st.label}</span>
      </div>
      {(output || error) && (
        <div className="jx-cmd-body">
          {output ? <div className="jx-cmd-out">{output}</div> : null}
          {error ? <div className="jx-cmd-err">{error}</div> : null}
        </div>
      )}
    </div>
  );
}
