import { motion } from 'framer-motion';
import { Menu, Activity } from 'lucide-react';

export default function Header() {
  return (
    <header className="sticky top-0 z-50 glass border-b border-[#00ff9d22] px-4 py-3 flex items-center justify-between" style={{ paddingTop: 'calc(0.75rem + var(--safe-top))' }}>
      <div className="flex items-center gap-2">
        <Menu className="w-5 h-5 text-[#00FF9D]" />
        <div>
          <h1 className="text-base font-bold tracking-wider">
            <span className="text-[#00FF9D]">JEXI</span> <span className="text-white">OS</span>
          </h1>
          <p className="text-[9px] text-gray-500 tracking-widest uppercase">Multi-Agent AI OS</p>
        </div>
      </div>
      <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-[#00ff9d15] border border-[#00ff9d44]">
        <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 2, repeat: Infinity }} className="w-2 h-2 rounded-full bg-[#00FF9D]" />
        <span className="text-[10px] font-bold text-[#00FF9D]">ONLINE</span>
      </div>
    </header>
  );
}
