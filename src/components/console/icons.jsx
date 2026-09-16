/* Console icon set — the same stroke SVGs the approved preview uses,
   inline (no icon packs, no CDN). */

const common = { viewBox: '0 0 24 24', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', stroke: 'currentColor' };

export function NavIcon({ name }) {
  switch (name) {
    case 'missions':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></svg>;
    case 'chat':
      return <svg {...common}><path d="M21 11.5a8.38 8.38 0 01-8.5 8.5c-1.6 0-3.1-.4-4.4-1.2L3 20l1.2-5.1A8.5 8.5 0 1121 11.5z" /></svg>;
    case 'workgraph':
      return <svg {...common}><circle cx="5.5" cy="6" r="2.5" /><circle cx="18.5" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M7.2 7.6l3.4 8M16.8 7.6l-3.4 8M8 6h8" /></svg>;
    case 'agents':
      return <svg {...common}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><circle cx="17.5" cy="9" r="2.5" /><path d="M15.5 14.7c2.8.2 5.2 1.9 6 5.3" /></svg>;
    case 'sessions':
      return <svg {...common}><path d="M4 6h16M4 12h16M4 18h10" /></svg>;
    case 'memory':
      return <svg {...common}><ellipse cx="12" cy="5.5" rx="8" ry="2.8" /><path d="M4 5.5V18c0 1.6 3.6 2.9 8 2.9s8-1.3 8-2.9V5.5" /><path d="M4 12c0 1.6 3.6 2.9 8 2.9s8-1.3 8-2.9" /></svg>;
    case 'skills':
      return <svg {...common}><path d="M13 2L4.5 13.5H11L9.5 22 19 9.5h-6.5L13 2z" /></svg>;
    case 'knowledge':
      return <svg {...common}><path d="M4 19V5a2 2 0 012-2h13v18H6a2 2 0 01-2-2z" /><path d="M19 17H6a2 2 0 00-2 2" /></svg>;
    case 'connectors':
      return <svg {...common}><path d="M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3" /><rect x="4" y="7" width="16" height="13" rx="2" /><path d="M12 11v5" /></svg>;
    case 'plugins':
      return <svg {...common}><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M3 9h18M8 4v5" /></svg>;
    case 'mcp':
      return <svg {...common}><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" /><path d="M11 7h4a2 2 0 012 2v4M13 17H9a2 2 0 01-2-2v-4" /></svg>;
    case 'scheduler':
      return <svg {...common}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M9 2h6" /></svg>;
    case 'model':
      return <svg {...common}><rect x="5" y="5" width="14" height="14" rx="3" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></svg>;
    case 'search':
      return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>;
    case 'check':
      return <svg {...common} strokeWidth="3"><path d="M4 12.5l5 5L20 6.5" /></svg>;
    case 'caret':
      return <svg {...common} strokeWidth="3"><path d="M9 6l6 6-6 6" /></svg>;
    case 'send':
      return <svg {...common} strokeWidth="2.4"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>;
    case 'pause':
      return <svg {...common} strokeWidth="2.2"><path d="M9 5v14M15 5v14" /></svg>;
    case 'stop':
      return <svg {...common} strokeWidth="2.2"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>;
    case 'chevdown':
      return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#7a7163" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>;
    default:
      return <svg {...common}><circle cx="12" cy="12" r="9" /></svg>;
  }
}
