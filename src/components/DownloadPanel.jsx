import { motion } from 'framer-motion';
import {
  Smartphone, Download, ShieldCheck, Zap, CheckCircle2, PlayCircle, Github, Sparkles, Wifi, Star, RefreshCw, Loader2, AlertTriangle
} from 'lucide-react';
import useUpdateChecker from '../hooks/useUpdateChecker';
import useApkInstaller from '../hooks/useApkInstaller';

// Permanent direct link — GitHub always points this at the newest "Latest" release.
const APK_URL = 'https://github.com/lewiseinstein15-Tech/jexi-os-/releases/latest/download/app-debug.apk';
const RELEASES_URL = 'https://github.com/lewiseinstein15-Tech/jexi-os-/releases';

const fadeUp = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
};

export default function DownloadPanel() {
  const updater = useUpdateChecker();
  const installer = useApkInstaller();

  const buttonLabel = () => {
    const base = updater.updateAvailable ? `UPDATE TO BUILD #${updater.latest.number}` : 'DOWNLOAD JEXI OS APK';
    if (!installer.isAndroid) return base;
    if (installer.phase === 'installing') return 'OPENING INSTALLER…';
    if (installer.phase === 'downloading') {
      return installer.progress >= 0 ? `DOWNLOADING ${installer.progress}%` : 'DOWNLOADING…';
    }
    return base;
  };

  const steps = [
    {
      icon: Download,
      title: 'Download the APK',
      text: 'Tap the big green button — it grabs the newest build automatically, straight from GitHub.',
    },
    {
      icon: ShieldCheck,
      title: 'Allow unknown sources',
      text: 'Android asks for permission the first time. Tap Settings → “Allow from this source”.',
    },
    {
      icon: PlayCircle,
      title: 'Install & launch',
      text: 'Tap Install, then open JEXI OS from your home screen — own icon, splash screen, full-screen app.',
    },
  ];

  return (
    <div className="space-y-4">
      {/* Hero card */}
      <motion.div
        {...fadeUp}
        className="surface-card relative overflow-hidden rounded-2xl p-5 text-center"
      >
        {/* decorative glow */}
        <div className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full bg-brand-dim blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-16 w-56 h-56 rounded-full bg-[#a78bfa]/10 blur-3xl" />

        {/* mini app-icon ring */}
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 14, ease: 'linear' }}
          className="relative mx-auto mb-4 w-20 h-20 rounded-[22px] bg-[#0b0b16] border border-[#1c1c2e] flex items-center justify-center"
        >
          <div className="absolute inset-2 rounded-full border-2 border-transparent"
            style={{ borderTopColor: '#22d3ee', borderRightColor: '#a78bfa', borderBottomColor: '#f472b6' }} />
          <Smartphone className="w-7 h-7 text-[#00FF9D]" />
        </motion.div>

        <h2 className="text-lg font-bold text-text-primary tracking-tight">
          Get JEXI OS as a <span className="text-brand">Real App</span>
        </h2>
        <p className="text-[10px] text-text-secondary mt-1 max-w-xs mx-auto leading-relaxed">
          Install JEXI OS on your Android phone like any normal app — own icon, splash screen, full-screen window.
        </p>

        {/* Big download button — inside the app it installs directly; on web it opens the link */}
        {installer.isAndroid ? (
          <button
            onClick={installer.start}
            disabled={installer.busy}
            className="mt-5 relative inline-flex items-center justify-center gap-2.5 bg-brand text-black rounded-full px-8 py-4 font-bold tracking-wide shadow-[0_0_30px_rgba(0,255,157,0.35)] hover:shadow-[0_0_45px_rgba(0,255,157,0.55)] transition-shadow disabled:opacity-80 disabled:cursor-wait min-w-[240px] active:scale-[0.97]"
          >
            {installer.busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
            {buttonLabel()}
            {updater.updateAvailable && !installer.busy && (
              <>
                <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-brand animate-ping" />
                <span className="absolute -top-2.5 -right-2.5 bg-agent-vision text-white text-[7px] font-black rounded-full px-2 py-0.5">
                  NEW
                </span>
              </>
            )}
          </button>
        ) : (
          <motion.a
            href={APK_URL}
            target="_blank"
            rel="noopener noreferrer"
            whileTap={{ scale: 0.96 }}
            className="mt-5 relative inline-flex items-center justify-center gap-2.5 bg-brand text-black rounded-full px-8 py-4 font-bold tracking-wide shadow-[0_0_30px_rgba(0,255,157,0.35)] hover:shadow-[0_0_45px_rgba(0,255,157,0.55)] transition-shadow"
          >
            <Download className="w-5 h-5" />
            {buttonLabel()}
            {updater.updateAvailable && (
              <>
                <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-brand animate-ping" />
                <span className="absolute -top-2.5 -right-2.5 bg-agent-vision text-white text-[7px] font-black rounded-full px-2 py-0.5">
                  NEW
                </span>
              </>
            )}
          </motion.a>
        )}

        {/* in-app download progress + result hints */}
        {installer.busy && (
          <div className="mt-4 text-left">
            <div className="h-2 rounded-full bg-surface-2 overflow-hidden border border-brand-line">
              <motion.div
                className="h-full rounded-full bg-brand"
                animate={{ width: installer.phase === 'installing' ? '100%' : `${Math.max(4, installer.progress)}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <p className="mt-2 text-[9px] text-text-secondary font-mono">
              {installer.phase === 'installing'
                ? 'Saving the new build… then opening the Android installer.'
                : `Downloading the newest JEXI OS build${installer.progress >= 0 ? ` — ${installer.progress}%` : '…'}`}
            </p>
          </div>
        )}
        {installer.phase === 'done' && (
          <p className="mt-3 text-[10px] font-bold text-[#22c55e] flex items-center justify-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> Tap INSTALL in the Android dialog — JEXI OS will update itself.
          </p>
        )}
        {installer.phase === 'error' && (
          <div className="mt-3 rounded-xl bg-[#f87171]/10 border border-[#f87171]/40 p-3 text-left">
            <p className="text-[9px] font-bold text-[#f87171] flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> Install blocked — {installer.error}
            </p>
            <p className="text-[8px] text-gray-400 mt-1 leading-relaxed">
              First time only: <span className="text-gray-200">Settings → Apps → JEXI OS → “Install unknown apps” → Allow</span>, then tap
              UPDATE again. Or grab the file from your browser below.
            </p>
            <div className="flex gap-2 mt-2">
              <button
                onClick={installer.start}
                className="bg-[#f87171]/20 border border-[#f87171]/50 text-[#f87171] rounded-lg px-3 py-1.5 text-[9px] font-black"
              >
                RETRY UPDATE
              </button>
              <a
                href={APK_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-300 border border-gray-700 rounded-lg px-3 py-1.5 text-[9px] font-black"
              >
                BROWSER LINK
              </a>
            </div>
          </div>
        )}

        {/* badges */}
        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          {['100% FREE', 'NO PLAY STORE', 'NO CARD NEEDED'].map((b) => (
            <span key={b} className="text-[8px] font-bold text-brand bg-brand-dim border border-brand-line rounded-full px-2.5 py-1">
              {b}
            </span>
          ))}
        </div>
        <p className="text-[8px] text-text-tertiary mt-3">
          Android 7.0+ • debug-signed, sideload-friendly • rebuilt automatically after every update
        </p>
      </motion.div>

      {/* Auto-update status */}
      <motion.div {...fadeUp} transition={{ delay: 0.05 }} className="surface-card rounded-xl p-3.5">
        <div className="flex items-center gap-2 mb-2">
          <RefreshCw className={`w-3.5 h-3.5 text-brand ${updater.checking ? 'animate-spin' : ''}`} />
          <h3 className="text-[10px] font-bold text-brand tracking-wider">AUTO-UPDATE STATUS</h3>
          <button
            onClick={updater.checkNow}
            disabled={updater.checking}
            className="ml-auto text-gray-500 hover:text-[#00FF9D] transition-colors p-1 disabled:opacity-50"
            title="Check for updates now"
          >
            <RefreshCw className={`w-3 h-3 ${updater.checking ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {!updater.enabled ? (
          <p className="text-[9px] text-text-secondary leading-relaxed">
            You're viewing a <span className="text-text-primary font-bold">web/dev build</span> — websites always serve the
            newest version automatically, so no update checks are needed here.
          </p>
        ) : (
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-[9px]">
              <span className="text-text-tertiary">Installed build</span>
              <span className="text-text-primary font-bold font-mono">{updater.installedTag || 'unknown'}</span>
            </div>
            <div className="flex justify-between items-center text-[9px]">
              <span className="text-text-tertiary">Latest build</span>
              {updater.latest ? (
                <span className="text-text-primary font-bold font-mono">
                  {updater.latest.tag}
                  {updater.latest.date && <span className="text-text-tertiary font-normal"> · {updater.latest.date}</span>}
                </span>
              ) : (
                <span className="text-text-tertiary">
                  {updater.checking ? 'checking…' : updater.error ? 'offline — will retry' : '—'}
                </span>
              )}
            </div>
            {updater.updateAvailable ? (
              <div className="flex items-center gap-1.5 mt-1.5 bg-brand-dim border border-brand-line rounded-lg px-2 py-1.5">
                <span className="relative flex w-1.5 h-1.5 flex-shrink-0">
                  <span className="absolute inline-flex w-full h-full rounded-full bg-brand opacity-60 animate-ping" />
                  <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-brand" />
                </span>
                <span className="text-[8px] font-black text-brand">NEW UPDATE READY — TAP THE GREEN BUTTON ABOVE</span>
              </div>
            ) : updater.latest && !updater.error ? (
              <div className="flex items-center gap-1.5 mt-1.5 text-brand">
                <CheckCircle2 className="w-3 h-3" />
                <span className="text-[8px] font-bold">YOU'RE ON THE LATEST BUILD</span>
              </div>
            ) : null}
            <p className="text-[8px] text-text-tertiary mt-1.5 leading-relaxed">
              The app checks for new builds automatically every few minutes and the moment you open it — no need to
              manually re-check for updates ever again.
            </p>
          </div>
        )}
      </motion.div>

      {/* Install steps */}
      <motion.div {...fadeUp} transition={{ delay: 0.08 }} className="space-y-2.5">
        <div className="flex items-center gap-2 px-1">
          <Zap className="w-3.5 h-3.5 text-[#00FF9D]" />
          <h3 className="text-[11px] font-bold text-[#00FF9D] tracking-wider">INSTALL IN 3 TAPS</h3>
        </div>
        {steps.map(({ icon: Icon, title, text }, i) => (
          <motion.div
            key={title}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 + i * 0.08 }}
            className="glass rounded-xl p-3.5 flex gap-3 items-start"
          >
            <div className="relative flex-shrink-0">
              <div className="w-9 h-9 rounded-xl bg-[#00FF9D]/10 border border-[#00FF9D]/20 flex items-center justify-center">
                <Icon className="w-4 h-4 text-[#00FF9D]" />
              </div>
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[#00FF9D] text-black text-[8px] font-black flex items-center justify-center">
                {i + 1}
              </span>
            </div>
            <div>
              <p className="text-[11px] font-bold text-white">{title}</p>
              <p className="text-[9px] text-gray-500 mt-0.5 leading-relaxed">{text}</p>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* Honest note */}
      <motion.div {...fadeUp} transition={{ delay: 0.3 }} className="glass rounded-xl p-3.5 flex gap-2.5 items-start">
        <Wifi className="w-3.5 h-3.5 text-[#00d4ff] flex-shrink-0 mt-0.5" />
        <p className="text-[9px] text-gray-500 leading-relaxed">
          <span className="text-[#00d4ff] font-bold">Internet note:</span> the app is fully installed and opens instantly —
          but JEXI's brain (AI chat, vision, virtual desktop) runs on a free cloud server, so those features need a
          connection. The app reconnects automatically when you're back online.
        </p>
      </motion.div>

      {/* More options */}
      <motion.div {...fadeUp} transition={{ delay: 0.36 }} className="flex gap-2">
        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 glass rounded-xl p-3 flex items-center justify-center gap-2 hover:border-[#00FF9D]/40 transition-colors"
        >
          <Github className="w-3.5 h-3.5 text-gray-300" />
          <span className="text-[9px] font-bold text-gray-300">ALL BUILD VERSIONS</span>
        </a>
        <div className="flex-1 glass rounded-xl p-3 flex items-center justify-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#00FF9D]" />
          <span className="text-[9px] font-bold text-gray-300">BUILT BY GITHUB ACTIONS</span>
        </div>
      </motion.div>

      {/* mini footer */}
      <div className="flex items-center justify-center gap-1.5 pt-1 pb-2">
        <Sparkles className="w-3 h-3 text-[#a78bfa]" />
        <span className="text-[8px] text-gray-600">JEXI OS — created by Lewis Einstein · AI & ML Engineer</span>
        <Star className="w-3 h-3 text-[#f472b6]" />
      </div>
    </div>
  );
}
