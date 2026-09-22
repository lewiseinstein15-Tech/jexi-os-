import { useMemo } from 'react';

const EXPECTED = [
  ['--bg', '#08090a', 'Linear — Marketing Black canvas'],
  ['--surface', '#0f1011', 'Linear — Panel Dark'],
  ['--surface-elevated', '#191a1b', 'Linear — Surface Level 3'],
  ['--border', '#333333', 'Vercel — border-100'],
  ['--border-strong', '#444444', 'Vercel — border-200'],
  ['--text-primary', '#f7f8f8', 'Linear — Primary White'],
  ['--text-secondary', '#d0d6e0', 'Linear — Silver Gray'],
  ['--text-muted', '#8a8f98', 'Linear — Tertiary Gray'],
  ['--text-quiet', '#62666d', 'Linear — Quaternary'],
  ['--accent', '#5e6ad2', 'Linear — Brand Indigo'],
  ['--accent-bright', '#7170ff', 'Linear — Accent Violet'],
  ['--accent-hover', '#828fff', 'Linear — Accent Hover'],
  ['--error', '#ff0000', 'Vercel — color-error'],
  ['--success', '#00dc82', 'Vercel — color-success'],
  ['--warn', '#ffaa00', 'Vercel — color-warning'],
  ['--info', '#0070f3', 'Vercel — color-info'],
];

function norm(hex) { return String(hex || '').trim().toLowerCase(); }

/** Dev-only (#/tokens): renders the live computed :root vars vs the approved hexes. */
export default function TokenInspector() {
  const rows = useMemo(() => {
    const cs = getComputedStyle(document.documentElement);
    return EXPECTED.map(([name, expect, src]) => {
      const got = norm(cs.getPropertyValue(name));
      return { name, expect, src, got, ok: got === norm(expect) };
    });
  }, []);
  const allOk = rows.every((r) => r.ok);

  return (
    <section className="jx-inspector">
      <div className="jx-insp-head">
        <h2>Token inspector — live computed :root values</h2>
        <span className={'jx-insp-verdict ' + (allOk ? 'ok' : 'bad')}>
          {allOk ? 'ALL 16 MATCH SPEC' : 'MISMATCH PRESENT'}
        </span>
      </div>
      <table className="jx-insp-table">
        <thead>
          <tr><th>token</th><th>computed</th><th>spec</th><th>source</th><th>check</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} data-ok={r.ok}>
              <td className="mono">{r.name}</td>
              <td><span className="jx-chip" style={{ background: r.got }}></span><span className="mono">{r.got || '(missing)'}</span></td>
              <td className="mono">{r.expect}</td>
              <td>{r.src}</td>
              <td className={'jx-check ' + (r.ok ? 'ok' : 'bad')}>{r.ok ? 'PASS' : 'FAIL'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
