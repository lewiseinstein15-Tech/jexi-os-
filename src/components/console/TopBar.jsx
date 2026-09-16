import { NavIcon } from './icons';
import { HUD } from './consoleData';

/* <TopBar /> — the ECC HUD Status Contract in one row, exactly as the
   approved preview: mission title, status pill, elapsed / context / tool
   calls / agents / todos / checks / cost / tokens / risk / queue, controls. */
export default function TopBar({ elapsed }) {
  return (
    <header className="hud">
      <div className="title">{HUD.title}</div>
      <span className={`pill ${HUD.status}`}><span className="dot" />{HUD.statusLabel}</span>
      <div className="sep" />
      <div className="stat"><label>Elapsed</label><b>{elapsed}</b></div>
      <div className="stat"><label>Context</label><b className={HUD.contextTone}>{HUD.context}</b></div>
      <div className="stat"><label>Tool calls</label><b>{HUD.toolCalls}</b></div>
      <div className="stat"><label>Agents</label><b className={HUD.agentsTone}>{HUD.agents}</b></div>
      <div className="stat"><label>Todos</label><b>{HUD.todos}</b></div>
      <div className="stat"><label>Checks</label><b>{HUD.checks}</b></div>
      <div className="stat"><label>Cost</label><b>{HUD.cost}</b></div>
      <div className="stat"><label>Tokens</label><b>{HUD.tokens}</b></div>
      <div className="stat"><label>Risk</label><b className={HUD.riskTone}>{HUD.risk}</b></div>
      <div className="stat"><label>Queue</label><b>{HUD.queue}</b></div>
      <div className="controls">
        <span className="ctl"><NavIcon name="pause" />Pause</span>
        <span className="ctl stop"><NavIcon name="stop" />Stop</span>
      </div>
    </header>
  );
}
