import { ROUTES } from './routes.js';

/**
 * Exactly three nav items: Chat / Settings / Work Graph.
 * Anchors: Tab focuses in order, Enter activates (native).
 */
export default function Sidebar({ activeHash }) {
  return (
    <nav className="jx-sidebar" aria-label="Console">
      <div className="jx-brand">
        <span className="jx-brand-mark" aria-hidden="true"></span>
        <span className="jx-brand-name">JEXI</span>
      </div>
      <ul className="jx-nav">
        {ROUTES.map((r) => (
          <li key={r.id}>
            <a
              className={'jx-nav-item' + (activeHash === r.hash ? ' is-active' : '')}
              href={r.hash}
              aria-current={activeHash === r.hash ? 'page' : undefined}
            >
              {r.label}
            </a>
          </li>
        ))}
      </ul>
      <div className="jx-sidebar-foot">phase-24 rebuild</div>
    </nav>
  );
}
