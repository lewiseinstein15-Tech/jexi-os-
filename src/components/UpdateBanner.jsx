import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDownToLine, X } from 'lucide-react';
import useUpdateChecker, { APK_DOWNLOAD_URL } from '../hooks/useUpdateChecker';

export default function UpdateBanner() {
  const { enabled, latest, updateAvailable, checking, dismissed, dismiss } = useUpdateChecker();

  const show = enabled && !checking && updateAvailable && dismissed !== latest?.tag;

  return (
    <AnimatePresence>
      {show && latest && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
          className="overflow-hidden"
        >
          <div className="mx-3 mt-3 rounded-xl bg-[#00FF9D]/10 border border-[#00FF9D]/40 px-3 py-2.5 flex items-center gap-2.5">
            <span className="relative flex w-2 h-2 flex-shrink-0">
              <span className="absolute inline-flex w-full h-full rounded-full bg-[#00FF9D] opacity-60 animate-ping" />
              <span className="relative inline-flex w-2 h-2 rounded-full bg-[#00FF9D]" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black text-[#00FF9D] tracking-wide">
                NEW UPDATE READY — build #{latest.number}
              </p>
              <p className="text-[8px] text-gray-400 truncate">
                {latest.notes ? `${latest.notes} · ` : ''}Released {latest.date || 'recently'} — tap UPDATE to get the newest JEXI OS
              </p>
            </div>
            <a
              href={APK_DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 bg-[#00FF9D] text-black rounded-lg px-3 py-1.5 text-[9px] font-black tracking-wide flex items-center gap-1.5 shadow-[0_0_20px_rgba(0,255,157,0.35)]"
            >
              <ArrowDownToLine className="w-3 h-3" />
              UPDATE
            </a>
            <button
              onClick={dismiss}
              className="flex-shrink-0 text-gray-500 hover:text-white transition-colors p-1"
              title="Remind me later"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
