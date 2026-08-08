import { motion } from 'framer-motion';
import {
  Smartphone, Download, ShieldCheck, Zap, CheckCircle2, PlayCircle, Github, Sparkles, Wifi, Star
} from 'lucide-react';

// Permanent direct link — GitHub always points this at the newest "Latest" release.
const APK_URL = 'https://github.com/lewiseinstein15-Tech/jexi-os-/releases/latest/download/app-debug.apk';
const RELEASES_URL = 'https://github.com/lewiseinstein15-Tech/jexi-os-/releases';

const fadeUp = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
};

export default function DownloadPanel() {
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
        className="glass relative overflow-hidden rounded-2xl p-5 text-center"
      >
        {/* decorative glow */}
        <div className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full bg-[#00FF9D]/10 blur-3xl" />
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

        <h2 className="text-lg font-bold text-white tracking-tight">
          Get JEXI OS as a <span className="text-[#00FF9D]">Real App</span>
        </h2>
        <p className="text-[10px] text-gray-400 mt-1 max-w-xs mx-auto leading-relaxed">
          Install JEXI OS on your Android phone like any normal app — own icon, splash screen, full-screen window.
        </p>

        {/* Big download button */}
        <motion.a
          href={APK_URL}
          target="_blank"
          rel="noopener noreferrer"
          whileTap={{ scale: 0.96 }}
          className="mt-5 relative inline-flex items-center justify-center gap-2.5 bg-[#00FF9D] text-black rounded-2xl px-8 py-4 font-black tracking-wide shadow-[0_0_30px_rgba(0,255,157,0.35)] hover:shadow-[0_0_45px_rgba(0,255,157,0.55)] transition-shadow"
        >
          <Download className="w-5 h-5" />
          DOWNLOAD JEXI OS APK
          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-[#00FF9D] animate-ping" />
        </motion.a>

        {/* badges */}
        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          {['100% FREE', 'NO PLAY STORE', 'NO CARD NEEDED'].map((b) => (
            <span key={b} className="text-[8px] font-bold text-[#00FF9D] bg-[#00FF9D]/10 border border-[#00FF9D]/20 rounded-full px-2.5 py-1">
              {b}
            </span>
          ))}
        </div>
        <p className="text-[8px] text-gray-500 mt-3">
          Android 7.0+ • debug-signed, sideload-friendly • rebuilt automatically after every update
        </p>
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
