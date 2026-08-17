import { motion } from 'framer-motion';
import { Hammer, Search, GraduationCap, Link2, Camera, Stethoscope } from 'lucide-react';

/**
 * Capability cards (B93) — moved from the Command Center's chat empty-state
 * to the HOME page per the owner's request. One tap starts the task.
 */

export const CAPABILITIES = [
  { icon: Hammer, label: 'BUILD AN APP', hint: 'calculator, tracker, website…', query: 'Build me a calculator web app', tile: 'bg-gradient-to-br from-emerald-400/25 to-emerald-400/5 text-emerald-300 border-emerald-400/25' },
  { icon: Search, label: 'RESEARCH', hint: 'many sources, cited facts', query: 'Research how solar panels work and explain it to me', tile: 'bg-gradient-to-br from-cyan-400/25 to-cyan-400/5 text-cyan-300 border-cyan-400/25' },
  { icon: GraduationCap, label: 'STUDY', hint: 'deep-learn a topic, save it', query: 'Study the basics of machine learning and save it to my knowledge', tile: 'bg-gradient-to-br from-violet-400/25 to-violet-400/5 text-violet-300 border-violet-400/25' },
  { icon: Link2, label: 'OPEN A LINK', hint: 'YouTube, TikTok, articles', query: 'Open a popular YouTube video about artificial intelligence and tell me what it is about', tile: 'bg-gradient-to-br from-sky-400/25 to-sky-400/5 text-sky-300 border-sky-400/25' },
  { icon: Camera, label: 'USE MY EYES', hint: 'camera vision', vision: true, tile: 'bg-gradient-to-br from-pink-400/25 to-pink-400/5 text-pink-300 border-pink-400/25' },
  { icon: Stethoscope, label: 'SELF-CHECK', hint: 'health + source of issues', query: 'JEXI, run a full system self-check now. Check your health, memory, eyes and recent errors. If anything is wrong, tell me the exact source file and the fix.', tile: 'bg-gradient-to-br from-amber-400/25 to-amber-400/5 text-amber-300 border-amber-400/25' },
];

export default function CapabilityCards({ onSend, onVision, compact = false }) {
  return (
    <div className={`grid grid-cols-2 gap-3 ${compact ? 'sm:grid-cols-3' : 'sm:grid-cols-3'}`}>
      {CAPABILITIES.map((c, i) => (
        <motion.button
          key={c.label}
          type="button"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05, duration: 0.25 }}
          whileTap={{ scale: 0.96 }}
          onClick={() => (c.vision ? (onVision ? onVision() : undefined) : onSend(c.query))}
          className="group relative flex items-center gap-2.5 overflow-hidden rounded-lg border border-hairline bg-surface-1 px-3 py-3 text-left transition-all duration-200 hover:border-hairline-strong active:scale-[0.98]"
        >
          <div className={`flex-shrink-0 w-10 h-10 rounded-md border flex items-center justify-center transition-transform duration-200 group-hover:scale-110 ${c.tile}`}>
            <c.icon className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-text-primary group-hover:text-brand">{c.label}</p>
            <p className="text-[10px] text-text-tertiary truncate">{c.hint}</p>
          </div>
        </motion.button>
      ))}
    </div>
  );
}
