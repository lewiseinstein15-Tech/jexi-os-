import { motion } from 'framer-motion';
import { BrainCircuit } from 'lucide-react';

export default function Header() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 pb-2"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="relative w-9 h-9 rounded-xl bg-[#0b0b16] border border-[#1c1c2e] flex items-center justify-center flex-shrink-0">
            <div
              className="absolute inset-1 rounded-full border-2 border-transparent"
              style={{ borderTopColor: '#22d3ee', borderRightColor: '#a78bfa', borderBottomColor: '#f472b6' }}
            />
            <BrainCircuit className="w-4 h-4 text-[#00FF9D]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight leading-none">
              JEXI <span className="text-[#00FF9D]">OS</span>
            </h1>
            <p className="text-[9px] text-gray-500 font-medium tracking-wider mt-1">
              MULTI-AGENT AI OS • BY LEWIS EINSTEIN
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-[#00FF9D]/5 border border-[#00FF9D]/20 rounded-full px-2.5 py-1.5">
          <div className="w-2 h-2 rounded-full bg-[#00FF9D] animate-pulse" />
          <span className="text-[9px] text-[#00FF9D] font-bold tracking-wider">ONLINE</span>
        </div>
      </div>
    </motion.div>
  );
}
