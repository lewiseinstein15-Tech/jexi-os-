import { useEffect, useState, useCallback } from 'react';
import './tokens-premium.css';
import './premium.css';
import Sidebar, { AGENTS_ROUTE } from './Sidebar.premium.jsx';
import Header from './Header.premium.jsx';
import { Toasts } from './toasts.js';
import { useShortcuts } from './shortcuts.js';
import ShortcutsOverlay from './ShortcutsOverlay.jsx';
import Placeholder from '../placeholder/Placeholder.jsx';
import ChatWindow from '../../../../console/components/ChatWindow.jsx';
import Settings from '../settings/Settings.jsx';
import '../settings/settings.css';
import Graph from '../graph/Graph.jsx';
import TokenInspector from './TokenInspector.jsx';
import { ROUTES, DEFAULT_ROUTE, TOKENS_HASH, routeFromHash } from './routes.js';
// ui-rebuild-premium — the agents route now renders the ROSTER view
// (/api/roster: 252 registry agents grouped by tier, search + detail panel).
// The shipped Phase 31 AgentsView (jcx theme, /api/agents/definitions) is no
// longer mounted from here; the module stays untouched on disk for rollback.
import AgentsRosterView from '../agents/AgentsRosterView.jsx';

/**
 * Premium app frame (ui-rebuild-premium).
 * Grid shell: sidebar (240px, icons <900px, drawer <600px) + header + content.
 * Theme (dark default) + appearance (accent / font size / density) ride on
 * data-attributes consumed by tokens-premium.css; state persists in
 * localStorage and is shared with the Settings view via CustomEvents.
 * Content per-route: Chat / Settings / Work Graph / Agents (+ dev tokens).
 */
const APPEARANCE_KEY = 'jx-appearance';

export function loadAppearance() {
  try { return JSON.parse(localStorage.getItem(APPEARANCE_KEY)) || {}; } catch { return {}; }
}

export function patchAppearance(patch) {
  try {
    const next = { ...loadAppearance(), ...patch };
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('jx-appearance-change', { detail: next }));
    return next;
  } catch { return loadAppearance(); }
}

export default function Shell() {
  const [hash, setHash] = useState(() => window.location.hash || DEFAULT_ROUTE.hash);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('p24-theme') || 'dark'; } catch { return 'dark'; }
  });
  const [appearance, setAppearance] = useState(loadAppearance);
  const [navOpen, setNavOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const toggleThemeShortcut = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('p24-theme', next); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);
  const toggleOverlay = useCallback(() => setShowShortcuts((v) => !v), []);
  useShortcuts({ onOverlay: toggleOverlay, onTheme: toggleThemeShortcut });

  useEffect(() => {
    const onHash = () => { setHash(window.location.hash || DEFAULT_ROUTE.hash); setNavOpen(false); };
    const onTheme = (e) => setTheme(e.detail);
    const onAppearance = (e) => setAppearance(e.detail || loadAppearance());
    window.addEventListener('hashchange', onHash);
    window.addEventListener('p24-theme-change', onTheme);
    window.addEventListener('jx-appearance-change', onAppearance);
    if (!window.location.hash) window.location.replace(DEFAULT_ROUTE.hash);
    // Seed the legacy brainGet base (ui/web console services refuse to fetch
    // without it). Same-origin: the dev proxy forwards /api to the JEXI
    // server on 3002.
    try { if (!localStorage.getItem('jexi_backend_url')) localStorage.setItem('jexi_backend_url', window.location.origin); } catch { /* storage unavailable */ }
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('p24-theme-change', onTheme);
      window.removeEventListener('jx-appearance-change', onAppearance);
    };
  }, []);

  const route = routeFromHash(hash);
  const showTokens = hash === TOKENS_HASH;
  // PHASE 31 WA7 — hash-detected route (same pattern as the dev-only tokens
  // route): Agents View renders without adding a Phase 24 ROUTES entry.
  const showAgents = hash === AGENTS_ROUTE.hash;

  const activeHash = showAgents ? AGENTS_ROUTE.hash : (showTokens ? DEFAULT_ROUTE.hash : route.hash);
  const routeTitle = showAgents ? AGENTS_ROUTE.title : (showTokens ? 'Tokens' : route.title);
  const routeId = showAgents ? 'agents' : (showTokens ? 'tokens' : route.id);

  function changeTheme(t) {
    setTheme(t);
    try { localStorage.setItem('p24-theme', t); } catch { /* storage unavailable */ }
  }

  return (
    <div
      className={'jx-shell' + (navOpen ? ' is-nav-open' : '')}
      data-theme={theme}
      data-accent={appearance.accent || 'violet'}
      data-fontsize={appearance.fontsize || 'medium'}
      data-spacing={appearance.spacing || 'comfortable'}
    >
      <Sidebar routes={ROUTES} activeHash={activeHash} onNavigate={() => setNavOpen(false)} />
      <div className="jx-main">
        <Header
          routeTitle={routeTitle}
          theme={theme}
          onTheme={changeTheme}
          onToggleNav={() => setNavOpen((v) => !v)}
        />
        <main className="jx-content" data-route={routeId}>
          {showAgents
            ? (
                <div className="jx-view" data-view="agents" style={{ display: 'flex', flexDirection: 'column' }}>
                  <AgentsRosterView />
                </div>
              )
            : showTokens
              ? <TokenInspector />
              : route.id === 'chat'
                ? <ChatWindow />
                : route.id === 'settings'
                ? (
                    <div className="jx-view" data-view="settings">
                      <Settings sessionId="console-main" />
                    </div>
                  )
                : route.id === 'graph'
                  ? (
                      <div className="jx-view" data-view="graph">
                        <Graph />
                      </div>
                    )
                  : <Placeholder route={route} />}
        </main>
      </div>
      {showShortcuts ? <ShortcutsOverlay onClose={() => setShowShortcuts(false)} /> : null}
      <Toasts />
    </div>
  );
}
