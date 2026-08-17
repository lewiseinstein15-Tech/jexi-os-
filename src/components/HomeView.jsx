import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Send, Search, Code2, Sigma, Ruler, BarChart3, Workflow, ArrowRight, Loader2, Paperclip, X, FileText, Image as ImageIcon } from 'lucide-react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';

// Semantic accent quick actions (spec §49) — small icon + name + description,
// tinted via the CSS accent utilities, never dominating the screen.
const QUICK_ACTIONS = [
  { id: 'research', icon: Search, label: 'Research', desc: 'deep-dive any topic', accent: 'acc-research', tile: 'tile-research', query: 'Research the latest developments in open-source AI agents and give me a sourced summary' },
  { id: 'code', icon: Code2, label: 'Code', desc: 'build an app or fix a bug', accent: 'acc-code', tile: 'tile-code', query: 'Build me a complete web application' },
  { id: 'math', icon: Sigma, label: 'Mathematics', desc: 'solve with full LaTeX', accent: 'acc-math', tile: 'tile-math', query: 'Solve this step by step with full working: x² − 5x + 6 = 0' },
  { id: 'engineering', icon: Ruler, label: 'Engineering', desc: 'calculations with units', accent: 'acc-engineering', tile: 'tile-engineering', query: 'A 10 kg mass accelerates at 4 m/s² — find the force, with full working and verification' },
  { id: 'analyze', icon: BarChart3, label: 'Analyze', desc: 'data, statistics, insight', accent: 'acc-analysis', tile: 'tile-analysis', query: 'Analyze this dataset and report the key statistics' },
  { id: 'automate', icon: Workflow, label: 'Automate', desc: 'recurring workflows', accent: 'acc-automation', tile: 'tile-automation', query: 'Set up a recurring workflow for this task' },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Up late.';
  if (h < 12) return 'Good morning.';
  if (h < 18) return 'Good afternoon.';
  return 'Good evening.';
}

export default function HomeView({ messages, logs, isProcessing, onSend, onOpenCommand }) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]); // { id, name, kind, size }
  const [uploading, setUploading] = useState(false);
  const fileRef = React.useRef(null);

  const pickFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { alert('File too large (max 25 MB)'); return; }
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      const res = await jexiFetch(`${getBackendUrl()}/api/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, data: b64 }),
      });
      const d = await res.json();
      if (d.ok) setAttachments((prev) => [...prev, { id: d.id, name: d.name, kind: d.kind, size: d.size }]);
      else alert(d.error || 'Upload failed');
    } catch (err) { alert('Upload failed: ' + String(err.message || err)); }
    setUploading(false);
  };

  const submit = (text) => {
    const q = (text || '').trim();
    if (!q && !attachments.length) return;
    // Attach file context to the message ("summarize the attached file" if no text)
    onSend(q || 'Analyze the attached file(s)', attachments.length ? attachments : undefined);
    setAttachments([]);
    onOpenCommand();
  };

  const recent = messages.filter((m) => m.role === 'user').slice(-5).reverse();
  const lastLog = logs.length ? logs[logs.length - 1] : null;

  return (
    <div className="mx-auto w-full max-w-[640px] px-4 pt-8 pb-16 md:pt-12 space-y-8">
      {/* Greeting */}
      <div className="space-y-2">
        <p className="eyebrow">JEXI OS · WORKSPACE</p>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="text-[26px] font-bold tracking-tight leading-tight text-text-primary"
        >
          {greeting()}
          <br />
          <span className="text-text-secondary">What are we building?</span>
        </motion.h1>
        <p className="text-[13px] text-text-secondary leading-relaxed">
          Ask JEXI to research, build, analyze, code, solve, run, deploy or automate — one agent team plans it, works it, and verifies the result.
        </p>
      </div>

      {/* Attached files */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((a, i) => (
            <span key={i} className="flex items-center gap-1.5 rounded-full border border-brand-line bg-brand-dim/30 pl-2 pr-1.5 py-1 text-[9px] text-brand">
              {a.kind === 'image' ? <ImageIcon className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
              {a.name} <button type="button" onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))} className="hover:text-status-error"><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      )}

      {/* ONE primary command input */}
      <motion.form
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        onSubmit={(e) => { e.preventDefault(); submit(input); }}
        className="surface-float flex items-center gap-2 rounded-xl p-2 pl-4 transition-all duration-200 focus-within:border-brand-line focus-within:shadow-[0_0_0_3px_var(--brand-dim)]"
      >
        <input type="file" ref={fileRef} onChange={pickFile} className="hidden" />
        <button
          type="button"
          onClick={() => fileRef.current && fileRef.current.click()}
          disabled={uploading || isProcessing}
          title="Attach a file (PDF, image, code, text…)"
          className="w-9 h-9 flex items-center justify-center rounded-lg text-text-tertiary hover:text-brand hover:bg-white/[0.04] disabled:opacity-40 flex-shrink-0"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
        </button>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask JEXI to research, build, analyze, code, solve…"
          className="flex-1 bg-transparent text-text-primary placeholder-text-tertiary rounded-lg py-3 text-[14px] focus:outline-none"
        />
        <button
          type="submit"
          disabled={!input.trim() || isProcessing}
          className="w-11 h-11 flex items-center justify-center rounded-full bg-brand text-[#04140D] disabled:bg-surface-2 disabled:text-text-tertiary transition-all duration-200 hover:scale-105 hover:shadow-[0_0_18px_rgba(0,210,106,0.4)] active:scale-95"
          title="Send"
        >
          {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </motion.form>

      {/* Quick actions — the B91 agent powers, one tap */}
      <div className="flex flex-wrap gap-1.5">
        {[
          ['🛠 Do Anything', '/do research the best budget phones and summarize the top 3'],
          ['📦 Build app', '/build a calculator app with a dark UI'],
          ['🔗 Read a link', 'Paste any YouTube/TikTok/Instagram/article link…'],
          ['✈️ Book travel', '/book me a flight from Nairobi to Mombasa'],
        ].map(([label, hint]) => (
          <button
            key={label}
            onClick={() => { setInput(hint); }}
            className="px-2.5 py-1.5 rounded-full border border-hairline bg-surface-2/60 text-[9px] font-semibold text-text-secondary hover:border-brand-line hover:text-brand transition-all"
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-[8px] text-text-tertiary -mt-4">v1.2 · B91 — links · builds · files · bookings</p>

      {/* Active agent strip — Home never looks frozen while a task runs */}
      {isProcessing && lastLog && (
        <div className="flex items-center gap-2.5 rounded-lg border border-brand-line bg-brand-dim/30 px-3 py-2.5">
          <Loader2 className="w-3.5 h-3.5 text-brand animate-spin flex-shrink-0" />
          <p className="text-[11px] text-text-primary font-mono truncate">
            <span className="text-brand font-bold">[{lastLog.agent}]</span> {lastLog.message}
          </p>
          <button
            type="button"
            onClick={onOpenCommand}
            className="ml-auto flex items-center gap-1 text-[9px] font-bold tracking-wider text-brand flex-shrink-0"
          >
            VIEW <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Planning phase — shimmer so the launch never reads as frozen */}
      {isProcessing && !lastLog && (
        <div className="rounded-lg border border-hairline bg-surface-1 px-3 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 text-brand animate-spin flex-shrink-0" />
            <p className="text-[11px] font-mono text-text-secondary">Planning the agent team…</p>
          </div>
          <div className="shimmer-bar h-2 rounded-full w-3/4" />
          <div className="shimmer-bar h-2 rounded-full w-1/2" />
        </div>
      )}

      {/* Quick actions */}
      <div>
        <p className="eyebrow mb-3">Quick actions</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {QUICK_ACTIONS.map((qa, i) => (
            <motion.button
              key={qa.id}
              type="button"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: 0.08 + i * 0.04 }}
              onClick={() => submit(qa.query)}
              className={`group rounded-xl border border-hairline ${qa.tile} px-3 py-3.5 text-left transition-all duration-200 hover:border-hairline-strong active:scale-[0.98]`}
            >
              <qa.icon className={`w-4 h-4 mb-2 ${qa.accent}`} />
              <p className={`text-[11px] font-bold ${qa.accent}`}>{qa.label}</p>
              <p className="text-[9.5px] text-text-tertiary mt-0.5 leading-snug">{qa.desc}</p>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Recent tasks */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="eyebrow">Recent tasks</p>
          <button
            type="button"
            onClick={onOpenCommand}
            className="flex items-center gap-1 text-[9px] font-bold tracking-wider text-brand hover:text-brand/80 transition-colors"
          >
            OPEN COMMAND CENTER <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        {recent.length === 0 ? (
          <div className="rounded-xl border border-hairline bg-surface-1 px-4 py-6 text-center">
            <p className="text-[11px] text-text-tertiary italic">No tasks yet — tell JEXI what to build and it will appear here.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {recent.map((m, i) => (
              <button
                key={i}
                type="button"
                onClick={onOpenCommand}
                className="w-full flex items-center gap-2.5 rounded-lg border border-hairline bg-surface-1 px-3 py-2.5 text-left transition-all duration-150 hover:border-hairline-strong hover:bg-surface-2"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-brand flex-shrink-0" />
                <span className="text-[11px] text-text-secondary truncate flex-1">{m.text}</span>
                <ArrowRight className="w-3 h-3 text-text-tertiary flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
