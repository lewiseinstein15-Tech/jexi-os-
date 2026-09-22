/**
 * Phase 24 Scope B — transcript: renders rows produced by mount.js from
 * REAL Phase 16 router envelopes (rows.render taxonomy output). No mocks.
 * Scope C: applies the router's declarative rowOverride (display-mode
 * verbosity) to tool bodies — read-only consumption of envelope.modes.
 */
function clip(text, verb) {
  if (!verb) return text;
  let t = String(text == null ? '' : text);
  if (typeof verb.maxChars === 'number' && t.length > verb.maxChars) {
    t = t.slice(0, verb.maxChars) + '…';
  }
  if (typeof verb.maxLines === 'number' && verb.maxLines > 0) {
    t = t.split('\n').slice(0, verb.maxLines).join('\n');
  }
  return t;
}

export default function Transcript({ rows, onApprove }) {
  return (
    <div className="p24-transcript" role="log" aria-live="polite">
      {rows.length === 0 ? (
        <div className="p24-empty">
          <div className="p24-empty-frame" aria-hidden="true"></div>
          <div className="p24-empty-title">Chat</div>
          <div className="p24-empty-note">rows render here from the Phase 16 runtime</div>
        </div>
      ) : (
        rows.map((r, i) => {
          if (r.refused) {
            return (
              <div key={i} className={'p24-row p24-refused'} data-rowtype={r.rowType}>
                <span className="p24-row-chip">refused</span>
                <span className="p24-row-text">
                  {r.content}
                  {r.refuseReason ? ' — ' + r.refuseReason + ' (plan mode is read-only)' : ''}
                </span>
              </div>
            );
          }
          if (r.rowType === 'tool-use' || r.rowType === 'tool-result' || r.rowType === 'tool-error') {
            const hidden = r.verb && r.verb.showArgs === false;
            return (
              <div key={i} className={'p24-row p24-toolcard ' + r.rowType} data-rowtype={r.rowType}>
                <div className="p24-tool-head">
                  <span className="p24-tool-name">{r.rowType === 'tool-use' ? 'tool' : r.rowType === 'tool-result' ? 'result' : 'tool error'}</span>
                  <span className="p24-tool-state">{r.type}</span>
                </div>
                {hidden
                  ? <div className="p24-tool-body p24-tool-hidden">args hidden ({(r.verb && 'inline') || ''} display mode)</div>
                  : <div className="p24-tool-body">{clip(r.raw || r.content, r.verb)}</div>}
              </div>
            );
          }
          if (r.rowType === 'turn-end-ok' || r.rowType === 'turn-end-fail') {
            const ok = r.rowType === 'turn-end-ok';
            return (
              <div key={i} className={'p24-row p24-turnend ' + (ok ? 'ok' : 'fail')} data-rowtype={r.rowType}>
                <span className="p24-turnend-dot" aria-hidden="true"></span>
                <span className="p24-row-text">{r.content}</span>
              </div>
            );
          }
          if (r.rowType === 'approval') {
            const open = r.type === 'approval.requested';
            return (
              <div key={i} className="p24-row p24-approval" data-rowtype={r.rowType}>
                <span className="p24-row-chip">approval</span>
                <span className="p24-row-text">{r.content}</span>
                {open && r.approvalId && (
                  <span className="p24-approval-actions">
                    <button className="p24-approve" onClick={() => onApprove(r.approvalId, 'yes')}>approve</button>
                    <button className="p24-deny" onClick={() => onApprove(r.approvalId, 'no')}>deny</button>
                  </span>
                )}
              </div>
            );
          }
          if (r.rowType === 'narration') {
            return (
              <div key={i} className="p24-row p24-narration" data-rowtype={r.rowType}>
                <span className="p24-row-chip">jexi</span>
                <span className="p24-row-text">{r.content}</span>
              </div>
            );
          }
          if (r.rowType === 'text') {
            return (
              <div key={i} className="p24-row p24-text" data-rowtype={r.rowType}>
                <span className="p24-row-text">{r.content}</span>
              </div>
            );
          }
          return (
            <div key={i} className="p24-row p24-other" data-rowtype={r.rowType}>
              <span className="p24-row-chip">{r.rowType}</span>
              <span className="p24-row-text">{r.content}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
