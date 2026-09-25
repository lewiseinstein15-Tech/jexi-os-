import { Fragment } from 'react';
import { Bot, TriangleAlert } from 'lucide-react';
import ThinkingBlock from './ThinkingBlock.jsx';
import StepList from './StepList.jsx';
import CommandBlock from './CommandBlock.jsx';
import ToolCallBlock from './ToolCallBlock.jsx';
import FinalAnswer from './FinalAnswer.jsx';
import TurnFooter from './TurnFooter.jsx';

/**
 * components/transcript/Transcript.jsx (ui-rebuild-premium-v2) — ORCHESTRATOR
 *
 * Arena/Freebuff-style agent trace, rendered from the SAME mount.js rows
 * contract as the previous transcripts (zero runtime changes, zero backend
 * changes). Every block traces to a real event:
 *
 *   narration.line (recon)            -> ThinkingBlock   (streamed, collapsible)
 *   narration.line (decision)         -> StepList plan section (pending)
 *   narration.line (progress/finding) -> StepList executed steps
 *   tool.started/completed/failed     -> ToolCallBlock / CommandBlock (/gui)
 *   message.delta (merged, jexi)      -> FinalAnswer (streaming -> final)
 *   message.delta (user)              -> right-aligned minimal user message
 *   turn.completed                    -> TurnFooter (real wall-clock ms)
 *
 * Honest rules: a block that has no corresponding event simply does not
 * render; unknown row types render as muted system lines; nothing is faked.
 */

function oneLine(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

function parsePlan(text) {
  // decision narration format (backendAgent): "plan · N steps" + "\n1. step"
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const header = lines[0] || 'plan';
  const steps = lines.slice(1)
    .map((l) => l.replace(/^\d+\.\s*/, ''))
    .filter(Boolean);
  return { header, steps };
}

function groupTurns(rows) {
  const turns = [];
  let cur = null;
  for (const r of rows) {
    const tid = r.turnId == null ? '__local__' : r.turnId;
    if (!cur || cur.turnId !== tid) {
      cur = { turnId: tid, rows: [] };
      turns.push(cur);
    }
    cur.rows.push(r);
  }
  return turns;
}

function TurnGroup({ turn, isLast, onApprove }) {
  const items = [];
  const active = isLast && !turn.rows.some((r) => r.rowType === 'turn-end-ok' || r.rowType === 'turn-end-fail');

  let i = 0;
  while (i < turn.rows.length) {
    const r = turn.rows[i];

    // ---- user message ------------------------------------------------
    if (r.rowType === 'text' && r.voice === 'user') {
      items.push(
        <div key={r.seq ?? `u${i}`} className="jx-ta-user">
          <div className="jx-ta-user-bubble">{r.content}</div>
        </div>
      );
      i += 1;
      continue;
    }

    // ---- thinking (consecutive recon rows merge) ----------------------
    if (r.rowType === 'narration' && r.narrationType === 'recon') {
      let text = r.content;
      const t0 = r.t;
      let j = i + 1;
      while (j < turn.rows.length && turn.rows[j].rowType === 'narration' && turn.rows[j].narrationType === 'recon') {
        text += turn.rows[j].content;
        j += 1;
      }
      const t1 = j < turn.rows.length ? turn.rows[j].t : null;
      items.push(
        <ThinkingBlock key={`think-${r.seq ?? i}`} text={text} t0={t0} t1={t1}
          streaming={active && j >= turn.rows.length} />
      );
      i = j;
      continue;
    }

    // ---- steps: decision (plan) + following progress/finding ----------
    if (r.rowType === 'narration' && (r.narrationType === 'decision' || r.narrationType === 'progress' || r.narrationType === 'finding' || r.narrationType === 'correction')) {
      const planSteps = [];
      const executed = [];
      let j = i;
      while (j < turn.rows.length && turn.rows[j].rowType === 'narration'
        && ['decision', 'progress', 'finding', 'correction'].includes(turn.rows[j].narrationType)) {
        const n = turn.rows[j];
        if (n.narrationType === 'decision') {
          const p = parsePlan(n.content);
          planSteps.push(...p.steps);
        } else {
          const raw = oneLine(n.content);
          const m = raw.match(/^([^:]{1,24}):\s+(.+)$/); // "Agent: message" from server log events
          executed.push(m ? { agent: m[1], text: m[2] } : { agent: null, text: raw });
        }
        j += 1;
      }
      items.push(
        <StepList key={`steps-${r.seq ?? i}`} planSteps={planSteps} steps={executed} streaming={active} />
      );
      i = j;
      continue;
    }

    // ---- tool rows (pair started with its result/error) ----------------
    if (r.rowType === 'tool-use' || r.rowType === 'tool-result' || r.rowType === 'tool-error') {
      let parsed = null;
      if (r.raw) { try { parsed = JSON.parse(r.raw); } catch { /* raw is display text */ } }

      // /gui dispatch rows carry {command} -> terminal-style block
      if (parsed && typeof parsed.command === 'string') {
        const next = turn.rows[i + 1];
        const failed = next && next.rowType === 'tool-error';
        const done = next && next.rowType === 'tool-result';
        const out = next ? oneLine(next.content) : '';
        const ms = next && r.t ? Math.round((next.t - r.t) / 100) / 10 : null;
        items.push(
          <CommandBlock key={`cmd-${r.seq ?? i}`} command={parsed.command + (parsed.task ? ` ${oneLine(parsed.task)}` : '')}
            state={failed ? 'failed' : done ? 'done' : 'running'}
            output={!failed ? out : ''} error={failed ? out : ''} ms={ms} />
        );
        i += next ? 2 : 1;
        continue;
      }

      const next = turn.rows[i + 1];
      const isRes = next && (next.rowType === 'tool-result' || next.rowType === 'tool-error');
      items.push(
        <ToolCallBlock key={`tool-${r.seq ?? i}`} name={r.toolName}
          params={r.raw || null}
          result={isRes ? oneLine(next.content) : null}
          state={r.rowType === 'tool-error' ? 'failed' : isRes ? (next.rowType === 'tool-error' ? 'failed' : 'completed') : 'running'}
          ms={isRes && r.t ? Math.round((next.t - r.t)) : null} />
      );
      i += isRes ? 2 : 1;
      continue;
    }

    // ---- the answer (merged stream deltas) -----------------------------
    if (r.rowType === 'text' && r.type === 'message.delta' && r.voice === 'jexi') {
      items.push(
        <FinalAnswer key={r.seq ?? `a${i}`} content={r.content} streaming={!!r.streaming} />
      );
      i += 1;
      continue;
    }

    // ---- approvals -----------------------------------------------------
    if (r.rowType === 'approval') {
      const open = r.type === 'approval.requested';
      items.push(
        <div key={r.seq ?? `ap${i}`} className="jx-ta-approval" data-rowtype={r.rowType}>
          <TriangleAlert size={13} aria-hidden="true" />
          <span>{r.content}</span>
          {open && r.approvalId && (
            <span className="jx-ta-approval-actions">
              <button type="button" className="jx-btn jx-btn-primary" style={{ height: 26, padding: '0 12px' }} onClick={() => onApprove(r.approvalId, 'yes')}>approve</button>
              <button type="button" className="jx-btn" style={{ height: 26, padding: '0 12px' }} onClick={() => onApprove(r.approvalId, 'no')}>deny</button>
            </span>
          )}
        </div>
      );
      i += 1;
      continue;
    }

    // ---- turn footer ----------------------------------------------------
    if (r.rowType === 'turn-end-ok' || r.rowType === 'turn-end-fail') {
      const ok = r.rowType === 'turn-end-ok';
      const m = String(r.content || '').match(/·\s*([\d,]+)\s*ms/);
      const ms = m ? Number(m[1].replace(/,/g, '')) : null;
      items.push(
        <TurnFooter key={r.seq ?? `f${i}`} turnId={turn.turnId} ms={ms} ok={ok}
          failReason={ok ? null : oneLine(r.content).replace(/^.*?·\s*/, '').replace(/\s*·\s*[\d,]+ ms$/, '')} />
      );
      i += 1;
      continue;
    }

    // ---- refusals --------------------------------------------------------
    if (r.refused) {
      items.push(
        <div key={r.seq ?? `rf${i}`} className="jx-ta-refused" data-rowtype={r.rowType}>
          {r.content}{r.refuseReason ? ` — ${r.refuseReason} (plan mode is read-only)` : ''}
        </div>
      );
      i += 1;
      continue;
    }

    // ---- everything else: muted system line ------------------------------
    items.push(
      <div key={r.seq ?? `sys${i}`} className="jx-ta-sys" data-rowtype={r.rowType}>
        {oneLine(r.content) || JSON.stringify(r).slice(0, 160)}
      </div>
    );
    i += 1;
  }

  return <div className="jx-ta-turn">{items}</div>;
}

export default function Transcript({ rows, onApprove }) {
  const turns = groupTurns(rows || []);
  return (
    <div className="jx-transcript jx-transcript-v2" role="log" aria-live="polite">
      {rows.length === 0 ? (
        <div className="jx-empty">
          <div className="jx-empty-frame" aria-hidden="true"><Bot size={22} /></div>
          <div className="jx-empty-title">chat</div>
          <div className="jx-empty-note jx-prose">
            Messages render here from the real model pipeline (POST /api/chat →
            provider bridge → NDJSON stream). Each turn shows the agent trace:
            thinking → steps → tool blocks (when the turn emits them) → the
            streamed answer → turn footer. Queue and steer hold messages while
            a turn is active.
          </div>
        </div>
      ) : (
        turns.map((t, idx) => (
          <Fragment key={t.turnId + ':' + idx}>
            <TurnGroup turn={t} isLast={idx === turns.length - 1} onApprove={onApprove} />
          </Fragment>
        ))
      )}
    </div>
  );
}
