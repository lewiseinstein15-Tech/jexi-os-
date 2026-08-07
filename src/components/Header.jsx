import { motion } from 'framer-motion';

export default function Header() {
  return (
    <motion.div 
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 pb-2"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            JEXI <span className="text-[#00FF9D]">OS</span>
          </h1>
          <p className="text-[9px] text-gray-500 font-medium tracking-wider">
            MULTI-AGENT AI OS • BY LEWIS EINSTEIN
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#00FF9D] animate-pulse" />
          <span className="text-[10px] text-[#00FF9D] font-bold">ONLINE</span>
        </div>
      </div>
    </motion.div>
  );
}
