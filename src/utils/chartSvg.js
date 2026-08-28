/**
 * B169 — CHART ENGINE (the presenter's graph skills).
 * Turns a ```chart fence into a real, visible SVG graph — no libraries, no
 * network, works in the APK's WebView.
 *
 * Fence format (model-friendly, forgiving):
 *   ```chart
 *   { "type": "bar" | "line" | "pie",
 *     "title": "Revenue by quarter",
 *     "unit": "KSh" | "%" | "" ,
 *     "data": { "Q1": 120, "Q2": 180, ... }        // bar/line/pie
 *         OR [ { "label": "Q1", "value": 120, "value2": 90 }, ... ]  // grouped
 *   }
 *   ```
 *
 *   chartSvg(spec) → { svg, error? }  (safe: never throws)
 */

const PALETTE = ['#00ff9d', '#4a9eff', '#ffb020', '#ff5d7a', '#a78bfa', '#38e1d4', '#f272c8', '#9aa5b1'];
const W = 560;

const fmtNum = (n) => {
  const v = Number(n);
  if (!isFinite(v)) return String(n);
  if (Math.abs(v) >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
  return String(Math.round(v * 100) / 100);
};

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function normalize(spec) {
  const type = String(spec.type || 'bar').toLowerCase();
  let rows = [];
  if (Array.isArray(spec.data)) {
    rows = spec.data.map((r) => ({
      label: String(r.label ?? r.name ?? ''),
      value: Number(r.value ?? 0),
      value2: r.value2 !== undefined ? Number(r.value2) : undefined,
    }));
  } else if (spec.data && typeof spec.data === 'object') {
    rows = Object.entries(spec.data).map(([label, v]) => {
      const val = (v && typeof v === 'object') ? Number(v.value ?? 0) : Number(v);
      return { label: String(label), value: val, value2: (v && typeof v === 'object' && v.value2 !== undefined) ? Number(v.value2) : undefined };
    });
  }
  return { type, rows, title: String(spec.title || ''), unit: String(spec.unit || spec.units || '') };
}

const header = (title) => `
  <text x="${W / 2}" y="26" text-anchor="middle" font-size="14" font-weight="700" fill="#ffffff" font-family="Inter,system-ui,sans-serif">${esc(title)}</text>`;

function legend(rows, hasSecond) {
  if (!hasSecond) return '';
  return `
  <rect x="380" y="12" width="10" height="10" rx="2" fill="${PALETTE[0]}"/>
  <text x="395" y="21" font-size="10" fill="#9a9a9a" font-family="Inter,sans-serif">series 1</text>
  <rect x="445" y="12" width="10" height="10" rx="2" fill="${PALETTE[1]}"/>
  <text x="460" y="21" font-size="10" fill="#9a9a9a" font-family="Inter,sans-serif">series 2</text>`;
}

function barChart({ rows, title, unit }) {
  const hasSecond = rows.some((r) => r.value2 !== undefined);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.value, r.value2 ?? 0)));
  const H = 240;
  const top = 48;
  const bottom = 200;
  const plotW = W - 70;
  const slot = plotW / Math.max(1, rows.length);
  const barW = Math.min(46, (slot * (hasSecond ? 0.34 : 0.55)));
  let g = header(title) + legend(rows, hasSecond);
  // gridlines + y labels (4 steps)
  for (let i = 0; i <= 4; i++) {
    const y = bottom - ((bottom - top) * i) / 4;
    const val = (max * i) / 4;
    g += `\n  <line x1="46" y1="${y}" x2="${W - 14}" y2="${y}" stroke="#222a36" stroke-width="1"/>`;
    g += `\n  <text x="40" y="${y + 3}" text-anchor="end" font-size="9" fill="#7a828e" font-family="JetBrains Mono,monospace">${fmtNum(val)}</text>`;
  }
  rows.forEach((r, i) => {
    const cx = 46 + slot * i + slot / 2;
    const h1 = (r.value / max) * (bottom - top);
    const x1 = hasSecond ? cx - barW - 2 : cx - barW / 2;
    g += `\n  <rect x="${x1}" y="${bottom - h1}" width="${barW}" height="${Math.max(1, h1)}" rx="3" fill="${PALETTE[0]}"/>`;
    g += `\n  <text x="${x1 + barW / 2}" y="${bottom - h1 - 5}" text-anchor="middle" font-size="9" fill="#e8e8e8" font-family="JetBrains Mono,monospace">${fmtNum(r.value)}${unit ? esc(unit) : ''}</text>`;
    if (hasSecond && r.value2 !== undefined) {
      const h2 = (r.value2 / max) * (bottom - top);
      const x2 = cx + 2;
      g += `\n  <rect x="${x2}" y="${bottom - h2}" width="${barW}" height="${Math.max(1, h2)}" rx="3" fill="${PALETTE[1]}"/>`;
      g += `\n  <text x="${x2 + barW / 2}" y="${bottom - h2 - 5}" text-anchor="middle" font-size="9" fill="#e8e8e8" font-family="JetBrains Mono,monospace">${fmtNum(r.value2)}</text>`;
    }
    g += `\n  <text x="${cx}" y="${bottom + 14}" text-anchor="middle" font-size="9.5" fill="#9a9a9a" font-family="Inter,sans-serif">${esc(String(r.label).slice(0, 10))}</text>`;
  });
  g += `\n  <text x="10" y="${H - 6}" font-size="8" fill="#5c6470" font-family="Inter,sans-serif">${esc(unit ? `values in ${unit}` : '')}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(title)}">${g}\n</svg>`;
}

function lineChart({ rows, title, unit }) {
  if (rows.length < 2) return barChart({ rows, title, unit });
  const hasSecond = rows.some((r) => r.value2 !== undefined);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.value, r.value2 ?? 0)));
  const top = 48;
  const bottom = 200;
  const x = (i) => 46 + ((W - 70) * i) / Math.max(1, rows.length - 1);
  const y = (v) => bottom - (v / max) * (bottom - top);
  let g = header(title) + legend(rows, hasSecond);
  for (let i = 0; i <= 4; i++) {
    const yy = bottom - ((bottom - top) * i) / 4;
    g += `\n  <line x1="46" y1="${yy}" x2="${W - 14}" y2="${yy}" stroke="#222a36" stroke-width="1"/>`;
    g += `\n  <text x="40" y="${yy + 3}" text-anchor="end" font-size="9" fill="#7a828e" font-family="JetBrains Mono,monospace">${fmtNum((max * i) / 4)}</text>`;
  }
  const path = (key) => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(key === 1 ? r.value : (r.value2 ?? 0)).toFixed(1)}`).join(' ');
  g += `\n  <path d="${path(1)}" fill="none" stroke="${PALETTE[0]}" stroke-width="2.2" stroke-linejoin="round"/>`;
  rows.forEach((r, i) => {
    g += `\n  <circle cx="${x(i)}" cy="${y(r.value)}" r="3" fill="${PALETTE[0]}"/>`;
    if (i === rows.length - 1) g += `\n  <text x="${Math.min(x(i), W - 60)}" y="${y(r.value) - 8}" font-size="9" fill="#e8e8e8" font-family="JetBrains Mono,monospace">${fmtNum(r.value)}${unit ? esc(unit) : ''}</text>`;
  });
  if (hasSecond) {
    g += `\n  <path d="${path(2)}" fill="none" stroke="${PALETTE[1]}" stroke-width="2.2" stroke-dasharray="5 3"/>`;
    rows.forEach((r, i) => { if (r.value2 !== undefined) g += `\n  <circle cx="${x(i)}" cy="${y(r.value2)}" r="3" fill="${PALETTE[1]}"/>`; });
  }
  const step = Math.max(1, Math.ceil(rows.length / 7));
  rows.forEach((r, i) => {
    if (i % step === 0 || i === rows.length - 1) g += `\n  <text x="${x(i)}" y="${bottom + 14}" text-anchor="middle" font-size="9.5" fill="#9a9a9a" font-family="Inter,sans-serif">${esc(String(r.label).slice(0, 10))}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 240" width="100%" role="img" aria-label="${esc(title)}">${g}\n</svg>`;
}

function pieChart({ rows, title, unit }) {
  const total = rows.reduce((a, r) => a + Math.max(0, r.value), 0) || 1;
  const cx = 150;
  const cy = 130;
  const R = 82;
  let angle = -Math.PI / 2;
  let g = header(title);
  rows.forEach((r, i) => {
    const frac = Math.max(0, r.value) / total;
    const a2 = angle + frac * Math.PI * 2;
    const large = frac > 0.5 ? 1 : 0;
    const x1 = cx + R * Math.cos(angle);
    const y1 = cy + R * Math.sin(angle);
    const x2 = cx + R * Math.cos(a2);
    const y2 = cy + R * Math.sin(a2);
    const col = PALETTE[i % PALETTE.length];
    if (frac > 0.999) g += `\n  <circle cx="${cx}" cy="${cy}" r="${R}" fill="${col}"/>`;
    else g += `\n  <path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${col}" stroke="#0f1115" stroke-width="1.5"/>`;
    angle = a2;
  });
  rows.forEach((r, i) => {
    const ly = 62 + i * 17;
    const pct = Math.round((Math.max(0, r.value) / total) * 100);
    g += `\n  <rect x="268" y="${ly - 8}" width="10" height="10" rx="2" fill="${PALETTE[i % PALETTE.length]}"/>`;
    g += `\n  <text x="284" y="${ly + 1}" font-size="10.5" fill="#e8e8e8" font-family="Inter,sans-serif">${esc(String(r.label).slice(0, 16))}</text>`;
    g += `\n  <text x="546" y="${ly + 1}" text-anchor="end" font-size="10" fill="#9a9a9a" font-family="JetBrains Mono,monospace">${pct}% · ${fmtNum(r.value)}${unit ? esc(unit) : ''}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 240" width="100%" role="img" aria-label="${esc(title)}">${g}\n</svg>`;
}

/** The one entry point — never throws. */
export function chartSvg(raw) {
  try {
    let spec = raw;
    if (typeof raw === 'string') spec = JSON.parse(raw);
    if (!spec || typeof spec !== 'object') return { error: 'chart: spec must be an object' };
    const n = normalize(spec);
    if (!n.rows.length) return { error: 'chart: no data rows' };
    if (n.rows.length > 24) n.rows = n.rows.slice(0, 24);
    if (n.type === 'line') return { svg: lineChart(n) };
    if (n.type === 'pie' || n.type === 'donut') return { svg: pieChart(n) };
    return { svg: barChart(n) };
  } catch (e) {
    return { error: `chart: ${(e && e.message) || 'bad spec'}` };
  }
}
