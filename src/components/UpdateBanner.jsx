import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDownToLine, Loader2, X, CheckCircle2 } from 'lucide-react';
import useUpdateChecker, { APK_DOWNLOAD_URL } from '../hooks/useUpdateChecker';
import useApkInstaller from '../hooks/useApkInstaller';

// B155 — monochrome only (black & white + grays, per the design rule).
// The old banner used the banned #00FF9D green brand; now it matches the
// flat black/white chat UI exactly like every other surface.
export default function UpdateBanner() {
  const { enabled, latest, updateAvailable, checking, dismissed, dismiss } = useUpdateChecker();
  const installer = useApkInstaller();

  const show = enabled && !checking && updateAvailable && dismissed !== latest?.tag;

  const buttonLabel = () => {
    if (!installer.isAndroid) return 'UPDATE';
    if (installer.phase === 'installing') return 'OPENING INSTALLER…';
    if (installer.phase === 'downloading') {
      return installer.progress >= 0 ? `DOWNLOADING ${installer.progress}%` : 'DOWNLOADING…';
    }
    return 'UPDATE';
  };

  const handleUpdate = () => {
    if (installer.isAndroid) installer.start();
    else window.open(APK_DOWNLOAD_URL, '_system', 'noopener');
  };

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
          <div className="mx-3 mt-3 rounded-xl bg-[#171717] border border-[#333333] px-3 py-2.5">
            <div className="flex items-center gap-2.5">
              <span className="relative flex w-2 h-2 flex-shrink-0">
                <span className="absolute inline-flex w-full h-full rounded-full bg-white opacity-40 animate-ping" />
                <span className="relative inline-flex w-2 h-2 rounded-full bg-white" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black text-white tracking-wide">
                  NEW UPDATE READY — build #{latest.number}
                </p>
                <p className="text-[8px] text-gray-400 truncate">
                  {latest.notes ? `${latest.notes} · ` : ''}Released {latest.date || 'recently'} — tap UPDATE to install the newest JEXI OS
                </p>
              </div>
              <button
                onClick={handleUpdate}
                disabled={installer.busy}
                className="flex-shrink-0 bg-white text-black rounded-lg px-3 py-1.5 text-[9px] font-black tracking-wide flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-wait min-w-[86px] justify-center"
              >
                {installer.busy ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <ArrowDownToLine className="w-3 h-3" />
                )}
                {buttonLabel()}
              </button>
              <button
                onClick={dismiss}
                disabled={installer.busy}
                className="flex-shrink-0 text-gray-500 hover:text-white transition-colors p-1 disabled:opacity-50"
                title="Remind me later"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* progress bar while downloading / installing */}
            {installer.busy && (
              <div className="mt-2 h-1.5 rounded-full bg-black/60 overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-white"
                  animate={{
                    width: installer.phase === 'installing' ? '100%' : `${Math.max(4, installer.progress)}%`,
                  }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            )}

            {/* success / error guidance — monochrome */}
            {installer.phase === 'done' && (
              <p className="mt-2 text-[8px] font-bold text-gray-200 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Installer opened — tap INSTALL in the Android dialog, then reopen JEXI OS.
              </p>
            )}
            {installer.phase === 'error' && (
              <div className="mt-2 text-[8px] text-gray-200 leading-relaxed">
                <p className="font-bold">Install was blocked: {installer.error}</p>
                <p className="text-gray-400 mt-0.5">
                  First time only: Settings → Apps → JEXI OS → “Install unknown apps” → Allow, then tap UPDATE again.
                </p>
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => installer.start()}
                    className="bg-white text-black rounded-md px-2 py-1 font-bold"
                  >
                    RETRY
                  </button>
                  <button
                    onClick={() => window.open(APK_DOWNLOAD_URL, '_system', 'noopener')}
                    className="text-gray-300 border border-gray-700 rounded-md px-2 py-1 font-bold"
                  >
                    USE BROWSER INSTEAD
                  </button>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
