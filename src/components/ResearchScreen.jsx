import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Search, Send, Loader2, FileSearch, PenLine, Globe, CheckCircle2, History } from 'lucide-react';
import TypedMessage from './TypedMessage';
import AgentPipeline from './AgentPipeline';

/** Concrete example topics — never the vague "in this field" default. */
const TOPIC_CHIPS = [
  { label: 'Solar panels', query: 'Research how solar panels work and explain it to me with sources' },
  { label: 'Open-source AI agents', query: 'Research the latest developments in open-source AI agents and give me a sourced summary' },
  { label: 'Quantum computing', query: 'Research the biggest quantum computing breakthroughs this year and give me a sourced summary' },
  { label: 'Free AI APIs', query: 'Research the best free AI APIs for building agents and compare them, with sources' },
];

/** The research team pipeline, shown so the launch never looks frozen. */
const TEAM = [
  { icon: FileSearch, label: 'SEARCH', desc: 'query analysis + web search' },
  { icon: PenLine, label: 'EXTRACT', desc: 'pull facts from sources' },
  { icon: Globe, label: 'SYNTHESIZE', desc: 'sourced summary' },
  { icon: CheckCircle2, label: 'VERIFY', desc: 'cross-check + cite' },
];

export default function ResearchScreen({ engine, onResearch }) {
  const [input, setInput] = useState('');
  const scrollRef = useRef(null);
  const { messages, logs, isProcessing } = engine;

  // Auto-follow the live stream as agents work and the answer types out.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, logs, isProcessing]);

  const submit = (q) => {
    const text = (q ?? input).trim();
    if (!text || isProcessing) return;
    onResearch(text);
    setInput('');
  };

  const idle = messages.length === 0 && !isProcessing;

  return (
    <div className="mx-auto w-full max-w-[640px] px-4 pt-6 pb-16 space-y-5">
      {/* Header */}
      <div className="space-y-1.5">
        <p className="eyebrow">JEXI OS · RESEARCH</p>
        <h1 className="text-[20px] font-bold tracking-tight text-text-primary">Research console</h1>
        <p className="text-[12px] text-text-secondary leading-relaxed">
          Give JEXI a topic. The research team —{' '}
          <span className="text-brand font-semibold">Search → Extract → Synthesize → Verify</span> — runs live below and returns a sourced summary.
        </p>
      </div>

      {/* Topic input */}
      <motion.form
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        className="surface-float flex items-center gap-2 rounded-xl p-2 pl-4 transition-all duration-200 focus-within:border-brand-line focus-within:shadow-[0_0_0_3px_var(--brand-dim)]"
      >
        <Search className="w-4 h-4 text-text-tertiary flex-shrink-0" />
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What should I research? e.g. latest EV battery technology"
          className="flex-1 bg-transparent text-text-primary placeholder-text-tertiary rounded-lg py-3 text-[14px] focus:outline-none"
        />
        <button
          type="submit"
          disabled={!input.trim() || isProcessing}
          className="w-11 h-11 flex items-center justify-center rounded-full bg-brand text-[#04140D] disabled:bg-surface-2 disabled:text-text-tertiary transition-all duration-200 hover:scale-105 hover:shadow-[0_0_18px_rgba(0,210,106,0.4)] active:scale-95"
          title="Research"
        >
          {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </motion.form>

      {/* Example topics */}
      <div className="flex flex-wrap gap-2">
        {TOPIC_CHIPS.map((c, i) => (
          <motion.button
            key={c.label}
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.05 + i * 0.04 }}
            onClick={() => submit(c.query)}
            disabled={isProcessing}
            className="rounded-full border border-hairline bg-surface-1 px-3 py-1.5 text-[10px] font-semibold text-text-secondary hover:text-brand hover:border-brand-line transition-all duration-150 active:scale-95 disabled:opacity-50"
          >
            {c.label}
          </motion.button>
        ))}
      </div>

      {/* Live work + research trail */}
      <div ref={scrollRef} className="space-y-3 max-h-[52dvh] overflow-y-auto pr-1">
        {idle ? (
          <div className="space-y-3">
            {/* Team explainer */}
            <div className="rounded-xl border border-hairline bg-surface-1 p-4">
              <p className="eyebrow mb-3">HOW THE TEAM WORKS</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {TEAM.map((s, i) => (
                  <div key={s.label} className="rounded-lg border border-hairline bg-surface-2/50 p-2.5">
                    <s.icon className="w-3.5 h-3.5 text-brand mb-1.5" />
                    <p className="text-[9px] font-bold tracking-wider text-text-primary">{s.label}</p>
                    <p className="text-[8.5px] text-text-tertiary leading-snug mt-0.5">{s.desc}</p>
                  </div>
                ))}
              </div>
            </div>
            {/* Hint card */}
            <div className="rounded-lg border border-brand-line bg-brand-dim/30 px-3 py-2.5 flex items-start gap-2.5">
              <History className="w-3.5 h-3.5 text-brand flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-text-secondary leading-relaxed">
                Pick an example above or type your own topic. JEXI searches the web, pulls facts from the best sources, and verifies before answering — every claim in the summary carries a citation.
              </p>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[92%] p-3 ${
                  msg.role === 'user'
                    ? 'rounded-lg rounded-tr-sm bg-gradient-to-br from-brand to-[#00B55C] text-[#04140D] font-medium text-[11px] shadow-[0_4px_18px_rgba(0,210,106,0.28)]'
                    : 'rounded-lg rounded-tl-sm bg-surface-1 text-text-primary border border-hairline'
                }`}>
                  {msg.role === 'user' ? (
                    <div className="whitespace-pre-wrap break-words">
                      {msg.image && <img src={msg.image} alt="attachment" className="max-w-[220px] rounded-lg mb-2 border border-black/20" />}
                      {msg.text}
                    </div>
                  ) : (
                    <TypedMessage text={msg.text} />
                  )}
                </div>
              </motion.div>
            ))}
            {isProcessing && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex justify-start"
              >
                <div className="w-full bg-[#0c0e12] border border-white/[0.07] rounded-lg overflow-hidden">
                  <AgentPipeline logs={logs} isProcessing />
                </div>
              </motion.div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
