import { useEffect, useState } from 'react';
import Sidebar, { AGENTS_ROUTE } from './Sidebar.jsx';
import Header from './Header.jsx';
import Placeholder from '../placeholder/Placeholder.jsx';
import ChatWindow from '../../../../src/components/ChatWindow.jsx';
import Settings from '../settings/Settings.jsx';
import '../settings/settings.css';
import Graph from '../graph/Graph.jsx';
import TokenInspector from './TokenInspector.jsx';
import { ROUTES, DEFAULT_ROUTE, TOKENS_HASH, routeFromHash } from './routes.js';
// PHASE 31 Scope 2 (WA7) — Agents View (shipped Phase 24 console view, RO)
// wired into the shell at this seam: routes.js is NOT edited. The view's
// classes/vars are scoped under `.jcx` in the shipped theme file (imported
// below — zero global selectors, verified), so the host wrapper supplies the
// .jcx scope while neutralizing the theme's full-screen takeover properties
// (position/inset/z-index/display) via inline overrides — consumer-side
// integration only; the view module itself is untouched.
import AgentsView from '../../../../src/components/console/views/AgentsView.jsx';
import '../../../../src/styles/jexi-theme.css';

/**
 * Phase 24 app frame. Three-region shell: sidebar (240px) + header + content.
 * No HUD, no event-stream panel, no stats rail. Content is per-route
 * placeholders until Scopes B/C/D mount real surfaces.
 */
export default function Shell() {
  const [hash, setHash] = useState(() => window.location.hash || DEFAULT_ROUTE.hash);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('p24-theme') || 'dark'; } catch { return 'dark'; }
  });

  useEffect(() => {
    const onHash = () => setHash(window.location.hash || DEFAULT_ROUTE.hash);
    const onTheme = (e) => setTheme(e.detail);
    window.addEventListener('hashchange', onHash);
    window.addEventListener('p24-theme-change', onTheme);
    if (!window.location.hash) window.location.replace(DEFAULT_ROUTE.hash);
    // PHASE 31 WA7 — the shipped AgentsView consumes brainGet, whose contract
    // refuses to fetch without a configured backend URL ("No brain
    // configured"). The shell seeds it with this origin (same-origin; the
    // dev proxy forwards /api to the JEXI server) so the view's live fetch
    // works inside the hosted shell. No other view is affected: an absolute
    // same-origin base resolves identically to a relative path.
    try { if (!localStorage.getItem('jexi_backend_url')) localStorage.setItem('jexi_backend_url', window.location.origin); } catch { /* storage unavailable */ }
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('p24-theme-change', onTheme); };
  }, []);

  const route = routeFromHash(hash);
  const showTokens = hash === TOKENS_HASH;
  // PHASE 31 WA7 — hash-detected route (same pattern as the dev-only tokens
  // route): Agents View renders without adding a Phase 24 ROUTES entry.
  const showAgents = hash === AGENTS_ROUTE.hash;

  return (
    <div className="jx-shell" data-theme={theme}>
      <Sidebar routes={ROUTES} activeHash={showAgents ? AGENTS_ROUTE.hash : (showTokens ? DEFAULT_ROUTE.hash : route.hash)} />
      <div className="jx-main">
        <Header routeTitle={showAgents ? AGENTS_ROUTE.title : (showTokens ? 'Tokens' : route.title)} />
        <main className="jx-content" data-route={showAgents ? 'agents' : (showTokens ? 'tokens' : route.id)}>
          {showAgents
            ? (
              <div
                className="jcx"
                data-testid="agents-host"
                style={{ position: 'static', inset: 'auto', zIndex: 'auto', display: 'block', overflowY: 'auto', height: '100%', gridTemplateColumns: 'none', padding: '18px 22px' }}
              >
                <AgentsView />
              </div>
            )
            : showTokens
              ? <TokenInspector />
              : route.id === 'chat'
                ? <ChatWindow />
                : route.id === 'settings'
                  ? <Settings sessionId="console-main" />
                  : route.id === 'graph'
                    ? <Graph />
                    : <Placeholder route={route} />}
        </main>
      </div>
    </div>
  );
}
