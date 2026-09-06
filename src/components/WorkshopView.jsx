import { useEffect, useState, useCallback } from 'react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';
import ComputerPanel from './ComputerPanel';

/**
 * WORKSHOP (Sept 2026, Lewis's spec): the one screen where you watch JEXI
 * actually operate the computer, plus everything it builds:
 *   - COMPUTER: live computer-use telemetry (real events only — what JEXI is
 *     clicking, typing, seeing right now)
 *   - PREVIEW: live preview link for the app JEXI is building
 *   - FILES: every file JEXI created, each one a real link (opens in browser)
 */
export default function WorkshopView({ engine }) {
  const [files, setFiles] = useState([]);
  const [projectName, setProjectName] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(null); // file name that was copied
  const [copiedAll, setCopiedAll] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  // mobile: three tabs now — Computer / Preview / Files
  const [isMobile, setIsMobile] = useState(false);
  const [mobTab, setMobTab] = useState('computer');

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const on = (e) => { setIsMobile(e.matches); if (!e.matches) setMobTab('computer'); };
    setIsMobile(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/workspace`);
      if (res.ok) {
        const data = await res.json();
        setFiles((data.files || []).map((f) => ({ name: f.name, size: f.size, modified: f.modified })));
      }
      const pres = await jexiFetch(`${getBackendUrl()}/api/projects`);
      if (pres.ok) {
        const pdata = await pres.json();
        const projects = pdata.projects || [];
        if (projects.length > 0) {
          const latest = projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
          setProjectName(latest.name || latest.slug || null);
        }
      }
    } catch (e) { /* noop */ }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh, refreshTick]);
  // keep the file list fresh while JEXI works (she may be creating files right now)
  useEffect(() => {
    const t = setInterval(() => setRefreshTick((x) => x + 1), 15000);
    return () => clearInterval(t);
  }, []);

  const hasIndex = files.some((f) => String(f.name).endsWith('index.html'));
  const previewUrl = hasIndex ? `${getBackendUrl()}/preview/index.html` : null;
  const fileLink = (name) => `${getBackendUrl()}/preview/${encodeURIComponent(name)}`;

  const copyFile = async (file) => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/workspace/file?name=${encodeURIComponent(file.name)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.success) return;
      await navigator.clipboard.writeText(String(data.content ?? ''));
      setCopied(file.name);
      setTimeout(() => setCopied((c) => (c === file.name ? null : c)), 1400);
    } catch (e) { /* clipboard may be unavailable */ }
  };

  const copyAll = async () => {
    try {
      let out = '';
      for (const f of files) {
        const res = await jexiFetch(`${getBackendUrl()}/api/workspace/file?name=${encodeURIComponent(f.name)}`);
        if (!res.ok) continue;
        const data = await res.json();
        if (data.success) out += `\n/* ── ${f.name} ── */\n${data.content}\n`;
      }
      if (out) { await navigator.clipboard.writeText(out.trim()); setCopiedAll(true); setTimeout(() => setCopiedAll(false), 1400); }
    } catch (e) { /* noop */ }
  };

  const kb = (size) => (size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`);

  const computer = engine?.computer || null;
  const live = engine?.isProcessing || false;
  const computerEvents = Array.isArray(computer) ? computer : [];

  return (
    <div className="jx-ws">
      <div style={{ padding: '26px 28px 0' }}>
        <div className="jx-vtitle">Workshop</div>
        <div className="jx-vsub">
          {projectName ? `${projectName} — ` : ''}watch JEXI work the computer · files and apps land here as real links
        </div>
      </div>
      {/* mobile tabs */}
      {isMobile && (
        <div className="jx-ws-tabs">
          <button type="button" className={mobTab === 'computer' ? 'active' : ''} onClick={() => setMobTab('computer')}>
            Computer{live ? ' ●' : ''}
          </button>
          <button type="button" className={mobTab === 'preview' ? 'active' : ''} onClick={() => setMobTab('preview')}>Preview</button>
          <button type="button" className={mobTab === 'files' ? 'active' : ''} onClick={() => setMobTab('files')}>Files ({files.length})</button>
        </div>
      )}
      <div className="jx-ws-body" style={{ flexDirection: 'column' }}>
        {/* computer use — live, real events only */}
        <div className={`jx-files${isMobile && mobTab !== 'computer' ? ' mob-hidden' : ''}`} style={{ marginBottom: 12 }}>
          <div className="jx-fh">
            <span>Computer{live ? ' — JEXI is working…' : computerEvents.length ? ` — last session (${computerEvents.length} steps)` : ''}</span>
            {live && <span style={{ color: 'var(--brand)' }}>● live</span>}
          </div>
          <div style={{ padding: '0 12px 12px' }}>
            <ComputerPanel computer={computer} live={live} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, flexDirection: window.innerWidth <= 900 ? 'column' : 'row', flex: 1, minHeight: 0 }}>
          {/* preview */}
          <div className={`jx-preview${isMobile && mobTab !== 'preview' ? ' mob-hidden' : ''}`}>
            <div className="jx-pbar">
              <span className="dots"><i /><i /><i /></span>
              <span className="url">{previewUrl ? previewUrl.replace(/^https?:\/\//, '') : 'no preview yet'}</span>
              {previewUrl && (
                <a href={previewUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--brand)' }}>open ↗</a>
              )}
            </div>
            <div className="jx-frame">
              {previewUrl ? (
                <iframe title="preview" src={previewUrl} sandbox="allow-scripts allow-modals" />
              ) : (
                <div className="ph">
                  {loading ? 'loading workspace…' : 'No preview yet — build something and it shows here live.'}
                </div>
              )}
            </div>
            <div className="jx-ws-foot">preview updates live as JEXI edits — this project only</div>
          </div>
          {/* files — every row is a real link */}
          <div className={`jx-files${isMobile && mobTab !== 'files' ? ' mob-hidden' : ''}`}>
            <div className="jx-fh">
              <span>Files ({files.length}) — tap a name to open</span>
              <button type="button" onClick={copyAll}>{copiedAll ? '✓ all copied' : 'Copy all'}</button>
            </div>
            <div className="jx-flist">
              {loading && <div className="jx-frow"><span className="fname" style={{ color: 'var(--faint)' }}>loading…</span></div>}
              {!loading && files.length === 0 && (
                <div className="jx-frow"><span className="fname" style={{ color: 'var(--faint)' }}>Workspace is empty — JEXI will create files here.</span></div>
              )}
              {files.map((f) => (
                <div className="jx-frow" key={f.name}>
                  <span className="fic">{String(f.name).split('.').pop()?.slice(0, 4).toUpperCase()}</span>
                  <a className="fname" href={fileLink(f.name)} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{f.name}</a>
                  <span className="fsize">{kb(f.size)}</span>
                  {copied === f.name ? (
                    <span className="copied">✓ copied</span>
                  ) : (
                    <button type="button" className="copy" onClick={() => copyFile(f)}>Copy</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
