import { motion } from 'framer-motion';
import { BrainCircuit, Sparkles } from 'lucide-react';

export default function Header() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 pb-2 relative z-10"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Logo — spinning conic ring + soft glow behind the icon */}
          <div className="relative w-10 h-10 flex-shrink-0">
            <div
              className="spin-ring absolute -inset-0.5 rounded-2xl opacity-90"
              style={{
                background:
                  'conic-gradient(from 0deg, #00ff9d, #22d3ee, #a78bfa, #f472b6, #00ff9d)',
                WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                WebkitMaskComposite: 'xor',
                maskComposite: 'exclude',
                padding: '1.5px',
              }}
            />
            <div
              className="absolute inset-0 rounded-2xl blur-md opacity-30"
              style={{ background: 'radial-gradient(circle, rgba(0,255,157,0.35), transparent 70%)' }}
            />
            <div className="relative w-full h-full rounded-2xl bg-[#0b0b16] border border-white/5 flex items-center justify-center">
              <BrainCircuit className="w-5 h-5 text-[#00FF9D]" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight leading-none">
              JEXI <span className="text-gradient">OS</span>
            </h1>
            <p className="text-[9px] text-gray-500 font-semibold tracking-[0.22em] mt-1.5 uppercase">
              Multi-agent AI · By Lewis Einstein
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 bg-white/[0.04] border border-white/10 rounded-full px-2.5 py-1.5">
            <Sparkles className="w-3 h-3 text-[#22d3ee]" />
            <span className="text-[8px] text-cyan-300 font-bold tracking-wider">20 AGENTS</span>
          </div>
          <div
            className="flex items-center gap-1.5 bg-[#00FF9D]/[0.07] border border-[#00FF9D]/25 rounded-full px-2.5 py-1.5"
            style={{ animation: 'pulseGlow 2.6s ease-in-out infinite' }}
          >
            <span className="relative flex w-2 h-2">
              <span className="absolute inline-flex w-full h-full rounded-full bg-[#00FF9D] opacity-60 animate-ping" />
              <span className="relative inline-flex w-2 h-2 rounded-full bg-[#00FF9D]" />
            </span>
            <span className="text-[8px] text-[#00FF9D] font-bold tracking-wider">ONLINE</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
