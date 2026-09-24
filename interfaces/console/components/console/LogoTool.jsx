/* JEXI Market logo — inlined VERBATIM from jexi/web brand.tsx JexiMark.
   Zero external files, zero CDN — the same mark the approved preview uses. */

export function JexiMark({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-label="JEXI">
      <rect width="64" height="64" rx="15" fill="url(#jexi-tile)" />
      <rect x="0.5" y="0.5" width="63" height="63" rx="14.5" stroke="#3a3226" />
      <path
        d="M18 14 L18 38 Q18 50 29 50 Q37 50 40.5 44"
        stroke="url(#jexi-j)"
        strokeWidth="5.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M34 40 L41 33 L46 37 L54 24"
        stroke="#FFB88C"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="54" cy="24" r="3.4" fill="#FF6B5E" />
      <defs>
        <linearGradient id="jexi-tile" x1="0" y1="0" x2="64" y2="64">
          <stop stopColor="#1a1712" />
          <stop offset="1" stopColor="#12100c" />
        </linearGradient>
        <linearGradient id="jexi-j" x1="18" y1="14" x2="41" y2="50">
          <stop stopColor="#FF7A3D" />
          <stop offset="1" stopColor="#FF6B5E" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* Sidebar brand lockup: mark + "JEXI" display wordmark + "OS" label —
   identical to the preview's .brand block. */
export default function LogoTool({ onHome }) {
  return (
    <div className="brand">
      <span className="mark"><JexiMark size={30} /></span>
      <button
        type="button"
        className="word"
        onClick={onHome}
        title="Back to JEXI classic"
        style={{ cursor: onHome ? 'pointer' : 'default' }}
      >
        <b>JEXI</b><i>OS</i>
      </button>
    </div>
  );
}
