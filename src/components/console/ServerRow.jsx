import { useEffect, useRef, useState } from 'react';
import { getBackendUrl, setBackendUrl } from '../../utils/helpers';

/* ServerRow — v0.7: the brain's address, live in the console sidebar.
   Shows the server the app talks to, pings /api/health, and reflects the
   connection as a status dot (green online / gold waking / red offline).
   Tap the row to edit the address; it saves to localStorage
   ('jexi_backend_url') — the SAME key the classic shell reads, so the
   console and the classic Settings view always agree on the brain.

   Default: localStorage override → VITE_JEXI_BACKEND_URL baked at build
   (.env.production → https://jexi-os-brain.onrender.com) → hard fallback. */

const FALLBACK_BRAIN = 'https://jexi-os-brain.onrender.com';

function normalize(u) {
  let s = (u || '').trim().replace(/\/+$/, '');
  if (s && !/^https?:\/\//i.test(s)) s = 'https://' + s;
  return s;
}

function hostOf(u) {
  try { return new URL(u).host; } catch { return u; }
}

export default function ServerRow() {
  const [url, setUrl] = useState(() => normalize(getBackendUrl()) || FALLBACK_BRAIN);
  const [status, setStatus] = useState('checking'); // checking | up | down
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const triesRef = useRef(0);
  const statusRef = useRef(status);
  statusRef.current = status;

  const ping = async (base) => {
    if (!base) { setStatus('down'); return; }
    setStatus('checking');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(`${base}/api/health`, { signal: ctrl.signal, cache: 'no-store' });
      if (res.ok) { setStatus('up'); triesRef.current = 0; return; }
      throw new Error(`HTTP ${res.status}`);
    } catch {
      // Render free tier cold start can hold the request ~60s; also some
      // webview origins hide the body via CORS. If the brain ANSWERS at
      // all, a no-cors probe resolves — that's "online" for a status dot.
      try {
        await fetch(`${base}/api/health`, { mode: 'no-cors', cache: 'no-store' });
        setStatus('up'); triesRef.current = 0;
      } catch {
        setStatus('down');
        if (triesRef.current < 2) {
          triesRef.current += 1;
          setTimeout(() => ping(base), 15000);
        }
      }
    } finally { clearTimeout(t); }
  };

  useEffect(() => { ping(url); }, [url]);

  // re-check every 90s so the dot keeps telling the truth
  useEffect(() => {
    const iv = setInterval(() => { if (statusRef.current !== 'checking') ping(url); }, 90000);
    return () => clearInterval(iv);
  }, [url]);

  const save = () => {
    const clean = normalize(draft);
    if (clean && clean !== url) {
      setBackendUrl(clean);
      setUrl(clean);
      triesRef.current = 0;
    }
    setEditing(false);
  };

  const statusLabel = status === 'checking' ? 'waking…' : status === 'up' ? 'online' : 'offline';

  return (
    <div
      className="serverrow"
      title={`${url} — tap to change the brain address`}
      onClick={editing ? undefined : () => { setDraft(url); setEditing(true); }}
    >
      {editing ? (
        <input
          autoFocus
          value={draft}
          spellCheck="false"
          placeholder="https://your-brain.onrender.com"
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={save}
        />
      ) : (
        <>
          <span className={`sdot ${status}`} />
          <div className="srv">
            <div className="p">Server</div>
            <div className="m">{hostOf(url)} · {statusLabel}</div>
          </div>
        </>
      )}
    </div>
  );
}
