import { NavIcon } from './icons';
import { useHud } from './ConsoleApp';
import { brainPost } from '../../services/brain';
import { useState } from 'react';

/* <TopBar /> — Phase 7(F): EVERY stat renders from the HUD payload
   (jexi.hud-status.v1) — the single source of truth served by
   GET /api/hud and pushed live by SSE /api/hud/stream.

   context  → hud.context (model, provider, pressure, tokens)
   cost     → hud.cost (sessionUsd / budgetUsd / trend)
   checks   → hud.checks (local / remote)
   risk     → hud.risk.attention pill
   agents   → hud.activeAgents · todos → hud.todos · queue → hud.queueState
   controls → hud.sessionControls (canPause/canStop/canRestart/mode)

   A section missing from the payload renders "no data" — this bar cannot
   display a status the contract does not carry (probe P7). Uptime and
   provider-key lists are gone on purpose: they are not in the payload. */

const NO_DATA = 'no data';

function hudVal(section) {
  return section == null ? null : section; // undefined/absent → null → "no data"
}

export default function TopBar({ elapsed, onMenu }) {
  const { hud, connected, error } = useHud();
  const [busy, setBusy] = useState(false);

  const ctx = hudVal(hud?.context);
  const cost = hudVal(hud?.cost);
  const checks = hudVal(hud?.checks);
  const risk = hudVal(hud?.risk);
  const agents = hudVal(hud?.activeAgents);
  const todos = hudVal(hud?.todos);
  const queue = hudVal(hud?.queueState);
  const controls = hudVal(hud?.sessionControls);
  const toolCalls = hudVal(hud?.toolCalls);

  const title = (todos || []).find((t) => t.status === 'active')?.text
    || (hud?.missionId ? `Mission ${String(hud.missionId).slice(0, 10)}…` : 'JEXI OS Brain — standing by');
  const status = connected ? ['run', 'Online'] : error ? ['warn', 'Syncing'] : ['warn', 'Waking'];

  const pressurePct = ctx ? `${Math.round((Number(ctx.contextPressure) || 0) * 100)}%` : NO_DATA;
  const tokens = ctx ? `${ctx.tokensUsed}/${ctx.tokensCap} tok` : NO_DATA;
  const costLabel = cost ? `$${Number(cost.sessionUsd).toFixed(4)} / $${Number(cost.budgetUsd).toFixed(0)}` : NO_DATA;
  const trendMark = cost ? (cost.trend === 'up' ? ' ↗' : cost.trend === 'down' ? ' ↘' : ' →') : '';
  const agentCount = agents ? `${agents.length} seated` : NO_DATA;
  const activeTodos = todos ? `${todos.filter((t) => t.status === 'active').length} active / ${todos.length}` : NO_DATA;
  const queued = queue ? `${queue.missionsQueued + queue.toolsQueued + queue.verificationsQueued} queued` : NO_DATA;
  const modelLabel = ctx ? (ctx.model || 'unresolved') : NO_DATA;
  const provLabel = ctx ? (ctx.provider || '') : '';

  const mode = controls ? controls.mode : NO_DATA;
  const missionId = hud?.missionId || null;
  const control = async (action) => {
    if (!missionId || busy) return;
    setBusy(true);
    try { await brainPost(`/api/missions/${missionId}/control`, { action }, 12000); } catch { /* the HUD will show the truth after the change */ }
    setBusy(false);
  };

  return (
    <header className="hud">
      {/* v0.10 — phone only (CSS): opens the off-canvas nav drawer */}
      <button type="button" className="hudburger" aria-label="Menu" onClick={onMenu}>
        <i /><i /><i />
      </button>
      <div className="title">{title}</div>
      <span className={`pill ${status[0]}`}><span className="dot" />{status[1]}</span>
      <span className={`pill ${mode === 'agent' ? 'run' : mode === 'plan' ? 'info' : 'warn'}`}>{mode}</span>
      <div className="sep" />
      <div className="stat"><label>Elapsed</label><b>{elapsed}</b></div>
      <div className="stat"><label>Context</label><b className={(Number(ctx?.contextPressure) || 0) > 0.8 ? 'err' : 'acc'}>{pressurePct}</b><small>{tokens}</small></div>
      <div className="stat"><label>Model</label><b>{modelLabel}</b>{provLabel ? <small>{provLabel}</small> : null}</div>
      <div className="stat"><label>Cost</label><b className={cost && cost.trend === 'up' ? 'acc' : ''}>{costLabel}{trendMark}</b></div>
      <div className="stat"><label>Checks</label><b>{checks ? `${checks.local} · ${checks.remote}` : NO_DATA}</b></div>
      <div className="stat"><label>Risk</label><b className={risk && risk.attention !== 'normal' ? 'err' : ''}>{risk ? risk.attention : NO_DATA}</b></div>
      <div className="stat"><label>Tool calls</label><b>{toolCalls ? `${toolCalls.recent.length} recent${toolCalls.pending ? ` · ${toolCalls.pending} pending` : ''}` : NO_DATA}</b></div>
      <div className="stat"><label>Agents</label><b className="acc">{agentCount}</b></div>
      <div className="stat"><label>Tasks</label><b>{activeTodos}</b></div>
      <div className="stat"><label>Queue</label><b>{queued}</b></div>
      <div className="controls">
        {controls ? (
          <>
            <button
              type="button" className="ctl" disabled={!controls.canPause || busy}
              style={{ opacity: controls.canPause ? 1 : 0.4, cursor: controls.canPause ? 'pointer' : 'default' }}
              onClick={() => control('pause')}
            >
              <NavIcon name="check" />{controls.canPause ? 'pause' : 'idle'}
            </button>
            <button
              type="button" className="ctl" disabled={!controls.canStop || busy}
              style={{ opacity: controls.canStop ? 1 : 0.4, cursor: controls.canStop ? 'pointer' : 'default' }}
              onClick={() => control('cancel')}
            >
              <NavIcon name="check" />stop
            </button>
            <button
              type="button" className="ctl" disabled={!controls.canRestart || busy}
              style={{ opacity: controls.canRestart ? 1 : 0.4, cursor: controls.canRestart ? 'pointer' : 'default' }}
              onClick={() => control('retry')}
            >
              <NavIcon name="check" />restart
            </button>
          </>
        ) : (
          <span className="ctl">{NO_DATA}</span>
        )}
      </div>
    </header>
  );
}
