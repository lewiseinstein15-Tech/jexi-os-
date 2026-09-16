import LogoTool from './LogoTool';
import { NavIcon } from './icons';
import { NAV } from './consoleData';

/* <Sidebar /> — nav groups (Executive / Resources / Extensions), JEXI Market
   logo, model selector footer with the ONE-KEY row. Identical structure to
   the approved preview. */
export default function Sidebar({ route, onNavigate, onHome }) {
  return (
    <aside>
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
                : (it.count ? <span className="count">{it.count}</span> : null)}
            </button>
          ))}
        </nav>
      ))}

      <div className="sidefoot">
        <div className="modelrow">
          <NavIcon name="model" />
          <div>
            <div className="p">Model</div>
            <div className="m">gemini-2.5-pro</div>
          </div>
          <span className="chev"><NavIcon name="chevdown" /></span>
        </div>
        <div className="onekey">
          <span className="dot" />
          <span><b>1 key</b> · Gemini · healthy</span>
        </div>
      </div>
    </aside>
  );
}
