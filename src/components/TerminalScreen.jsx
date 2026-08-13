import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, Play, Square, Trash2, X, RefreshCw, Loader2 } from 'lucide-react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';

const STATUS_COLOR = {
  running: 'text-brand',
  exited: 'text-acc-analysis',
  failed: 'text-status-error',
  stopped: 'text-acc-automation',
  interrupted: 'text-acc-automation',
};

const timeAgo = (t) => {
  if (!t) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

export default function TerminalScreen() {
  const [procs, setProcs] = useState([]);
  const [cmd, setCmd] = useState('');
  const [starting, setStarting] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [logs, setLogs] = useState('');
  const [status, setStatus] = useState(''); // '', loading, streaming
  const [toast, setToast] = useState('');
  const logRef = useRef(null);
  const abortRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/processes`);
      const data = await res.json();
      setProcs(data.processes || []);
    } catch (e) { /* backend down */ }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 2500);
    return () => { clearInterval(id); if (abortRef.current) abortRef.current.abort(); };
  }, [refresh]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2200); };

  const run = async (e) => {
    e.preventDefault();
    if (!cmd.trim() || starting) return;
    setStarting(true);
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/processes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd.trim() }),
      });
      const data = await res.json();
      if (data.success) { setCmd(''); flash('✓ Process started'); refresh(); }
      else flash(data.error || 'Could not start');
    } catch (err) { flash('Could not start process'); }
    setStarting(false);
  };

  const stop = async (id) => {
    try { await jexiFetch(`${getBackendUrl()}/api/processes/${id}/stop`, { method: 'POST' }); refresh(); }
    catch (e) { flash('Stop failed'); }
  };

  const remove = async (id) => {
    try { await jexiFetch(`${getBackendUrl()}/api/processes/${id}`, { method: 'DELETE' }); if (openId === id) setOpenId(null); refresh(); }
    catch (e) { flash('Delete failed'); }
  };

  // Open a process: replay its full log, then stream live via NDJSON.
  const open = async (p) => {
    if (abortRef.current) abortRef.current.abort();
    setOpenId(p.id);
    setStatus('loading');
    setLogs('');
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/processes/${p.id}/logs`);
      const data = await res.json();
      setLogs(data.log || '');
    } catch (e) { /* ignore */ }
    if (p.status === 'running') {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStatus('streaming');
      try {
        const stream = await fetch(`${getBackendUrl()}/api/processes/${p.id}/stream`, { signal: ctrl.signal });
        const reader = stream.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          for (const line of chunk.split('\n').filter(Boolean)) {
            try {
              const ev = JSON.parse(line);
              if (ev.type === 'process.log' && ev.chunk) setLogs((prev) => (prev + ev.chunk).slice(-40000));
            } catch (e2) { /* partial line */ }
          }
        }
      } catch (e) { /* stream closed */ }
      setStatus('');
    } else {
      setStatus('');
    }
  };

  const openProc = procs.find((p) => p.id === openId);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Terminal className="w-3.5 h-3.5 text-brand" />
        <h2 className="text-[10px] font-bold text-brand tracking-wider flex-1">TERMINAL · PROCESSES</h2>
        <button type="button" onClick={refresh} className="p-1.5 text-text-tertiary hover:text-brand"><RefreshCw className="w-3.5 h-3.5" /></button>
      </div>

      {/* Run command */}
      <form onSubmit={run} className="surface-float flex gap-2 items-center rounded-xl p-1.5 pl-3 focus-within:border-brand-line focus-within:shadow-[0_0_0_3px_var(--brand-dim)]">
        <span className="text-brand font-mono text-xs">$</span>
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          placeholder="Run a command in the workspace… (e.g. ls, node script.js)"
          className="flex-1 bg-transparent text-text-primary placeholder-text-tertiary rounded-lg py-2 text-xs font-mono focus:outline-none"
        />
        <button
          type="submit"
          disabled={!cmd.trim() || starting}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-brand text-black disabled:bg-surface-2 disabled:text-text-tertiary hover:scale-105 transition-all"
          title="Run"
        >
          {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
        </button>
      </form>

      {/* Process list */}
      {procs.length === 0 && (
        <div className="surface-card p-6 text-center">
          <Terminal className="w-6 h-6 text-text-tertiary mx-auto mb-2" />
          <p className="text-[10px] text-text-tertiary">No processes yet. Run a command above — output is captured server-side and survives restarts.</p>
        </div>
      )}
      <div className="space-y-1">
        {procs.map((p) => (
          <button key={p.id} type="button" onClick={() => open(p)} className="w-full flex items-center gap-2.5 surface-card p-2.5 text-left hover:border-hairline-strong">
            <span className={`flex-shrink-0 w-2 h-2 rounded-full ${p.status === 'running' ? 'bg-brand animate-pulse' : 'bg-text-tertiary/40'}`} />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-mono text-text-primary truncate">{p.command}</span>
              <span className="block text-[8px] font-mono text-text-tertiary">{timeAgo(p.createdAt)} · {p.logTail?.length || 0} chars</span>
            </span>
            <span className={`flex-shrink-0 text-[8px] font-bold tracking-wider ${STATUS_COLOR[p.status] || 'text-text-tertiary'}`}>
              {p.status.toUpperCase()}{p.exitCode != null ? ` · ${p.exitCode}` : ''}
            </span>
            {p.status === 'running' && (
              <Square onClick={(e) => { e.stopPropagation(); stop(p.id); }} className="w-3.5 h-3.5 text-status-error hover:scale-110" title="Stop" />
            )}
            <Trash2 onClick={(e) => { e.stopPropagation(); remove(p.id); }} className="w-3.5 h-3.5 text-text-tertiary hover:text-status-error" title="Delete" />
          </button>
        ))}
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-surface-3 border border-brand-line text-text-primary rounded-lg px-4 py-2 text-[10px] font-bold">
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Log sheet */}
      <AnimatePresence>
        {openId && openProc && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end" onClick={() => { abortRef.current?.abort(); setOpenId(null); }}>
            <motion.div
              initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full h-[78dvh] surface-card rounded-t-xl p-4 flex flex-col"
              style={{ boxShadow: '0 -8px 24px rgba(0,0,0,0.4)' }}
            >
              <div className="w-8 h-1 bg-white/15 rounded-full mx-auto mb-3" />
              <div className="flex items-center gap-2 mb-2">
                <Terminal className="w-3.5 h-3.5 text-brand" />
                <span className="text-[11px] font-mono text-text-primary truncate flex-1">{openProc.command}</span>
                <span className={`text-[8px] font-bold tracking-wider ${STATUS_COLOR[openProc.status]}`}>{openProc.status.toUpperCase()}</span>
                {status === 'streaming' && <span className="w-2 h-2 rounded-full bg-brand animate-pulse" />}
                <button type="button" onClick={() => { abortRef.current?.abort(); setOpenId(null); }} className="p-1 text-text-tertiary hover:text-text-primary"><X className="w-4 h-4" /></button>
              </div>
              <pre ref={logRef} className="flex-1 bg-[#050505] border border-hairline rounded-lg p-3 overflow-auto text-[10px] font-mono text-gray-300 leading-relaxed whitespace-pre-wrap">
                {logs || (status === 'loading' ? 'Loading…' : '(no output yet)')}
              </pre>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
