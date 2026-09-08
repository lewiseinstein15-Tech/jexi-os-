import { motion } from 'framer-motion';

/**
 * BootSplash (FINAL redesign) — a flat instrument boot, not a light show.
 * The old cyan→violet→pink conic "eye" read as generic-AI branding; this is
 * a plain status readout: wordmark, honest boot status, flat progress ring.
 * Shown only until the shell renders (App.jsx keeps it brief).
 */
export default function BootSplash({ status = 'Booting agent core' }) {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-void"
      aria-label="Loading JEXI OS"
      role="status"
    >
      {/* Flat progress ring — solid track, solid brand arc, no glow */}
      <div
        aria-hidden="true"
        style={{
          width: 46, height: 46, borderRadius: '50%',
          border: '3px solid rgba(255,255,255,0.10)',
          borderTopColor: '#FF8A3D',
          animation: 'jx-bootspin 0.9s linear infinite',
        }}
      />
      <style>{'@keyframes jx-bootspin { to { transform: rotate(360deg); } }'}</style>

      {/* Wordmark */}
      <p className="mt-6 text-[19px] font-black tracking-tight text-text-primary select-none">
        JEXI <span className="text-brand">OS</span>
      </p>
      <p className="mt-1 text-[8px] font-bold tracking-[0.3em] text-text-tertiary select-none uppercase">
        Multi-agent operating system
      </p>

      {/* Booting status — live: connects → brain online → fade */}
      <div className="mt-8 flex items-center">
        <span className="text-[9px] font-mono text-text-secondary">{status}</span>
        <span className="flex gap-0.5 ml-1.5" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="typing-dot w-1 h-1 rounded-full bg-brand"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </span>
      </div>
    </motion.div>
  );
}
