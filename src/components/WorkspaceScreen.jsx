import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FolderOpen, FileText, RefreshCw, Camera, History, Download, Save, X, RotateCcw, ChevronRight, Code2 } from 'lucide-react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';

const timeAgo = (t) => {
  if (!t) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export default function WorkspaceScreen() {
  const [files, setFiles] = useState([]);
  const [checkpoints, setCheckpoints] = useState([]);
  const [openFile, setOpenFile] = useState(null);   // { name, content }
  const [editContent, setEditContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [viewCp, setViewCp] = useState(null);        // { id, label, time, diffs }
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/workspace`);
      const data = await res.json();
      setFiles(data.files || []);
      setCheckpoints(data.checkpoints || []);
    } catch (e) { console.error('Workspace fetch failed', e); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2200); };

  const openFileView = async (name) => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/workspace/file?name=${encodeURIComponent(name)}`);
      const data = await res.json();
      setOpenFile({ name, content: data.content || '' });
      setEditContent(data.content || '');
      setDirty(false);
    } catch (e) { flash('Could not open file'); }
  };

  const saveFile = async () => {
    setBusy(true);
    try {
      await jexiFetch(`${getBackendUrl()}/api/workspace/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: openFile.name, content: editContent }),
      });
      setDirty(false);
      flash('✓ File saved');
      refresh();
    } catch (e) { flash('Save failed'); }
    setBusy(false);
  };

  const takeCheckpoint = async () => {
    setBusy(true);
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/workspace/checkpoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'manual' }),
      });
      const data = await res.json();
      flash(`✓ Checkpoint saved (${data.fileCount} files)`);
      refresh();
    } catch (e) { flash('Checkpoint failed'); }
    setBusy(false);
  };

  const showDiff = async (cp) => {
    setBusy(true);
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/workspace/diff?id=${encodeURIComponent(cp.id)}`);
      const data = await res.json();
      setViewCp({ ...cp, diffs: data.diffs || [] });
    } catch (e) { flash('Diff failed'); }
    setBusy(false);
  };

  const rollback = async (id) => {
    if (!window.confirm('Restore the workspace to this checkpoint? Current changes will be overwritten.')) return;
    setBusy(true);
    try {
      await jexiFetch(`${getBackendUrl()}/api/workspace/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      flash('✓ Workspace rolled back');
      setViewCp(null);
      setOpenFile(null);
      refresh();
    } catch (e) { flash('Rollback failed'); }
    setBusy(false);
  };

  const downloadFile = (name) => {
    const a = document.createElement('a');
    a.href = `${getBackendUrl()}/api/workspace/file?name=${encodeURIComponent(name)}`;
    a.download = name.split('/').pop();
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  if (loading) {
    return <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="skeleton h-14 rounded-lg" />)}</div>;
  }

  return (
    <div className="space-y-3">
      {/* Header + actions */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1">
          <FolderOpen className="w-3.5 h-3.5 text-brand" />
          <h2 className="text-[10px] font-bold text-brand tracking-wider">WORKSPACE RUNTIME</h2>
        </div>
        <button
          type="button"
          onClick={takeCheckpoint}
          disabled={busy}
          className="flex items-center gap-1.5 bg-brand-dim text-brand border border-brand-line rounded-md px-2.5 py-1.5 text-[8px] font-bold tracking-wider hover:brightness-110 disabled:opacity-60"
        >
          <Camera className="w-3 h-3" /> CHECKPOINT
        </button>
        <button type="button" onClick={refresh} className="p-1.5 text-text-tertiary hover:text-brand" title="Refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-2">
        <div className="surface-card p-3 text-center">
          <p className="text-[20px] font-semibold leading-none text-brand">{files.length}</p>
          <p className="text-[8px] font-bold tracking-wider text-text-tertiary mt-1.5">FILES</p>
        </div>
        <div className="surface-card p-3 text-center">
          <p className="text-[20px] font-semibold leading-none text-acc-research">{checkpoints.length}</p>
          <p className="text-[8px] font-bold tracking-wider text-text-tertiary mt-1.5">CHECKPOINTS</p>
        </div>
      </div>

      {/* Files */}
      <div>
        <p className="eyebrow mb-1.5">FILES · EVERY AI EDIT TRACEABLE</p>
        {files.length === 0 && (
          <div className="surface-card p-6 text-center">
            <FileText className="w-6 h-6 text-text-tertiary mx-auto mb-2" />
            <p className="text-[10px] text-text-tertiary">Workspace is empty. Ask JEXI to build something — generated files land here and can be checkpointed, diffed and rolled back.</p>
          </div>
        )}
        <div className="space-y-1">
          {files.map((f) => (
            <button
              key={f.name}
              type="button"
              onClick={() => openFileView(f.name)}
              className="w-full flex items-center gap-2.5 surface-card p-2.5 text-left hover:border-hairline-strong"
            >
              <Code2 className="w-3.5 h-3.5 text-acc-research flex-shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium text-text-primary truncate">{f.name}</span>
                <span className="block text-[8px] font-mono text-text-tertiary">{(f.size / 1024).toFixed(1)} KB · {timeAgo(new Date(f.modified).getTime())}</span>
              </span>
              <Download onClick={(e) => { e.stopPropagation(); downloadFile(f.name); }} className="w-3.5 h-3.5 text-text-tertiary hover:text-brand" />
              <ChevronRight className="w-3 h-3 text-text-tertiary" />
            </button>
          ))}
        </div>
      </div>

      {/* Checkpoint history */}
      <div>
        <p className="eyebrow mb-1.5">CHECKPOINT HISTORY · DIFF · ROLLBACK</p>
        {checkpoints.length === 0 && <p className="text-[10px] text-text-tertiary">No checkpoints yet — take one before a big change.</p>}
        <div className="space-y-1">
          {checkpoints.map((cp) => (
            <button
              key={cp.id}
              type="button"
              onClick={() => showDiff(cp)}
              className="w-full flex items-center gap-2.5 surface-card p-2.5 text-left hover:border-hairline-strong"
            >
              <History className="w-3.5 h-3.5 text-acc-automation flex-shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium text-text-primary truncate">{cp.label || cp.id}</span>
                <span className="block text-[8px] font-mono text-text-tertiary">{timeAgo(cp.time)} · {cp.fileCount} files</span>
              </span>
              <span className="text-[8px] font-bold text-acc-automation">DIFF</span>
            </button>
          ))}
        </div>
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-surface-3 border border-brand-line text-text-primary rounded-lg px-4 py-2 text-[10px] font-bold">
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* File editor sheet */}
      <AnimatePresence>
        {openFile && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end" onClick={() => { if (!dirty || window.confirm('Discard unsaved changes?')) { setOpenFile(null); setDirty(false); } }}>
            <motion.div
              initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full h-[78dvh] surface-card rounded-t-xl p-4 flex flex-col"
              style={{ boxShadow: '0 -8px 24px rgba(0,0,0,0.4)' }}
            >
              <div className="w-8 h-1 bg-white/15 rounded-full mx-auto mb-3" />
              <div className="flex items-center gap-2 mb-2">
                <Code2 className="w-3.5 h-3.5 text-acc-research" />
                <span className="text-[11px] font-semibold text-text-primary truncate flex-1">{openFile.name}</span>
                {dirty && <span className="text-[8px] font-bold text-acc-automation">UNSAVED</span>}
                <button type="button" onClick={saveFile} disabled={busy} className="flex items-center gap-1 bg-brand text-[#04140D] rounded-md px-2 py-1 text-[9px] font-bold disabled:opacity-60">
                  <Save className="w-3 h-3" /> SAVE
                </button>
                <button type="button" onClick={() => { if (!dirty || window.confirm('Discard unsaved changes?')) { setOpenFile(null); setDirty(false); } }} className="p-1 text-text-tertiary hover:text-text-primary">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <textarea
                value={editContent}
                onChange={(e) => { setEditContent(e.target.value); setDirty(true); }}
                spellCheck={false}
                className="flex-1 w-full bg-[#050505] border border-hairline rounded-lg p-3 text-[11px] font-mono text-gray-300 focus:outline-none focus:border-brand-line resize-none"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Diff sheet */}
      <AnimatePresence>
        {viewCp && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end" onClick={() => setViewCp(null)}>
            <motion.div
              initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full h-[80dvh] surface-card rounded-t-xl p-4 flex flex-col"
              style={{ boxShadow: '0 -8px 24px rgba(0,0,0,0.4)' }}
            >
              <div className="w-8 h-1 bg-white/15 rounded-full mx-auto mb-3" />
              <div className="flex items-center gap-2 mb-2">
                <History className="w-3.5 h-3.5 text-acc-automation" />
                <span className="text-[11px] font-semibold text-text-primary flex-1 truncate">{viewCp.label || viewCp.id} · {viewCp.diffs.length} changed file(s)</span>
                <button
                  type="button"
                  onClick={() => rollback(viewCp.id)}
                  className="flex items-center gap-1 bg-status-error/15 text-status-error border border-status-error/40 rounded-md px-2 py-1 text-[9px] font-bold"
                >
                  <RotateCcw className="w-3 h-3" /> ROLLBACK
                </button>
                <button type="button" onClick={() => setViewCp(null)} className="p-1 text-text-tertiary hover:text-text-primary">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2">
                {viewCp.diffs.length === 0 && <p className="text-[10px] text-text-tertiary text-center py-10">No changes since this checkpoint.</p>}
                {viewCp.diffs.map((d) => (
                  <div key={d.name} className="bg-[#050505] border border-hairline rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-surface-2 border-b border-hairline">
                      <span className="text-[10px] font-mono text-text-primary truncate">{d.name}</span>
                      <span className="text-[8px] font-mono text-text-tertiary flex-shrink-0">
                        <span className="text-brand">+{d.added}</span> <span className="text-status-error">-{d.removed}</span>
                        {d.deleted && <span className="text-status-error ml-1">DELETED</span>}
                      </span>
                    </div>
                    <pre className="p-2 overflow-x-auto text-[9px] font-mono leading-relaxed max-h-48 overflow-y-auto">
                      {d.lines.map((l, i) => (
                        <div key={i} className={l.startsWith('+') ? 'text-brand/90 bg-brand/[0.06]' : l.startsWith('-') ? 'text-status-error/90 bg-status-error/[0.06]' : 'text-text-tertiary'}>
                          {l}
                        </div>
                      ))}
                    </pre>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
