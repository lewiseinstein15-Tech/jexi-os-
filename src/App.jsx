import { useState, useEffect, useRef } from 'react';
import { StatusBar } from '@capacitor/status-bar';
import { useJexiEngine } from './hooks/useJexiEngine';
import usePhoneNotifications from './hooks/usePhoneNotifications'; // B83 — real phone notifications when tasks/goals finish
import { getBackendUrl, jexiFetch, getSessionId } from './utils/helpers';
import ChatWindow from './components/ChatWindow';
import HistoryView from './components/HistoryView';
import WorkshopView from './components/WorkshopView';
import SettingsView from './components/SettingsView';
import UpdateBanner from './components/UpdateBanner';
import BootSplash from './components/BootSplash'; // B79 — branded loading screen on open (never a blank screen)
import ErrorBoundary from './components/ErrorBoundary';

const VIEWS = {
  chat: { label: 'Chat', icon: 'chat' },
  history: { label: 'Chat history', icon: 'history' },
  workshop: { label: 'Workshop', icon: 'workshop' },
  settings: { label: 'Settings', icon: 'settings' },
};

function MenuIcon({ name }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor' };
  switch (name) {
    case 'chat':
      return <svg {...common} strokeWidth="1.8"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>;
    case 'history':
      return <svg {...common} strokeWidth="1.8"><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></svg>;
    case 'workshop':
      return <svg {...common} strokeWidth="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>;
    default:
      return <svg {...common} strokeWidth="1.8"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
  }
}

export default function App() {
  const [view, setView] = useState('chat');
  const [menuOpen, setMenuOpen] = useState(false);
  const [booted, setBooted] = useState(false);
  const [bootStatus, setBootStatus] = useState('Connecting to JEXI\u2019s brain…');
  const engine = useJexiEngine();
  usePhoneNotifications();

  // B79 — REAL loading page on open (never a blank frame, never a fake
  // flash): the branded splash stays up until the shell has painted AND the
  // backend is reachable. Hard cap so the splash can never trap the app.
  useEffect(() => {
    let alive = true;
    let done = false;
    const finish = () => { if (alive && !done) { done = true; setBooted(true); } };
    const minDelay = new Promise((r) => setTimeout(r, 1400));
    const health = (async () => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      try {
        const res = await fetch(`${getBackendUrl()}/api/health`, { signal: ctrl.signal, cache: 'no-store' });
        if (alive && res.ok) {
          setBootStatus('Brain online');
          await new Promise((r) => setTimeout(r, 400));
        }
      } catch (e) { /* brain still sleeping — the hard cap releases us */ }
      finally { clearTimeout(t); }
    })();
    Promise.race([
      Promise.all([minDelay, health]),
      new Promise((r) => setTimeout(r, 15000)),
    ]).then(finish);
    return () => { alive = false; };
  }, []);

  // Native polish: match the phone's status bar to the black theme.
  useEffect(() => {
    if (window.Capacitor?.isNativePlatform?.()) {
      StatusBar.setBackgroundColor({ color: '#0a0a0a' }).catch(() => {});
      StatusBar.setStyle({ style: 'LIGHT' }).catch(() => {});
    }
  }, []);

  const navigate = (id) => {
    setView(id);
    setMenuOpen(false);
  };

  // B97 — RESUME IN CHAT: a past conversation's RESUME button sets the
  // session id and asks the app to open Chat so it continues that log.
  useEffect(() => {
    const h = () => navigate('chat');
    window.addEventListener('jexi:resume-conversation', h);
    return () => window.removeEventListener('jexi:resume-conversation', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the menu when tapping outside it.
  useEffect(() => {
    const onDoc = () => setMenuOpen(false);
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  if (!booted) {
    return <BootSplash status={bootStatus} />;
  }

  return (
    <ErrorBoundary>
      <div className="jx-app">
        {/* top bar with the three lines */}
        <header className="jx-top">
          <button
            type="button"
            className="jx-burger"
            aria-label="Menu"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
          >
            <i /><i /><i />
          </button>
          <div className="jx-word">JEXI</div>
          <div className="jx-dotsep" />
          <div className="jx-ctx">{VIEWS[view]?.label || 'Chat'}</div>
          <div className="jx-right">
            <div className={`jx-stat${engine.isProcessing ? ' working' : ''}`}>
              <span className="dot" />
              {engine.isProcessing ? 'Working…' : 'Online'}
            </div>
          </div>
        </header>

        {/* drawer backdrop (native feel) */}
        <div className={`jx-backdrop${menuOpen ? ' show' : ''}`} onClick={() => setMenuOpen(false)} aria-hidden="true" />

        {/* hamburger menu (drawer) */}
        <nav className={`jx-menu${menuOpen ? ' open' : ''}`} onClick={(e) => e.stopPropagation()}>
          {Object.entries(VIEWS).map(([id, v]) => (
            <button
              key={id}
              type="button"
              className={`jx-mi${view === id ? ' active' : ''}`}
              onClick={() => navigate(id)}
            >
              <MenuIcon name={v.icon} />
              {v.label}
            </button>
          ))}
        </nav>

        {/* chat */}
        <section className={`jx-view${view === 'chat' ? ' show' : ''}`}>
          <div className="jx-main">
            <ChatWindow
              messages={engine.messages}
              logs={engine.logs}
              isProcessing={engine.isProcessing}
              onSend={engine.runSearch}
              onStop={engine.stopGeneration}
              questions={engine.questions}
              onDismissQuestions={() => engine.setQuestions(null)}
              planReview={engine.planReview}
              onDismissPlan={() => engine.setPlanReview(null)}
            />
          </div>
        </section>

        {/* chat history */}
        <section className={`jx-view${view === 'history' ? ' show' : ''}`}>
          <div className="jx-main">
            <HistoryView
              onOpen={(convId, events) => {
                engine.openConversation(convId, events);
                navigate('chat');
              }}
            />
          </div>
        </section>

        {/* workshop */}
        <section className={`jx-view${view === 'workshop' ? ' show' : ''}`}>
          <div className="jx-main">
            <WorkshopView />
          </div>
        </section>

        {/* settings */}
        <section className={`jx-view${view === 'settings' ? ' show' : ''}`}>
          <div className="jx-main">
            <SettingsView />
          </div>
        </section>

        <UpdateBanner />
      </div>
    </ErrorBoundary>
  );
}
