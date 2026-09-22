import { useEffect, useState } from 'react';
import Sidebar from './Sidebar.jsx';
import Header from './Header.jsx';
import Placeholder from '../placeholder/Placeholder.jsx';
import ChatWindow from '../../../../src/components/ChatWindow.jsx';
import Settings from '../settings/Settings.jsx';
import '../settings/settings.css';
import TokenInspector from './TokenInspector.jsx';
import { ROUTES, DEFAULT_ROUTE, TOKENS_HASH, routeFromHash } from './routes.js';

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
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('p24-theme-change', onTheme); };
  }, []);

  const route = routeFromHash(hash);
  const showTokens = hash === TOKENS_HASH;

  return (
    <div className="jx-shell" data-theme={theme}>
      <Sidebar routes={ROUTES} activeHash={showTokens ? DEFAULT_ROUTE.hash : route.hash} />
      <div className="jx-main">
        <Header routeTitle={showTokens ? 'Tokens' : route.title} />
        <main className="jx-content" data-route={showTokens ? 'tokens' : route.id}>
          {showTokens
            ? <TokenInspector />
            : route.id === 'chat'
              ? <ChatWindow />
              : route.id === 'settings'
                ? <Settings sessionId="console-main" />
                : <Placeholder route={route} />}
        </main>
      </div>
    </div>
  );
}
