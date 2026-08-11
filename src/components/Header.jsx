import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import JexiCore from './JexiCore';

export default function Header({ plan = null, logs = [], running = false }) {
  // The active agent is the last one that logged — the Core lights its segment.
  let activeAgent = null;
  let roster = (plan?.roster) || [];
  if (logs.length > 0) activeAgent = logs[logs.length - 1].agent;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="px-4 pt-4 pb-3 relative z-10"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* The Core — a live visualization of what JEXI is doing (spec §6) */}
          <JexiCore size={32} roster={roster} activeAgent={activeAgent} running={running} done={!running && roster.length > 0} />

          <div>
            <h1 className="text-xl font-black text-white tracking-tight leading-none">
              JEXI <span className="text-gradient">OS</span>
            </h1>
            <p className="text-[8px] text-text-tertiary font-semibold tracking-[0.22em] mt-1.5 uppercase">
              Multi-agent AI · By Lewis Einstein
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 bg-white/[0.04] border border-hairline rounded-full px-2.5 py-1.5">
            <Sparkles className="w-3 h-3 text-cyan-400" />
            <span className="text-[8px] text-cyan-300 font-bold tracking-wider">
              {plan?.rosterCatalogSize || 79} AGENTS
            </span>
          </div>
          <div
            className="flex items-center gap-1.5 bg-brand-dim border border-brand-line rounded-full px-2.5 py-1.5"
            style={{ animation: 'pulseGlow 2.6s ease-in-out infinite' }}
          >
            <span className="relative flex w-2 h-2">
              <span className="absolute inline-flex w-full h-full rounded-full bg-brand opacity-60 animate-ping" />
              <span className="relative inline-flex w-2 h-2 rounded-full bg-brand" />
            </span>
            <span className="text-[8px] text-brand font-bold tracking-wider">ONLINE</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
