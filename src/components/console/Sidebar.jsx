import LogoTool from './LogoTool';
import ServerRow from './ServerRow'; // v0.7 — live brain address + status dot
import { NavIcon } from './icons';
import { NAV } from './consoleData';
import { useBrain } from './ConsoleApp';

/* <Sidebar /> — nav groups (Executive / Resources / Extensions), JEXI Market
   logo, server row + model footer. Counts are REAL now: every number comes
   from the live fleet snapshot (agents, plugins, mcp, scheduler…), and the
   model row shows the brain's actual active provider + model. */
export default function Sidebar({ route, onNavigate, onHome, mobileOpen, onClose }) {
  const { fleet, health, online } = useBrain();

  const agentCount = fleet?.agents?.count;
  const sessCount = fleet?.processes?.processes?.length;
  const skillTotal = (fleet?.plugins?.plugins || []).reduce((a, p) => a + ((p.live && p.live.skills) || (p.contributes && p.contributes.tools) || 0), 0);
  const plugCount = fleet?.plugins?.plugins?.length;
  const mcpOn = (fleet?.mcpServers?.servers || []).filter((s) => s.enabled).length;
  const mcpTotal = (fleet?.mcpServers?.servers || []).length;
  const jobCount = fleet?.scheduler?.counts?.jobs;
  const counts = {
    agents: agentCount != null ? String(agentCount) : '…',
    sessions: sessCount != null ? String(sessCount) : '…',
    skills: skillTotal ? String(skillTotal) : '…',
    plugins: plugCount != null ? String(plugCount) : '…',
    mcp: mcpTotal != null ? `${mcpOn}/${mcpTotal}` : '…',
    scheduler: jobCount != null ? String(jobCount) : '…',
    missions: String(fleet?.context?.taskStats?.total ?? 0),
  };

  const active = fleet?.active?.active;
  const modelLabel = active ? active.model : (online ? 'resolving…' : 'offline');
  const provLabel = active ? active.provider : '';
  const provConfigured = (health?.providers || []).filter((p) => p.configured) || [];

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
          <span className="dot" style={{ background: provConfigured.length ? 'var(--jcx-up)' : 'var(--jcx-down)' }} />
          <span>
            <b>{provConfigured.length || 0} provider{provConfigured.length === 1 ? '' : 's'} configured</b>
            {provConfigured.length ? ` · ${provConfigured.map((p) => p.key).join(', ')}` : ' · set keys on the brain'}
          </span>
        </div>
      </div>
    </aside>
  );
}
