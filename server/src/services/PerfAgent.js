import fs from 'fs';
import path from 'path';
import { generateContent, resolveKeys } from './LLMClient.js';
import { JEXI_SYSTEM_PROMPT } from './JexiPrompt.js';
import { WORKSPACE_DIR } from '../config.js';

/**
 * PERFORMANCE ENGINEER — JEXI's speed specialist (skill: 20-perf-agent.md).
 * Lineage: gstack /benchmark, agency-agents @perf.
 * Measure → Find → Fix → Prove. Every claim carries a number from real files.
 */

const MAX_FILES = 8;

function readWorkspace() {
  if (!fs.existsSync(WORKSPACE_DIR)) return [];
  return fs.readdirSync(WORKSPACE_DIR)
    .filter((f) => /\.(html|css|js|mjs|ts|tsx|jsx|py|json)$/.test(f) && !f.startsWith('node_modules'))
    .slice(0, MAX_FILES)
    .map((name) => ({ name, code: fs.readFileSync(path.join(WORKSPACE_DIR, name), 'utf-8') }));
}

/** Pure, testable static perf scan — real numbers from the real files. */
export function scanPerf(files) {
  const findings = [];
  let totalSize = 0;

  for (const { name, code } of files) {
    const kb = (Buffer.byteLength(code, 'utf-8') / 1024).toFixed(1);
    totalSize += Number(kb);

    if (name.endsWith('.html')) {
      const scripts = (code.match(/<script[^>]*src=["'][^"']+["']/g) || []);
      const blocking = scripts.filter((s) => !/\b(?:defer|async)\b/.test(s));
      if (blocking.length) findings.push({ file: name, severity: 'high', issue: `${blocking.length} render-blocking script(s) — add defer/async`, fix: blocking.map((b) => b.replace('<script', '<script defer')).join(' ') });
      const imgs = (code.match(/<img[^>]*>/g) || []);
      const noDims = imgs.filter((i) => !/\b(?:width|height)\s*=/.test(i));
      if (noDims.length) findings.push({ file: name, severity: 'medium', issue: `${noDims.length} image(s) without width/height (causes layout shift)`, fix: 'add width/height (or CSS aspect-ratio) to each image' });
      const lazy = imgs.filter((i) => /loading\s*=\s*["'](?!lazy)/.test(i));
      if (lazy.length) findings.push({ file: name, severity: 'low', issue: `${lazy.length} image(s) without loading="lazy"`, fix: 'add loading="lazy" to below-the-fold images' });
    }

    if (name.endsWith('.js') || name.endsWith('.mjs') || name.endsWith('.py')) {
      const loops = (code.match(/\b(for|while)\b\s*\(/g) || []).length;
      const fetchInLoop = (code.match(/fetch\(/g) || []).length;
      if (fetchInLoop > 0 && loops > 0) findings.push({ file: name, severity: 'high', issue: `${fetchInLoop} fetch call(s) in a file with ${loops} loop(s) — likely N+1 network pattern`, fix: 'hoist fetches out of loops; batch requests' });
      const innerHTML = (code.match(/innerHTML\s*\+?=/g) || []).length;
      if (innerHTML > 1) findings.push({ file: name, severity: 'medium', issue: `${innerHTML} innerHTML writes — repeated DOM churn`, fix: 'build DOM once (documentFragment / createElement) then append' });
      const consoleLogs = (code.match(/console\.(log|debug)\b/g) || []).length;
      if (consoleLogs > 3) findings.push({ file: name, severity: 'low', issue: `${consoleLogs} console.log/debug statements in production code`, fix: 'remove or gate debug logging' });
    }

    if (name.endsWith('.css')) {
      const heavy = (code.match(/(box-shadow|filter:\s*blur|backdrop-filter|animation:\s*\S+\s*(infinite|\d+s))/g) || []).length;
      if (heavy > 0) findings.push({ file: name, severity: 'low', issue: `${heavy} heavy visual effect(s) (shadows/blur/animations)`, fix: 'limit blur/backdrop-filter to small areas; cap animation duration' });
    }

    if (name.endsWith('.json')) {
      const size = Number(kb);
      if (size > 500) findings.push({ file: name, severity: 'high', issue: `JSON payload is ${size} KB`, fix: 'trim unused fields or split into endpoints' });
    }
  }

  return {
    files: files.map((f) => f.name),
    totalSizeKb: totalSize.toFixed(1),
    findings,
    summary: `Scanned ${files.length} file(s), ${totalSize.toFixed(1)} KB total. ${findings.length} performance finding(s).`,
  };
}

export async function runPerfAgent({ query, sendEvent }) {
  const files = readWorkspace();
  if (files.length === 0) {
    return { success: true, summary: '### ⚡ PERFORMANCE ENGINEER\n\nThe workspace is empty — build an app first, then ask me to *"make it faster"* and I will measure and fix it.' };
  }

  sendEvent?.('log', { agent: 'Performance Engineer', message: `⚡ Measuring ${files.length} file(s) — size, blocking work, hot loops...` });
  const report = scanPerf(files);

  const parts = [`### ⚡ PERFORMANCE ENGINEER\n\n**Measured baseline:** ${report.summary}`];

  if (report.findings.length === 0) {
    parts.push('\n✅ No obvious static bottlenecks in the files I scanned.');
  } else {
    parts.push('\n## Findings (priority order)');
    const sorted = [...report.findings].sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]));
    for (const f of sorted) {
      parts.push(`- **[${f.severity.toUpperCase()}] \`${f.file}\`** — ${f.issue}\n  → *Fix:* ${f.fix}`);
    }
  }

  // AI-assisted fix suggestions when a key exists
  const keys = resolveKeys();
  if ((keys.groqKey || keys.geminiKey) && report.findings.length > 0) {
    try {
      const ai = await generateContent(
        `A static performance scan found these issues in real files:\n${JSON.stringify(report.findings, null, 1)}\n\nFile snippets:\n${files.map((f) => `--- ${f.name} ---\n${f.code.slice(0, 2500)}`).join('\n\n')}\n\nGive the top 2-3 fixes as BEFORE → AFTER code (## FIXES). Then ## RUNTIME CHECK with the exact local command to measure real speed (e.g. lighthouse, time node). Be concrete — no generic advice.`,
        JEXI_SYSTEM_PROMPT,
        null,
        { temperature: 0.3 }
      );
      parts.push('\n' + ai.slice(0, 6000));
    } catch (e) {}
  } else if (report.findings.length > 0) {
    parts.push('\n## What still needs a runtime check\n- Run **Lighthouse** (Chrome DevTools → Lighthouse) on the preview URL for real Web Vitals.\n- Or \`time node index.js\` for script runtime. Add an AI key and I will generate the exact before/after code myself.');
  }

  parts.push('\n> Say *"apply the perf fixes"* and I will write the optimized files into the workspace (behavior unchanged — no dropped validation or error handling).');
  return { success: true, summary: parts.join('\n') };
}
