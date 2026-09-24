import { useCallback, useEffect, useState } from 'react';
import ProviderSection from './ProviderSection.jsx';
import ModeSection from './ModeSection.jsx';
import GeneralSection from './GeneralSection.jsx';
import * as runtime from '../../../../ui/web/console/chat/runtime.js';
import './settings.css';

const SETTINGS_KEY = 'p24-settings';
const THEME_KEY = 'p24-theme';

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; }
}
function loadTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch { return 'dark'; }
}

/** Phase 24 Scope C — /settings: grouped list rows, single column, no modals. */
export default function Settings({ sessionId }) {
  const [settings, setSettings] = useState(loadSettings);
  const [theme, setTheme] = useState(loadTheme);
  const [modes, setModes] = useState(() => runtime.state(sessionId).modes);

  const refreshModes = useCallback(() => setModes(runtime.state(sessionId).modes), [sessionId]);
  useEffect(() => { refreshModes(); }, [refreshModes]);

  function patch(p) {
    setSettings((prev) => {
      const next = { ...prev, ...p };
      if (p.provider && p.model === null) { next.model = null; }
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function changeTheme(t) {
    setTheme(t);
    localStorage.setItem(THEME_KEY, t);
    window.dispatchEvent(new CustomEvent('p24-theme-change', { detail: t }));
  }

  return (
    <div className="p24-settings">
      <ProviderSection settings={settings} onChange={patch} />
      <ModeSection sessionId={sessionId} modes={modes} onLive={refreshModes} />
      <GeneralSection theme={theme} onTheme={changeTheme} />
    </div>
  );
}
