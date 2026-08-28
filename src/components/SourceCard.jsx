import { motion } from 'framer-motion';
import { ExternalLink } from 'lucide-react';
import { getFavicon, getDomain } from '../utils/helpers';

export default function SourceCard({ source, index }) {
  return (
    <motion.a 
      href={source.link} 
      target="_blank" 
      rel="noreferrer"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      className="block glass-card rounded-xl p-3 mb-2 hover:bg-[#00ff9d11] transition-colors"
    >
      <div className="flex items-start gap-3">
        <img src={getFavicon(source.link)} alt="" className="w-8 h-8 rounded-md mt-0.5" />
        <div className="flex-1 min-w-0">
          <h4 className="text-[11px] font-bold text-gray-200 truncate">{source.title}</h4>
          <p className="text-[9px] text-[#00FF9D] mb-1">
            {getDomain(source.link)}
            {(source.engines || []).length > 1 && (
              <span className="ml-1 text-[8px] text-gray-500">· found by {source.engines.length} engines</span>
            )}
          </p>
          <p className="text-[10px] text-gray-400 line-clamp-2">{source.snippet}</p>
        </div>
        <ExternalLink className="w-3 h-3 text-gray-500 mt-1" />
      </div>
      <div className="mt-2 h-0.5 bg-black/40 rounded-full overflow-hidden">
        <div className="h-full bg-[#00FF9D]" style={{ width: `${85 + Math.random() * 15}%` }} />
      </div>
    </motion.a>
  );
}
