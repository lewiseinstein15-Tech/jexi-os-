import { motion } from 'framer-motion';
import { CheckCircle2, Loader2, FileText } from 'lucide-react';

export default function WebsiteCard({ site }) {
  return (
    <motion.div 
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="glass-card rounded-lg p-2 mb-2 flex items-center gap-3"
    >
      <img src={site.favicon} alt="" className="w-6 h-6 rounded-md" />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-medium text-gray-200 truncate">{site.title}</p>
        <p className="text-[8px] text-gray-500 truncate flex items-center gap-1">
          <FileText className="w-2 h-2" /> {site.wordCount} words · {site.domain}
        </p>
      </div>
      <div className={`flex items-center gap-1 ${site.status === 'success' ? 'text-[#00FF9D]' : 'text-blue-400'}`}>
        {site.status === 'success' ? <CheckCircle2 className="w-3 h-3" /> : <Loader2 className="w-3 h-3 animate-spin" />}
        <span className="text-[8px] uppercase tracking-wider">{site.status === 'success' ? 'Read' : 'Loading'}</span>
      </div>
    </motion.div>
  );
}
