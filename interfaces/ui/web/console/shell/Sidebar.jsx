import { ROUTES } from './routes.js';

/**
 * Exactly three nav items: Chat / Settings / Work Graph.
 * Anchors: Tab focuses in order, Enter activates (native).
 *
 * PHASE 31 Scope 2 (WA7) — Agents View wired into the nav. routes.js is a
 * Phase 24 file and is NOT edited: the agents entry is appended here at the
 * sidebar seam (consumer-side), exported so Shell.jsx can route the hash
 * without touching Phase 24 internals.
 */
export const AGENTS_ROUTE = { id: 'agents', label: 'Agents', hash: '#/agents', title: 'Agents' };

export default function Sidebar({ activeHash, routes }) {
  const items = [...(routes || ROUTES), AGENTS_ROUTE];
  return (
    <nav className="jx-sidebar" aria-label="Console">
      <div className="jx-brand">
        <span className="jx-brand-mark" aria-hidden="true"></span>
        <span className="jx-brand-name">JEXI</span>
      </div>
      <ul className="jx-nav">
        {items.map((r) => (
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
