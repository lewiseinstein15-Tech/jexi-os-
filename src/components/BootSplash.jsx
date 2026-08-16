import { motion } from 'framer-motion';

/**
 * BootSplash (B79) — the branded loading screen shown when the app opens.
 *
 * The app must never present a blank screen between the native splash and the
 * first painted frame, so App.jsx keeps this overlay on top until the shell
 * has rendered (and for a short branded moment, ChatGPT/Claude style). It
 * mirrors the app icon: a rotating cyan→violet→pink ring with orbiting nodes
 * and a bright core, the wordmark, and a booting status line.
 */
const ORBIT_DOTS = [0, 60, 120, 180, 240, 300];

export default function BootSplash({ status = 'Booting agent core' }) {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.04 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-void"
      aria-label="Loading JEXI OS"
      role="status"
    >
      {/* The eye — rotating gradient ring + orbiting nodes + bright core */}
      <div className="relative w-24 h-24 mb-7">
        {/* Outer ring: conic brand gradient, slow continuous rotation */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: 'conic-gradient(from 0deg, #22d3ee, #a78bfa, #f472b6, #22d3ee)',
            WebkitMask: 'radial-gradient(closest-side, transparent 62%, black 64%)',
            mask: 'radial-gradient(closest-side, transparent 62%, black 64%)',
            animation: 'spinRing 7s linear infinite',
          }}
        />
        {/* Orbiting nodes — the icon's 6-node ring. Position lives on a static
            wrapper (the keyframe animation must never override it), the dot
            itself only pulses. */}
        {ORBIT_DOTS.map((deg) => (
          <span
            key={deg}
            className="absolute left-1/2 top-1/2"
            style={{ transform: `rotate(${deg}deg) translateX(44px) translate(-50%, -50%)` }}
          >
            <span className="block w-1.5 h-1.5 rounded-full bg-white/90 shadow-[0_0_8px_rgba(255,255,255,0.9)]" />
          </span>
        ))}
        {/* Core: dark disc with a pulsing brand heart */}
        <div className="absolute inset-[22%] rounded-full bg-[#090a0e] flex items-center justify-center">
          <span className="w-4 h-4 rounded-full bg-brand shadow-[0_0_18px_rgba(0,210,106,0.95)] animate-pulse" />
        </div>
      </div>

      {/* Wordmark */}
      <p className="text-[19px] font-black tracking-tight text-text-primary select-none">
        JEXI <span className="text-brand">OS</span>
      </p>
      <p className="mt-1 text-[8px] font-bold tracking-[0.3em] text-text-tertiary select-none uppercase">
        Multi-agent operating system
      </p>

      {/* Booting status — live: connects → brain online → fade */}
      <div className="mt-8 flex items-center gap-1.5">
        <span className="text-[9px] font-mono text-text-secondary">{status}</span>
        <span className="flex gap-0.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="typing-dot w-1 h-1 rounded-full bg-brand"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </span>
      </div>

      {/* Progress shimmer */}
      <div className="mt-3 w-40 h-[3px] rounded-full bg-surface-2 overflow-hidden">
        <div className="shimmer-bar h-full w-1/2" />
      </div>
    </motion.div>
  );
}
