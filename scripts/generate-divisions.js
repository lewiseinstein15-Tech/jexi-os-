#!/usr/bin/env node
/**
 * JEXI OS — PHASE 7 J — DIVISION REGISTRY GENERATOR.
 *
 *   node scripts/generate-divisions.js          # regenerate workforce/divisions.json
 *   node scripts/generate-divisions.js --check  # exit 0 if disk matches, exit 1 on drift
 *
 * Source of truth: the agents/ tree on disk.
 *   - Every directory under agents/ is a division.
 *   - agentCount per division counts *.agent.md files (the canonical template
 *     file agents/meta/_template.md is deliberately NOT *.agent.md, so it never
 *     inflates a count — it is reported under totals.templateFiles instead).
 *   - A division that holds the canonical template file (_template.md or
 *     _template.agent.md) is marked "template": true (today: meta/).
 *   - Deterministic: running twice produces byte-identical output (sha256
 *     stable). generatedAt is derived from git — the committer date of the
 *     last commit that touched agents/ — never from wall-clock time.
 *   - --check compares the registry against the tree EXCLUDING generatedAt:
 *     a commit that touches both agents/ and this registry cannot embed its
 *     own committer date (the commit does not exist while the registry is
 *     being regenerated), so a byte match on the timestamp is structurally
 *     impossible exactly when the check matters most. All tree-describing
 *     content — division set, counts, metadata, totals — is compared.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const AGENTS_DIR = path.join(REPO_ROOT, 'agents/catalog');
const OUT_FILE = path.join(REPO_ROOT, 'agents/workforce', 'divisions.json');

const VERSION = '1.0.0';

/**
 * Static presentation metadata per division. Counts are NEVER kept here —
 * they are computed from disk. Unknown divisions get deterministic defaults.
 * Icon names are lucide icons (console-compatible).
 */
const DIVISION_META = {
  automation:   { label: 'Automation',   icon: 'Workflow',       color: '#F59E0B', description: 'Triggers, schedules, pipelines, hands-free runs' },
  business:     { label: 'Business',     icon: 'Briefcase',      color: '#0EA5E9', description: 'Strategy, finance, growth, market analysis' },
  content:      { label: 'Content',      icon: 'PenLine',        color: '#EC4899', description: 'Writing, editing, publishing, storytelling' },
  data:         { label: 'Data',         icon: 'Database',       color: '#8B5CF6', description: 'Pipelines, analysis, quality, datasets' },
  design:       { label: 'Design',       icon: 'Palette',        color: '#F43F5E', description: 'UI, UX, brand, visual systems' },
  engineering:  { label: 'Engineering',  icon: 'Code',           color: '#3B82F6', description: 'Coding, architecture, testing, review' },
  integration:  { label: 'Integration',  icon: 'Plug',           color: '#14B8A6', description: 'APIs, webhooks, third-party wiring' },
  learning:     { label: 'Learning',     icon: 'GraduationCap',  color: '#84CC16', description: 'Curricula, tutorials, skill building' },
  legal:        { label: 'Legal',        icon: 'Scale',          color: '#64748B', description: 'Contracts, compliance, policy review' },
  localization: { label: 'Localization', icon: 'Languages',      color: '#06B6D4', description: 'Translation, i18n, cultural adaptation' },
  meta:         { label: 'Meta',         icon: 'Bot',            color: '#94A3B8', description: 'Holds the canonical agent template' },
  ops:          { label: 'Ops',          icon: 'ServerCog',      color: '#6366F1', description: 'Deployment, monitoring, incident response' },
  product:      { label: 'Product',      icon: 'Compass',        color: '#10B981', description: 'Discovery, PRDs, roadmaps, prioritization' },
  research:     { label: 'Research',     icon: 'Microscope',     color: '#A855F7', description: 'Deep investigation, sources, synthesis' },
  security:     { label: 'Security',     icon: 'ShieldCheck',    color: '#EF4444', description: 'Threat modeling, audits, prompt defense' },
  testing:      { label: 'Testing',      icon: 'Bug',            color: '#EAB308', description: 'Test design, automation, coverage, QA' },
  visualization:{ label: 'Visualization',icon: 'BarChart3',      color: '#F97316', description: 'Charts, diagrams, dashboards, visual explainers' },
  voice:        { label: 'Voice',        icon: 'Mic',            color: '#D946EF', description: 'Speech, narration, audio experiences' },
};

/** Fallback palette for divisions not in DIVISION_META (deterministic pick). */
const FALLBACK_PALETTE = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#EC4899', '#84CC16'];

function metaFor(id) {
  if (DIVISION_META[id]) return { ...DIVISION_META[id] };
  // Deterministic defaults for an unplanned division.
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const label = id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
  return {
    label: label || id,
    icon: 'Layers',
    color: FALLBACK_PALETTE[h % FALLBACK_PALETTE.length],
    description: 'Auto-detected division',
  };
}

function isTemplateFile(name) {
  return name === '_template.md' || name === '_template.agent.md';
}

/** Deterministic generatedAt: last commit that touched agents/ (committer date). */
function generatedAt() {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', 'agents/'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    if (out && /^\d{4}-\d{2}-\d{2}T/.test(out)) return out;
  } catch {
    /* fall through */
  }
  return '1970-01-01T00:00:00.000Z';
}

/** Scan agents/: one entry per top-level directory. Deterministic order (sorted by id). */
function scanDivisions() {
  let entries;
  try {
    entries = fs.readdirSync(AGENTS_DIR, { withFileTypes: true });
  } catch (e) {
    console.error(`FATAL: cannot read ${path.relative(REPO_ROOT, AGENTS_DIR)}: ${e.message}`);
    process.exit(1);
  }
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();

  const divisions = dirs.map((id) => {
    const dirAbs = path.join(AGENTS_DIR, id);
    let agentCount = 0;
    let templateCount = 0;
    const stack = [dirAbs];
    while (stack.length) {
      const cur = stack.pop();
      for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
        const full = path.join(cur, e.name);
        if (e.isDirectory()) stack.push(full);
        else if (e.name.endsWith('.agent.md')) {
          if (isTemplateFile(e.name)) templateCount += 1;
          else agentCount += 1;
        } else if (isTemplateFile(e.name)) templateCount += 1;
      }
    }
    return { id, agentCount, templateCount, ...metaFor(id) };
  });

  const totalAgents = divisions.reduce((n, d) => n + d.agentCount, 0);
  const totalTemplates = divisions.reduce((n, d) => n + d.templateCount, 0);

  const payload = {
    version: VERSION,
    generatedAt: generatedAt(),
    divisions: divisions.map(({ id, agentCount, templateCount, label, icon, color, description }) => {
      const div = { id, label, icon, color, description, agentCount };
      if (templateCount > 0) div.template = true;
      return div;
    }),
    totals: {
      divisions: divisions.length,
      agents: totalAgents,
      templateFiles: totalTemplates,
    },
  };

  return { payload, stats: { divisions: divisions.length, agents: totalAgents, templateFiles: totalTemplates } };
}

function render(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/* Minimal LCS line diff — specific drift reporting for --check. */
function lineDiff(actualLines, expectedLines) {
  const n = actualLines.length;
  const m = expectedLines.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = actualLines[i] === expectedLines[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (actualLines[i] === expectedLines[j]) { i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push(`- ${actualLines[i++]}`); }
    else { out.push(`+ ${expectedLines[j++]}`); }
  }
  while (i < n) out.push(`- ${actualLines[i++]}`);
  while (j < m) out.push(`+ ${expectedLines[j++]}`);
  return out;
}

function main() {
  const check = process.argv.includes('--check');
  const { payload, stats } = scanDivisions();
  const generated = render(payload);

  if (check) {
    let onDisk = null;
    try {
      onDisk = fs.readFileSync(OUT_FILE, 'utf8');
    } catch {
      console.error('DRIFT: workforce/divisions.json is MISSING — run: node scripts/generate-divisions.js');
      process.exit(1);
    }
    // generatedAt is excluded from the comparison — see the header note.
    // A commit touching both agents/ and this registry can never embed its
    // own committer date, so byte-matching the timestamp would fail every
    // such commit. Structural content is still compared strictly.
    const strip = (txt) => {
      const obj = JSON.parse(txt);
      delete obj.generatedAt;
      return render(obj);
    };
    let diskNorm;
    try {
      diskNorm = strip(onDisk);
    } catch {
      console.error('DRIFT: workforce/divisions.json is not valid JSON — run: node scripts/generate-divisions.js');
      process.exit(1);
    }
    const genNorm = strip(generated);
    if (diskNorm === genNorm) {
      console.log(`OK: workforce/divisions.json matches the agents/ tree (divisions: ${stats.divisions}, agents: ${stats.agents}, templateFiles: ${stats.templateFiles}; generatedAt excluded from comparison)`);
      process.exit(0);
    }
    console.error('DRIFT: workforce/divisions.json does not match the agents/ tree.');
    console.error('--- workforce/divisions.json (on disk)');
    console.error('+++ generated (expected)');
    for (const line of lineDiff(diskNorm.split('\n'), genNorm.split('\n'))) console.error(line);
    console.error('\nFix: node scripts/generate-divisions.js  (then commit the updated registry)');
    process.exit(1);
  }

  fs.writeFileSync(OUT_FILE, generated);
  console.log(`workforce/divisions.json written — divisions: ${stats.divisions}, agents: ${stats.agents}, templateFiles: ${stats.templateFiles}`);
  for (const d of payload.divisions) {
    console.log(`  ${d.id.padEnd(14)} agentCount=${String(d.agentCount).padStart(2)}${d.template ? '  template=true' : ''}`);
  }
  process.exit(0);
}

main();
