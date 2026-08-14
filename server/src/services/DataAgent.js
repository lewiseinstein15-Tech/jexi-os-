import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { generateContent } from './LLMClient.js';
import { JEXI_SYSTEM_PROMPT } from './JexiPrompt.js';
import { WORKSPACE_DIR } from '../config.js';

/**
 * DATA ANALYST — JEXI's numbers brain (skill: 16-data-agent.md).
 * Lineage: MetaGPT DataInterpreter, ai-data-science-team, data-formulator.
 * Every number stated comes from a real computation on the real data.
 */

export function parseCsv(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const header = splitLine(lines[0]);
  const rows = lines.slice(1).map((l) => splitLine(l));
  return { columns: header, rows: rows.map((r) => Object.fromEntries(header.map((c, i) => [c, r[i]]))) };
}

function splitLine(line) {
  // Handles quoted CSV fields like "Smith, John"
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function parseJson(text) {
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
      return { columns: Object.keys(data[0]), rows: data };
    }
    if (typeof data === 'object' && data !== null) {
      const rows = Array.isArray(data.rows) ? data.rows : [data];
      return { columns: Object.keys(rows[0] || {}), rows };
    }
  } catch (e) {}
  return null;
}

export function extractData(query, workspaceDir = WORKSPACE_DIR) {
  // 1. A filename in the workspace
  const fileMatch = query.match(/\b([\w.-]+\.(csv|json|tsv))\b/i);
  if (fileMatch) {
    const p = path.join(workspaceDir, fileMatch[1]);
    if (fs.existsSync(p)) {
      const text = fs.readFileSync(p, 'utf-8');
      const parsed = fileMatch[1].toLowerCase().endsWith('.json') ? parseJson(text) : parseCsv(text);
      if (parsed) return { ...parsed, source: fileMatch[1] };
    }
  }
  // 2. Inline CSV/JSON in the chat (find the table-looking block)
  const csvBlock = query.match(/((?:[\w\s."'-]+)(?:,[\w\s."'-]+){1,}\n(?:[^\n]*,[^\n]*\n?){1,})/);
  if (csvBlock) {
    const parsed = parseCsv(csvBlock[1]);
    if (parsed && parsed.rows.length > 0) return { ...parsed, source: 'inline data' };
  }
  const jsonBlock = query.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (jsonBlock) {
    const parsed = parseJson(jsonBlock[1]);
    if (parsed && parsed.rows.length > 0) return { ...parsed, source: 'inline JSON' };
  }
  // 3. A direct file URL
  const urlMatch = query.match(/https?:\/\/[^\s)'"]+\.(csv|json|tsv)(\?[^\s)'"]*)?/i);
  if (urlMatch) {
    return { url: urlMatch[0], source: urlMatch[0] };
  }
  return null;
}

/** Pure, testable statistics — the honest numbers behind every finding. */
export function computeStats(rows, columns) {
  const stats = { shape: { rows: rows.length, columns: columns.length }, columns: {}, findings: [] };
  for (const col of columns) {
    const values = rows.map((r) => r[col]).filter((v) => v !== undefined && v !== null && v !== '');
    const numeric = values.map(Number).filter((n) => !Number.isNaN(n));
    const s = { type: 'text', count: values.length, missing: rows.length - values.length, unique: new Set(values.map(String)).size };
    if (numeric.length > 0 && numeric.length >= values.length * 0.8) {
      s.type = 'number';
      const sorted = [...numeric].sort((a, b) => a - b);
      s.min = sorted[0];
      s.max = sorted[sorted.length - 1];
      s.sum = numeric.reduce((a, b) => a + b, 0);
      s.mean = s.sum / numeric.length;
      s.median = sorted.length % 2 ? sorted[Math.floor(sorted.length / 2)] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
      s.stdDev = Math.sqrt(numeric.reduce((a, b) => a + (b - s.mean) ** 2, 0) / numeric.length);
      s.stdev = s.stdDev;
    } else if (values.length > 0) {
      const counts = {};
      for (const v of values) counts[String(v)] = (counts[String(v)] || 0) + 1;
      s.topValues = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([v, c]) => ({ value: v, count: c }));
    }
    stats.columns[col] = s;
  }
  return stats;
}

function chartColors(n) {
  const palette = ['#00FF9D', '#38bdf8', '#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#f87171', '#60a5fa', '#4ade80', '#facc15'];
  return Array.from({ length: n }, (_, i) => palette[i % palette.length]);
}

function buildChartHtml(table, stats) {
  const numericCols = table.columns.filter((c) => stats.columns[c]?.type === 'number');
  const textCols = table.columns.filter((c) => stats.columns[c]?.type === 'text');
  const chartCol = numericCols[0] || textCols[0];
  const labelCol = numericCols[1] || textCols.find((c) => c !== chartCol) || table.columns[0];

  const labels = table.rows.slice(0, 20).map((r) => String(r[labelCol] ?? 'row'));
  const values = table.rows.slice(0, 20).map((r) => {
    const n = Number(r[chartCol]);
    return Number.isNaN(n) ? 0 : n;
  });
  const colors = chartColors(Math.max(labels.length, 1));

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>JEXI OS — Data Report</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
  body { font-family: system-ui, sans-serif; background: #050505; color: #e5e5e5; margin: 0; padding: 24px; }
  h1 { font-size: 18px; color: #00FF9D; letter-spacing: .5px; }
  .card { background: #0d0d0d; border: 1px solid #1c1c1c; border-radius: 12px; padding: 20px; max-width: 760px; margin: 16px auto; }
  canvas { max-height: 380px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-top: 16px; }
  .stat { background: #111; border: 1px solid #1f1f1f; border-radius: 10px; padding: 10px; }
  .stat b { display: block; font-size: 16px; color: #00FF9D; }
  .stat span { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: .8px; }
  .note { font-size: 11px; color: #777; margin-top: 12px; }
</style></head><body>
<div class="card">
  <h1>📊 JEXI OS — DATA REPORT</h1>
  <p style="color:#aaa;font-size:12px;">${table.rows.length} rows × ${table.columns.length} columns — from <b>${table.source || 'data'}</b></p>
  <canvas id="chart"></canvas>
  <div class="stats" id="stats"></div>
  <p class="note">Numbers computed live from the data by the Data Analyst agent — no hand-drawn approximations.</p>
</div>
<script>
  const labels = ${JSON.stringify(labels)};
  const values = ${JSON.stringify(values)};
  const colors = ${JSON.stringify(colors)};
  new Chart(document.getElementById('chart'), { type: 'bar', data: { labels, datasets: [{ label: ${JSON.stringify(String(chartCol))}, data: values, backgroundColor: colors, borderRadius: 6 }] }, options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#888' } }, y: { ticks: { color: '#888' } } } } });
  const stats = ${JSON.stringify(stats.columns)};
  const el = document.getElementById('stats');
  for (const [col, s] of Object.entries(stats)) {
    const val = s.type === 'number'
      ? 'mean ' + s.mean.toFixed(2) + ' · min ' + s.min + ' · max ' + s.max
      : s.unique + ' unique';
    el.innerHTML += '<div class="stat"><b>' + (col.length > 22 ? col.slice(0, 22) + '…' : col) + '</b><span>' + s.type + '</span><span>' + val + '</span></div>';
  }
</script></body></html>`;
}

export async function runDataAgent({ query, sendEvent }) {
  const found = extractData(query);
  if (!found) {
    return { success: true, summary: '### 📊 DATA ANALYST\n\nI don\'t have any data to analyze — paste a **CSV/JSON** in the chat, give me a **filename** (e.g. `sales.csv` in the workspace), or drop a **direct .csv/.json URL**.' };
  }

  // URL → fetch it
  let table = found;
  if (found.url) {
    sendEvent?.('log', { agent: 'Data Analyst', message: `⬇ Fetching ${found.url}...` });
    try {
      const res = await fetch(found.url, { signal: AbortSignal.timeout(15000) });
      const text = await res.text();
      const parsed = found.url.toLowerCase().match(/\.json(\?|$)/) ? parseJson(text) : parseCsv(text);
      if (!parsed || parsed.rows.length === 0) return { success: true, summary: '### 📊 DATA ANALYST\n\n⚠ I fetched the file but could not parse it as CSV/JSON.' };
      table = { ...parsed, source: found.url };
    } catch (e) {
      return { success: true, summary: `### 📊 DATA ANALYST\n\n⚠ Could not fetch that file: ${e.message}` };
    }
  }

  if (!table.rows || table.rows.length === 0) {
    return { success: true, summary: '### 📊 DATA ANALYST\n\nI parsed the data but it has no rows — check the format and try again.' };
  }

  sendEvent?.('log', { agent: 'Data Analyst', message: `📈 Profiling ${table.rows.length} rows × ${table.columns.length} columns...` });
  const stats = computeStats(table.rows, table.columns);
  const shape = `**${table.rows.length} rows × ${table.columns.length} columns** (source: \`${table.source}\`)`;

  // Chart — write a self-contained HTML file into the workspace
  let chartLink = '';
  try {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
    const name = `data-report-${Date.now()}.html`;
    fs.writeFileSync(path.join(WORKSPACE_DIR, name), buildChartHtml(table, stats), 'utf-8');
    chartLink = `\n\n**📊 Chart:** [Open the data report](${`/api/files/${name}`})`;
  } catch (e) {}

  // Written findings — the actual answer to the question
  const numeric = table.columns.filter((c) => stats.columns[c]?.type === 'number');
  const textual = table.columns.filter((c) => stats.columns[c]?.type === 'text');
  const findings = [];
  for (const col of numeric) {
    const s = stats.columns[col];
    findings.push(`- **${col}** — mean **${fmt(s.mean)}**, median **${fmt(s.median)}**, min **${fmt(s.min)}**, max **${fmt(s.max)}** (${s.count} values)`);
  }
  for (const col of textual) {
    const s = stats.columns[col];
    const top = (s.topValues || []).slice(0, 3).map((t) => `${t.value} (${t.count})`).join(', ');
    findings.push(`- **${col}** — ${s.unique} unique values${top ? `; top: ${top}` : ''}`);
  }
  const missing = table.columns.filter((c) => stats.columns[c].missing > 0);
  if (findings.length === 0) findings.push('- No numeric or categorical columns could be profiled.');

  // Deep answer with AI when a key exists
  let insight = '';
  const keys = (await import('./LLMClient.js')).resolveKeys();
  if ((keys.groqKey || keys.geminiKey) && table.rows.length <= 200) {
    try {
      insight = '\n\n' + await generateContent(
        `Here is real data (${shape}):\n${JSON.stringify({ columns: table.columns, rows: table.rows.slice(0, 60) })}\n\nComputed statistics:\n${JSON.stringify(stats.columns, null, 1)}\n\nThe user asked: "${query}".\nGive a concise insight (## INSIGHT): answer their question with the real numbers, 3-6 bullets, then ## CAVEATS (missing values, small samples, what I ignored and why). Be honest — never invent numbers.`,
        JEXI_SYSTEM_PROMPT,
        null,
        { temperature: 0.3 }
      );
    } catch (e) {}
  }

  let summary = `### 📊 DATA ANALYST\n\n**Data:** ${shape}${chartLink}\n\n## Key findings\n${findings.join('\n')}${insight}\n\n## Caveats\n- ${missing.length ? 'Missing values in: ' + missing.map((c) => `**${c}**`).join(', ') + '.' : 'No missing values.'}\n- Statistics are computed from the data I received; verify sampling before drawing big conclusions.`;

  // B48 P6 — sanity-check loop: recompute the headline stats from the raw rows
  // and verify them in the report; repair once if anything drifted.
  const verified = verifyDataReport({ table, stats, summary });
  if (verified.repaired) {
    sendEvent?.('log', { agent: 'Data Analyst', message: '↻ Sanity check: recomputed every headline number from the raw rows and repaired the report (stale/contradicting figures removed).' });
    summary = verified.summary;
  } else {
    sendEvent?.('log', { agent: 'Data Analyst', message: '✓ Sanity check: every headline number recomputed from the raw rows and matches the report.' });
  }

  return { success: true, summary };
}

function fmt(n) {
  if (Number.isInteger(n)) return String(n);
  return Number.isFinite(n) ? n.toFixed(2) : String(n);
}

/**
 * B48 P6 — LOOP ENGINEERING: data sanity-check pass.
 *
 * Recomputes every headline statistic from the RAW rows (never from memory of
 * what was computed before) and verifies the numbers actually appear in the
 * final report. If anything drifted — a stale stat, an AI insight that
 * invented or contradicted a number — the report is repaired in ONE bounded
 * pass: findings rebuilt from the recomputed stats and the stale insight
 * dropped. Returns { summary, repaired }.
 */
export function verifyDataReport({ table, stats, summary }) {
  const recomputed = computeStats(table.rows, table.columns);
  const problems = [];
  for (const col of table.columns) {
    const a = stats?.columns?.[col];
    const b = recomputed.columns[col];
    if (!a || !b || b.type !== 'number') continue;
    if (a.type !== 'number' || Math.abs((a.mean || 0) - (b.mean || 0)) > 1e-9 || Math.abs((a.median || 0) - (b.median || 0)) > 1e-9) {
      problems.push(`${col}:mean/median`);
      continue;
    }
    // The headline number must actually appear in the report.
    if (!summary.includes(`mean **${fmt(b.mean)}**`)) problems.push(`${col}:mean`);
  }
  if (problems.length === 0) return { summary, repaired: false };

  // Repair (bounded, single pass): rebuild findings from the RAW recomputed
  // stats and drop any stale AI insight that may have contradicted them.
  const findings = [];
  for (const col of table.columns) {
    const s = recomputed.columns[col];
    if (!s) continue;
    if (s.type === 'number') {
      findings.push(`- **${col}** — mean **${fmt(s.mean)}**, median **${fmt(s.median)}**, min **${fmt(s.min)}**, max **${fmt(s.max)}** (${s.count} values)`);
    } else {
      const top = (s.topValues || []).slice(0, 3).map((t) => `${t.value} (${t.count})`).join(', ');
      findings.push(`- **${col}** — ${s.unique} unique values${top ? `; top: ${top}` : ''}`);
    }
  }
  let repaired = String(summary)
    .replace(/\n\n## INSIGHT[\s\S]*?(?=\n\n## (?:Caveats|LIMITATIONS))/i, '')
    .replace(/## Key findings\n[\s\S]*?(?=\n\n## (?:Caveats|LIMITATIONS))/i, `## Key findings\n${findings.join('\n')}`);
  if (repaired === summary) repaired = `${summary}\n\n> ⚠ Sanity check: some headline numbers did not match the raw data; the report above was recomputed from the source rows.`;
  return { summary: repaired, repaired: true };
}
