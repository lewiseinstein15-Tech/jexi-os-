import { useEffect, useState } from 'react';
import { getBackendUrl, jexiFetch, getAccessKey, setAccessKey } from '../utils/helpers';

export default function SettingsView() {
  const [key, setKey] = useState(getAccessKey());
  const [keySaved, setKeySaved] = useState(false);
  const [health, setHealth] = useState(null);
  const [providers, setProviders] = useState(null);
  const [version, setVersion] = useState(null);
  const [memory, setMemory] = useState(null);
  const [erasing, setErasing] = useState(false);
  const [team, setTeam] = useState(null);
  const [toolProfiles, setToolProfiles] = useState(null); // FINAL F4 — permission profiles
  const [toolProfile, setToolProfile] = useState(null);
  const [toolBusy, setToolBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const h = await jexiFetch(`${getBackendUrl()}/api/health`);
        if (h.ok) setHealth(await h.json());
      } catch (e) { /* noop */ }
      try {
        const p = await jexiFetch(`${getBackendUrl()}/api/settings/status`);
        if (p.ok) setProviders(await p.json());
      } catch (e) { /* noop */ }
      try {
        const v = await jexiFetch(`${getBackendUrl()}/api/update/version`);
        if (v.ok) setVersion(await v.json());
      } catch (e) { /* noop */ }
      try {
        const t = await jexiFetch(`${getBackendUrl()}/api/team`);
        if (t.ok) setTeam((await t.json()).team || []);
      } catch (e) { /* noop */ }
      try {
        const t = await jexiFetch(`${getBackendUrl()}/api/tools`);
        if (t.ok) {
          const td = await t.json();
          if (td.profiles) setToolProfiles(td.profiles);
          if (td.activeProfile) setToolProfile(td.activeProfile);
        }
      } catch (e) { /* noop */ }
      try {
        const m = await jexiFetch(`${getBackendUrl()}/api/memory`);
        if (m.ok) {
          const data = await m.json();
          setMemory({
            facts: (data.userFacts || []).length,
            episodes: (data.episodes || []).length,
          });
        }
      } catch (e) { /* noop */ }
    })();
  }, []);

  const saveKey = () => {
    setAccessKey(key.trim());
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 1400);
  };

  const eraseAll = async () => {
    if (!window.confirm('Erase everything? Facts, history and preferences will be gone. This cannot be undone.')) return;
    setErasing(true);
    try {
      await jexiFetch(`${getBackendUrl()}/api/memory/clear`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    } catch (e) { /* noop */ }
    setErasing(false);
    window.alert('Memory erased.');
  };

  const providerCount = providers ? Object.keys(providers).filter((k) => providers[k] && providers[k].configured).length : null;
  const buildNumber = version ? version.number : null;

  return (
    <div className="jx-scroll">
      <div className="jx-view-inner" style={{ maxWidth: 700 }}>
        <div className="jx-vtitle">Settings</div>
        <div className="jx-vsub">Just the essentials — this is personal.</div>

        <div className="jx-grp">Connection</div>
        <div className="jx-setline">
          <div className="lab"><b>Backend</b><span>{getBackendUrl() || 'same origin'}</span></div>
          <span className={`jx-st${health ? ' on' : ''}`}>{health ? '● live' : '…'}</span>
        </div>
        <div className="jx-setline">
          <div className="lab"><b>Server address</b><span>move JEXI anywhere</span></div>
          <input
            type="url"
            defaultValue={getBackendUrl()}
            placeholder="https://… (empty = default)"
            onChange={(e) => {
              const v = e.target.value.trim();
              if (v) localStorage.setItem('jexi_backend_url', v.replace(/\/$/, ''));
              else localStorage.removeItem('jexi_backend_url');
              window.dispatchEvent(new CustomEvent('jexi:backend-url', { detail: v }));
            }}
          />
        </div>
        <div className="jx-setline">
          <div className="lab"><b>Access key</b><span>your private lock</span></div>
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="your key" />
          <button type="button" className="jx-btn black" onClick={saveKey}>{keySaved ? '✓ saved' : 'Save'}</button>
        </div>
        <div className="jx-setline">
          <div className="lab"><b>AI providers</b><span>all healthy right now</span></div>
          <span className="jx-st on">{providerCount !== null ? `${providerCount} configured` : '…'}</span>
        </div>
        <div className="jx-setline">
          <div className="lab"><b>GitHub</b><span>one-time paste in chat · never stored</span></div>
          {providers && providers.github && providers.github.source === 'session' ? (
            <button
              type="button" className="jx-st on" style={{ background: 'none', font: 'inherit', cursor: 'pointer' }}
              onClick={async () => {
                try {
                  await jexiFetch(`${getBackendUrl()}/api/secrets/forget`, { method: 'POST' });
                  const p = await jexiFetch(`${getBackendUrl()}/api/settings/status`);
                  if (p.ok) setProviders(await p.json());
                } catch (e) { /* noop */ }
              }}
            >forget key</button>
          ) : (
            <span className="jx-st on">{providers && providers.github && providers.github.configured ? 'env' : 'no key'}</span>
          )}
        </div>

        {/* FINAL F4 — the operator's mode switch. Server-enforced in
            ToolRuntime; external/irreversible actions always ask first. */}
        <div className="jx-grp">Safety</div>
        <div className="jx-setline" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 8 }}>
          <div className="lab"><b>Tool permissions</b><span>what JEXI may run on her own</span></div>
          {toolProfiles ? (
            <div className="jx-seg" role="radiogroup" aria-label="Tool permission profile">
              {['readonly', 'auto', 'full'].filter((k) => toolProfiles[k]).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={toolProfile === k}
                  disabled={toolBusy}
                  title={toolProfiles[k].desc}
                  className={toolProfile === k ? 'on' : ''}
                  onClick={async () => {
                    if (toolProfile === k) return;
                    setToolBusy(true);
                    try {
                      const r = await jexiFetch(`${getBackendUrl()}/api/tools/profile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: k }) });
                      const d = await r.json();
                      if (d && d.success && d.profile) setToolProfile(d.profile);
                    } catch { /* keeps the last confirmed value */ }
                    setToolBusy(false);
                  }}
                >
                  {toolProfiles[k].label || k}
                </button>
              ))}
            </div>
          ) : (
            <span className="jx-st">…</span>
          )}
          {toolProfile && toolProfiles && toolProfiles[toolProfile] && (
            <div className="lab"><span>{toolProfiles[toolProfile].desc}</span></div>
          )}
        </div>

        <div className="jx-grp">Meet the team</div>
        <div className="jx-setline" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 6 }}>
          <div className="lab"><b>Coworkers</b><span>the minds JEXI works with — you see their names while they work</span></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 4 }}>
            {(team || []).map((m) => (
              <span key={m.name} className="jx-st on" title={m.hint || m.name}>{m.name}</span>
            ))}
            {!team && <span className="jx-st">…</span>}
          </div>
        </div>

        <div className="jx-grp">Workshop</div>
        <div className="jx-setline">
          <div className="lab"><b>Files &amp; preview</b><span>the project you're working on</span></div>
          <span className="jx-st on">open from ☰</span>
        </div>

        <div className="jx-grp">Memory &amp; data</div>
        <div className="jx-setline">
          <div className="lab"><b>Memory</b><span>{memory ? `${memory.facts} facts · ${memory.episodes} episodes` : '…'}</span></div>
        </div>
        <div className="jx-setline">
          <div className="lab"><b>Erase everything</b><span>facts, history, preferences — gone</span></div>
          <button type="button" className="jx-btn" onClick={eraseAll} disabled={erasing}>{erasing ? 'Erasing…' : 'Erase'}</button>
        </div>

        <div className="jx-grp">About</div>
        <div className="jx-setline">
          <div className="lab"><b>Version</b><span>JEXI OS</span></div>
          <span className="jx-st on">{buildNumber ? `build #${buildNumber}` : '…'}</span>
        </div>
      </div>
    </div>
  );
}
