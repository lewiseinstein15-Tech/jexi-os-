#!/usr/bin/env node
/**
 * taste — slop-check: REAL static scanner enforcing taste's mechanically
 * checkable bans. Dependency-free. Scans .html/.css/.js/.jsx/.ts/.tsx files.
 * Exit 0 = no CRITICAL findings; exit 1 = CRITICAL findings exist (gate).
 *
 * Usage: node slop-check.mjs <files-or-dirs...>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXTS = new Set(['.html', '.css', '.js', '.jsx', '.ts', '.tsx']);

// [id, severity, test(regex over file text), message]
const RULES = [
  ['purple-gradient', 'CRITICAL', /linear-gradient\([^)]*#(7c3aed|8b5cf6|a855f7|9333ea|6d28d9)|from-purple|to-purple|bg-gradient.*purple/i, 'AI-purple gradient — the #1 LLM tell. Pick a deliberate accent from the brief instead.'],
  ['inter-default', 'WARN', /['"]Inter['"]|font-family:\s*Inter\b/, 'Inter as the font identity (Inter + slate-900 is the default). Self-host via next/font and only use if the design read justifies it.'],
  ['emoji-as-icon', 'WARN', />[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\uFE0F?</u, 'Emoji used in markup/text where an icon-library glyph belongs (unless brief is explicitly playful).'],
  ['lucide-discouraged', 'WARN', /lucide-react/, 'lucide-react discouraged by taste — prefer @phosphor-icons/react (acceptable if project already depends on it or user asked).'],
  ['fake-screenshot', 'CRITICAL', /fake[-_]?(screenshot|terminal|dashboard|window)|className=["'][^"']*(fake-|mock-window|fake-browser)/i, 'Div-based fake screenshot/terminal/dashboard — banned. Use a real screenshot, real mini-component, image-gen, or a labeled placeholder + tell the user.'],
  ['gradient-blob-hero', 'WARN', /hero["'][^>]*>\s*<div[^>]*(gradient|blob|glow)|blob-|glow-orb/i, 'Hero built from gradient blobs — a hero needs a real visual (photography/product/real preview).'],
  ['hardcoded-hex', 'WARN', /(style=["'][^"']*|:\s*)#[0-9a-fA-F]{6}\b/, 'Raw hex inline — use semantic design tokens instead of raw hex in components.'],
  ['no-reduced-motion', 'CRITICAL', /@keyframes|animation:|transition:/, 'Animation/transition present but NO prefers-reduced-motion guard found anywhere in scanned files.'],
  ['no-focus-visible', 'CRITICAL', /<button|<a\s|onClick=/, 'Interactive elements present but no :focus-visible styling found — keyboard focus states are mandatory.'],
  ['disabled-zoom', 'CRITICAL', /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i, 'Viewport zoom disabled — accessibility violation, never ship.'],
  ['font-link-tag', 'WARN', /<link[^>]+fonts\.googleapis\.com/, 'Google Fonts via <link> in production — self-host (next/font or @font-face with font-display: swap).'],
  ['logo-wordmark-text', 'WARN', /(trusted|used)\s+by[\s\S]{0,200}<span[^>]*>[A-Z][A-Za-z]+(\s[A-Za-z]+)?<\/span>/, 'Logo wall as plain-text wordmarks — use real SVG marks (Simple Icons/devicon); logos only, no category labels.'],
];

function* walk(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
      yield* walk(path.join(p, ent.name));
    }
  } else if (EXTS.has(path.extname(p))) yield p;
}

export function scanFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const findings = [];
  for (const [id, severity, re, message] of RULES) {
    const m = text.match(re);
    if (m) findings.push({ id, severity, file, line: text.slice(0, m.index ?? 0).split('\n').length, snippet: (m[0] ?? '').slice(0, 60), message });
  }
  // contextual pairs: animation present anywhere? then the no-reduced-motion rule stands only if truly absent project-wide
  return findings;
}

export function scan(paths) {
  const files = [...new Set([...paths].flatMap((p) => [...walk(p)]))];
  const all = files.flatMap(scanFile);
  // project-wide exceptions: if ANY scanned file has a reduced-motion guard / focus-visible, drop the corresponding CRITICALs
  const joined = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const out = all.filter((f) => !(
    (f.id === 'no-reduced-motion' && joined.includes('prefers-reduced-motion'))
    || (f.id === 'no-focus-visible' && joined.includes('focus-visible'))
  ));
  return { files: files.length, findings: out };
}

// --- CLI ---
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const targets = process.argv.slice(2);
  if (!targets.length) { console.error('usage: slop-check.mjs <files-or-dirs...>'); process.exit(2); }
  const { files, findings } = scan(targets);
  const crit = findings.filter((f) => f.severity === 'CRITICAL');
  const warns = findings.filter((f) => f.severity === 'WARN');
  for (const f of findings) {
    console.log(`${f.severity.padEnd(8)} [${f.id}] ${f.file}:${f.line}\n         ${f.message}\n         at: ${f.snippet}`);
  }
  console.log(`\nSLOP-CHECK: ${files} file(s) scanned — ${crit.length} CRITICAL, ${warns.length} WARN${crit.length ? ' → NOT SHIPPABLE (fix CRITICAL first)' : ' → gate passed'}`);
  process.exit(crit.length ? 1 : 0);
}
