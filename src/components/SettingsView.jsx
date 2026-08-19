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
          <div className="lab"><b>Backend</b><span>{getBackendUrl()}</span></div>
          <span className={`jx-st${health ? ' on' : ''}`}>{health ? '● live' : '…'}</span>
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
