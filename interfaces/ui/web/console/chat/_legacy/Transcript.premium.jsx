import { Fragment } from 'react';
import { Bot, ChevronRight, TriangleAlert, Wrench } from 'lucide-react';

/**
 * Premium transcript (ui-rebuild-premium). Consumes the SAME rows contract
 * as the Phase 24 Transcript (mount.js store.rows), plus a `voice` tag
 * ('user' | 'jexi') that mount.js derives from the runtime's messageId
 * contract (msg-<turnId>-user vs msg-<turnId>-N). Rendering upgrades:
 *   - user messages right-aligned accent bubbles, JEXI left with avatar
 *   - tool calls as <details> cards (name + state + payload, collapsible)
 *   - turn footer centered: "turn completed: <id> · <ms>"
 *   - approvals inline with approve/deny, refusals honest
 * No mocks: rows render exactly what the router delivered.
 */

function ToolState({ state }) {
  const fail = /fail|error|denied|refus/i.test(String(state || ''));
  const ok = /completed|ok|resolved/i.test(String(state || ''));
  const cls = fail ? 'is-fail' : ok ? 'is-ok' : 'is-run';
  return <span className={'jx-tool-state ' + cls}>{state || '—'}</span>;
}

function ToolCard({ r }) {
  const fail = r.rowType === 'tool-error';
  const state = fail ? 'failed' : r.rowType === 'tool-result' ? 'completed' : r.type;
  const body = r.raw || r.content || '';
  return (
    <details className={'jx-toolcard' + (fail ? ' is-fail' : '')}>
      <summary>
        <Wrench size={12} aria-hidden="true" />
        <span className="jx-tool-name">{r.toolName || (r.rowType === 'tool-result' ? 'result' : 'tool')}</span>
        <span className="jx-tool-kind">{r.rowType === 'tool-result' ? 'result' : r.rowType === 'tool-error' ? 'error' : 'call'}</span>
        <ToolState state={state} />
        <ChevronRight size={12} className="jx-tool-chevron" aria-hidden="true" />
      </summary>
      <div className="jx-tool-body">{typeof body === 'string' ? body : JSON.stringify(body)}</div>
    </details>
  );
}

export default function Transcript({ rows, onApprove }) {
  return (
    <div className="jx-transcript" role="log" aria-live="polite">
      {rows.length === 0 ? (
        <div className="jx-empty">
          <div className="jx-empty-frame" aria-hidden="true">
            <Bot size={22} />
          </div>
          <div className="jx-empty-title">Chat</div>
          <div className="jx-empty-note">
            Messages render here from the real model pipeline (POST /api/chat →
            provider bridge → NDJSON stream). Queue and steer hold messages
            while a turn is active.
          </div>
        </div>
      ) : (
        rows.map((r, i) => {
          const key = r.seq != null ? r.seq : `local-${i}`;

          if (r.refused) {
            return (
              <div key={key} className="jx-refused" data-rowtype={r.rowType}>
                {r.content}
                {r.refuseReason ? ' — ' + r.refuseReason + ' (plan mode is read-only)' : ''}
              </div>
            );
          }

          if (r.rowType === 'tool-use' || r.rowType === 'tool-result' || r.rowType === 'tool-error') {
            return <ToolCard key={key} r={r} />;
          }

          if (r.rowType === 'turn-end-ok' || r.rowType === 'turn-end-fail') {
            const ok = r.rowType === 'turn-end-ok';
            return (
              <div key={key} className={'jx-turnend' + (ok ? '' : ' fail')} data-rowtype={r.rowType}>
                <span className="jx-turnend-dot" aria-hidden="true"></span>
                <span>{r.content}</span>
              </div>
            );
          }

          if (r.rowType === 'approval') {
            const open = r.type === 'approval.requested';
            return (
              <div key={key} className="jx-approval" data-rowtype={r.rowType}>
                <TriangleAlert size={14} aria-hidden="true" />
                <span>{r.content}</span>
                {open && r.approvalId && (
                  <span className="jx-approval-actions">
                    <button className="jx-btn jx-btn-primary" style={{ height: 26, padding: '0 12px' }} onClick={() => onApprove(r.approvalId, 'yes')}>approve</button>
                    <button className="jx-btn" style={{ height: 26, padding: '0 12px' }} onClick={() => onApprove(r.approvalId, 'no')}>deny</button>
                  </span>
                )}
              </div>
            );
          }

          if (r.rowType === 'narration') {
            return (
              <div key={key} className="jx-msg jx-msg-jexi" data-rowtype={r.rowType}>
                <span className="jx-avatar" aria-hidden="true"><Bot size={15} /></span>
                <div className="jx-msg-body">
                  <div className="jx-bubble">{r.content}</div>
                  {r.chip ? <span className="jx-msg-chip">{r.chip}</span> : null}
                </div>
              </div>
            );
          }

          if (r.rowType === 'text') {
            if (r.voice === 'user') {
              return (
                <div key={key} className="jx-msg jx-msg-user" data-rowtype={r.rowType}>
                  <div className="jx-bubble">{r.content}</div>
                </div>
              );
            }
            return (
              <Fragment key={key}>
                <div className="jx-msg jx-msg-jexi" data-rowtype={r.rowType}>
                  <span className="jx-avatar" aria-hidden="true"><Bot size={15} /></span>
                  <div className="jx-msg-body">
                    <div className="jx-bubble">{r.content}</div>
                    {r.streaming ? <span className="jx-msg-chip">streaming…</span> : null}
                  </div>
                </div>
              </Fragment>
            );
          }

          return (
            <div key={key} className="jx-row-text" data-rowtype={r.rowType}>
              {r.content}
            </div>
          );
        })
      )}
    </div>
  );
}
