/**
 * JEXI brand kit — matches the approved reference image.
 * Bolt (gradient lightning), Crown (orange outline), Wordmark (rounded JEXI).
 * Pure SVG/text, no emoji dependence, no network.
 */

export function Bolt({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="jx-bolt-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFB25A" />
          <stop offset="0.55" stopColor="#FF7A3D" />
          <stop offset="1" stopColor="#F43F5E" />
        </linearGradient>
      </defs>
      <path
        d="M18.5 2 5 18.2h8.3L11 30l14.5-17.4h-8.6L18.5 2z"
        fill="url(#jx-bolt-g)"
      />
    </svg>
  );
}

export function Crown({ size = 14, color = '#FF8A3D' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 8.5 7.2 11l4.8-5.5L16.8 11 21 8.5 18.8 17H5.2L3 8.5z"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx="3" cy="8.5" r="1.3" fill={color} />
      <circle cx="12" cy="5.5" r="1.3" fill={color} />
      <circle cx="21" cy="8.5" r="1.3" fill={color} />
    </svg>
  );
}

/** The rounded orange JEXI wordmark (sidebar, phone header). */
export function Wordmark({ size = 30 }) {
  return (
    <span className="jx-wordmark" style={{ fontSize: size }}>
      JEXI
    </span>
  );
}

/** Sidebar lockup: bolt + wordmark + tagline (reference layout). */
export function SidebarLockup() {
  return (
    <div className="jx-lockup">
      <Bolt size={34} />
      <div className="jx-lockup-t">
        <Wordmark size={29} />
        <span className="jx-lockup-sub">Think&nbsp;&nbsp;·&nbsp;&nbsp;Plan&nbsp;&nbsp;·&nbsp;&nbsp;Do&nbsp;&nbsp;·&nbsp;&nbsp;With You</span>
      </div>
    </div>
  );
}
