import LogoTool from './LogoTool';
import ServerRow from './ServerRow'; // v0.7 — live brain address + status dot
import { NavIcon } from './icons';
import { NAV } from './consoleData';
import { useBrain, useHud } from './ConsoleApp';

/* <Sidebar /> — nav groups (Executive / Resources / Extensions), JEXI Market
   logo, server row + model footer.

   Phase 7(F): operational counts come from the HUD payload (agents seated,
   tasks, queue depth); management-domain counts (skills / plugins / mcp)
   stay on their own subsystem endpoints — they are not HUD contract state.
   The model row reads hud.context.model/provider — the contract's model
   selector surface. */
export default function Sidebar({ route, onNavigate, onHome, mobileOpen, onClose }) {
  const { fleet } = useBrain();
  const { hud } = useHud();

  const agents = hud?.activeAgents;
  const todos = hud?.todos;
  const queue = hud?.queueState;
  const ctx = hud?.context;

  const skillTotal = (fleet?.plugins?.plugins || []).reduce((a, p) => a + ((p.live && p.live.skills) || (p.contributes && p.contributes.tools) || 0), 0);
  const plugCount = fleet?.plugins?.plugins?.length;
  const mcpOn = (fleet?.mcpServers?.servers || []).filter((s) => s.enabled).length;
  const mcpTotal = (fleet?.mcpServers?.servers || []).length;
  const counts = {
    agents: agents ? String(agents.length) : '…',
    sessions: agents ? String(agents.filter((a) => a.state === 'working').length) : '…',
    skills: skillTotal ? String(skillTotal) : '…',
    plugins: plugCount != null ? String(plugCount) : '…',
    mcp: mcpTotal != null ? `${mcpOn}/${mcpTotal}` : '…',
    scheduler: queue ? String(queue.missionsQueued) : '…',
    missions: todos ? String(todos.length) : '…',
  };

  const modelLabel = ctx ? (ctx.model || 'unresolved') : (hud ? 'no data' : 'offline');
  const provLabel = ctx ? (ctx.provider || '') : '';
  const pressure = ctx ? Math.round((Number(ctx.contextPressure) || 0) * 100) : null;

  return (
    <aside className={mobileOpen ? 'open' : ''}>
      <LogoTool onHome={onHome} />

      {NAV.map((g) => (
        <nav className="navgroup" key={g.group}>
          <h4>{g.group}</h4>
          {g.items.map((it) => (
            <button
              key={it.id}
              type="button"
              data-view={it.id}
              className={`navitem${route === it.id ? ' active' : ''}`}
              onClick={() => onNavigate(it.id)}
            >
              <NavIcon name={it.icon} />
              {it.label}
              {it.isNew
                ? <span className="new">NEW</span>
                : (it.countKey ? <span className="count">{counts[it.countKey]}</span> : null)}
            </button>
          ))}
        </nav>
      ))}

      <div className="sidefoot">
        <ServerRow />
        <div className="modelrow">
          <NavIcon name="model" />
          <div>
            <div className="p">Model{provLabel ? ` · ${provLabel}` : ''}</div>
            <div className="m">{modelLabel}</div>
          </div>
          <span className="chev"><NavIcon name="chevdown" /></span>
        </div>
        <div className="onekey">
          <span className="dot" style={{ background: hud ? (hud.risk?.attention === 'normal' ? 'var(--jcx-up)' : hud.risk?.attention === 'warning' ? 'var(--jcx-gold)' : 'var(--jcx-down)') : 'var(--jcx-down)' }} />
          <span>
            <b>{hud ? `hud · rev live` : 'hud · no data'}</b>
            {pressure != null ? ` · context ${pressure}%` : ' · waiting for the first payload'}
          </span>
        </div>
      </div>
    </aside>
  );
}
