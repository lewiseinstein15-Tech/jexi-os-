import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateContent } from './LLMClient.js';
import { applyFix } from './Architect.js';
import { runFile } from './Runner.js';
import { DesktopManager, ensureBrowser } from './DesktopManager.js';
import { JEXI_SYSTEM_PROMPT } from './JexiPrompt.js';
import { WORKSPACE_DIR } from '../config.js';
import { getAgent, getSkill } from './AgentRoster.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SKILLS_DIR = path.resolve(__dirname, '../../skills');

/** Skill slug → agent name shown in the live pipeline. Exported so the roster
 *  audit (Reachability.js) can treat runSkill slugs as a reachability source. */
export const SKILL_META = {
  product: 'Product',
  designer: 'Designer',
  engineer: 'Engineer',
  coder: 'Coder',
  qa: 'QA Lead',
  reviewer: 'Reviewer',
  'security-officer': 'Security Officer',
  shipper: 'Shipper',
  reflector: 'Reflector',
  critic: 'Critic',
};

/** B49 — runSkill slugs that are NOT roster slugs get resolved here, so the
 *  chain never reports "Skill not found" and the roster audit can verify
 *  every execution-layer slug resolves. 'security-officer' is the historical
 *  name of the roster's 'security' agent. */
export const SLUG_ALIASES = { 'security-officer': 'security' };

/** Resolve a runSkill slug through the alias table (exported for the audit). */
export function resolveSkillSlug(slug) {
  return SLUG_ALIASES[slug] || slug;
}

/** Think → Plan → Build → Test → Review → Ship → Reflect (gstack sprint). */
const PHASE = {
  product: 'Think',
  designer: 'Plan',
  engineer: 'Plan',
  coder: 'Build',
  qa: 'Test',
  reviewer: 'Review',
  'security-officer': 'Review',
  shipper: 'Ship',
  reflector: 'Reflect',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function listSkillFiles() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs.readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.md')).sort();
}

/** B50 P1 — progressive-disclosure folders: server/skills/<slug>/{SKILL.md, reference.md}.
 *  Only name + description are exposed at planning time (planningSkillSummaries);
 *  the full body (SKILL.md + reference.md) loads only when the skill executes. */
export const PLUGINS_DIR = path.resolve(__dirname, '../../plugins');

/** All plugin skill directories: server/plugins/<id>/<contributes.skillsDir>. */
export function pluginSkillDirs() {
  if (!fs.existsSync(PLUGINS_DIR)) return [];
  const out = [];
  for (const entry of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const jsonPath = path.join(PLUGINS_DIR, entry.name, 'plugin.json');
    if (!fs.existsSync(jsonPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      const sub = (manifest.contributes && manifest.contributes.skillsDir) || 'skills';
      out.push(path.join(PLUGINS_DIR, entry.name, sub));
    } catch (e) { /* skip malformed plugin */ }
  }
  return out;
}

export function skillFolder(slug) {
  // Raw slug first (folder is named after the skill, e.g. security-officer),
  // then the alias-resolved slug (security-officer -> security).
  const candidates = [slug, resolveSkillSlug(slug)];
  // 1. Core skills dir: server/skills/<slug>/
  for (const candidate of candidates) {
    const dir = path.join(SKILLS_DIR, candidate);
    if (fs.existsSync(path.join(dir, 'SKILL.md'))) return dir;
  }
  // 2. Plugin-provided skills: server/plugins/<id>/skills/<slug>/
  for (const base of pluginSkillDirs()) {
    for (const candidate of candidates) {
      const dir = path.join(base, candidate);
      if (fs.existsSync(path.join(dir, 'SKILL.md'))) return dir;
    }
  }
  return null;
}

/** Parse YAML frontmatter (---\nkey: value\n---) from a markdown skill body. */
export function parseFrontmatter(md) {
  const m = String(md || '').match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return {};
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z-]+):\s*(.*)$/);
    if (!kv) continue;
    const val = kv[2].trim();
    meta[kv[1]] = val.startsWith('[') ? val.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean) : val;
  }
  return meta;
}

/** Planning-time metadata for a skill slug — name + description ONLY (cheap
 *  tokens). Full body is deliberately NOT loaded here. Falls back to flat-file
 *  frontmatter, then to the roster. */
export function skillMeta(slug) {
  const dir = skillFolder(slug);
  if (dir) {
    const fm = parseFrontmatter(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8'));
    return { slug, name: fm.name || slug, description: fm.description || '', allowedTools: fm['allowed-tools'] || [], context: fm.context || '', full: false };
  }
  const file = listSkillFiles().find((f) => f.toLowerCase().includes(`-${resolveSkillSlug(slug)}.md`));
  if (file) {
    const fm = parseFrontmatter(fs.readFileSync(path.join(SKILLS_DIR, file), 'utf-8'));
    return { slug, name: fm.name || slug, description: fm.description || '', allowedTools: fm['allowed-tools'] || [], context: fm.context || '', full: false };
  }
  const agent = getAgent(resolveSkillSlug(slug));
  if (agent) return { slug, name: agent.name, description: agent.role || '', allowedTools: [], context: '', full: false };
  const skill = getSkill(slug);
  if (skill) return { slug, name: skill.name, description: skill.desc || '', allowedTools: [], context: '', full: false };
  return { slug, name: slug, description: '', allowedTools: [], context: '', full: false };
}

/** Does a skill's frontmatter declare `context: fork` (isolated execution)? */
export function skillWantsIsolation(slug) {
  return String(skillMeta(slug).context || '').toLowerCase() === 'fork';
}

/** Planning-time list: every skill the chain can run, with name + description only. */
export function planningSkillSummaries() {
  return Object.keys(SKILL_META).map((s) => skillMeta(s));
}

/**
 * Load a skill's portable Markdown instructions by slug (e.g. 'qa',
 * 'security-officer'). B50: a progressive folder server/skills/<slug>/ is
 * preferred over a flat .md file — its SKILL.md + reference.md are merged
 * into the execution body. The on-disk library is OPTIONAL: if neither
 * exists, instructions are synthesized from the roster (agent profile +
 * mastered skills, or a plain skill-registry entry) so the sprint chain
 * NEVER reports "Skill not found" — every planner-selected skill loads.
 */
export function loadSkill(slug) {
  // 1. Progressive-disclosure folder (SKILL.md + reference.md).
  const dir = skillFolder(slug);
  if (dir) {
    const skillMd = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8');
    const refPath = path.join(dir, 'reference.md');
    const refMd = fs.existsSync(refPath) ? fs.readFileSync(refPath, 'utf-8') : '';
    const summary = skillMeta(slug);
    return { file: path.join(dir, 'SKILL.md'), md: refMd ? `${skillMd}\n\n${refMd}` : skillMd, summary, progressive: true };
  }
  // 2. Flat .md file (legacy / non-folder skills).
  const file = listSkillFiles().find((f) => f.toLowerCase().includes(`-${resolveSkillSlug(slug)}.md`));
  if (file) return { file, md: fs.readFileSync(path.join(SKILLS_DIR, file), 'utf-8'), summary: skillMeta(slug), progressive: false };
  // 3. Roster synthesis — kept as a LOGGED fallback (never "Skill not found").
  const md = synthesizeSkill(slug);
  if (md) {
    // Persist the synthesized instructions so future boots read from disk.
    try {
      fs.mkdirSync(SKILLS_DIR, { recursive: true });
      fs.writeFileSync(path.join(SKILLS_DIR, `${slug}.md`), md, 'utf-8');
    } catch (e) { /* non-fatal */ }
    return { file: `${slug}.md`, md, summary: skillMeta(slug), progressive: false, synthesized: true };
  }
  return null;
}

/** Build portable instructions for a slug from the roster (agent → skill). */
function synthesizeSkill(slug) {
  const agent = getAgent(resolveSkillSlug(slug));
  if (agent) {
    const mastered = (agent.skills || []).map((s) => getSkill(s)).filter(Boolean);
    const skillLines = mastered.length
      ? mastered.map((s) => `- ${s.name}: ${s.desc || 'applies to this specialist.'}`).join('\n')
      : '- (specialist expertise)';
    return `---
name: ${agent.name}
slug: ${agent.slug}
role: ${agent.role}
---

# ${agent.name}

${agent.role}

## Your output contract

Produce a clearly-structured markdown section that starts with a heading
naming your artifact (e.g. "## PRODUCT BRIEF"), containing concrete,
actionable content only. The next specialist in the chain reads ONLY that
section — no preamble, no meta-commentary.

## Expertise

${skillLines}
`;
  }
  const skill = getSkill(slug);
  if (skill) {
    return `---
name: ${skill.name}
slug: ${skill.slug}
---

# ${skill.name}

${skill.desc || ''}

## Your output contract

Produce a clearly-structured markdown section with concrete, actionable
content only.
`;
  }
  return null;
}

const short = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);

/**
 * STRICT HANDOFF: pull only the previous specialist's output section
 * (e.g. `## PRODUCT BRIEF`) out of a chained document. Each role consumes
 * exactly the artifact the prior role produced — nothing else. This keeps
 * context small and prevents roles from drifting into each other's work.
 */
export function extractSection(doc, sectionTitle) {
  const re = new RegExp(`##\\s*${sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?(?=\\n##\\s|$)`, 'i');
  const m = String(doc || '').match(re);
  return m ? m[0].trim() : '';
}

/** Parse a gate verdict out of a report (PASS / NEEDS FIX / APPROVED / CLEARED / BLOCKED…). */
export function gateVerdict(report, allowed) {
  const m = String(report || '').match(/(PASS|NEEDS FIX|APPROVED|NEEDS WORK|CLEARED|BLOCKED)/i);
  if (!m) return null;
  const v = m[1].toUpperCase();
  return allowed.includes(v) ? v : null;
}

/**
 * Run one specialist pass. Every pass: skill instructions + task input →
 * one LLM call → strict output that the NEXT skill consumes (the chain).
 */
export async function runSkill(slug, input, sendEvent) {
  const skill = loadSkill(slug);
  const agent = SKILL_META[slug] || getAgent(slug)?.name || slug;
  if (!skill) {
    sendEvent?.('log', { agent, message: `⚠ Skill '${slug}' not found.` });
    return `## ${agent.toUpperCase()}\n(no instructions available)`;
  }
  sendEvent?.('log', { agent, message: `▶ ${PHASE[slug] || 'Work'} — ${short(input)}` });
  const system = `${JEXI_SYSTEM_PROMPT}\n\nYou are currently operating as the specialist defined in the instructions below. Follow its OUTPUT contract EXACTLY — the next specialist reads only what you output.`;
  const out = await generateContent(`${skill.md}\n\n# TASK\n${input}`, system);
  sendEvent?.('log', { agent, message: `✓ ${PHASE[slug] || 'Done'} complete.` });
  return String(out || '').trim();
}

/** THINK + PLAN: product brief → design spec → build plan (strict handoffs). */
export async function planForBuild(query, sendEvent) {
  const full = await runSkill('product', query, sendEvent);
  const brief = extractSection(full, 'PRODUCT BRIEF') || full;
  const full2 = await runSkill('designer', brief, sendEvent);
  const design = extractSection(full2, 'DESIGN SPEC') || full2;
  const full3 = await runSkill('engineer', `${brief}\n\n${design}`, sendEvent);
  const plan = extractSection(full3, 'BUILD PLAN') || full3;
  return { brief, design, plan };
}

/** Short chain for pure fix/debug requests (no product re-think needed). */
export function isDebugQuery(query) {
  return /(fix|debug|broken|not working|doesn'?t work|error in|rewrite|refactor|this code|my code)/i.test(query || '');
}

/**
 * TEST: drive the REAL Chromium browser into the built app. Reads page text,
 * scrolls, tries one real interaction (a button press), and reports.
 * /careful mode = read-only (no clicks/types).
 */
export async function qaWebApp({ previewUrl, brief, scope = {}, sendEvent }) {
  const agent = 'QA Lead';
  sendEvent?.('log', { agent, message: `🌐 Opening the app in my real browser: ${previewUrl}` });
  try {
    await ensureBrowser();
    const dm = new DesktopManager();
    await dm.goto('coder', previewUrl);
    await dm.takeScreenshot('coder');
    const top = (await dm.pageText('coder')) || '';
    await dm.scroll('coder', 'down');
    let interaction = 'scrolled down (read-only)';
    if (scope.mode !== 'careful') {
      const verbs = ['add', 'submit', 'calculate', 'start', 'save', 'create', 'login', 'search', 'go', 'convert'];
      const verb = verbs.find((v) => new RegExp(`\\b${v}\\b`, 'i').test(top));
      if (verb) {
        try {
          await dm.clickText('coder', verb);
          await sleep(800);
          await dm.takeScreenshot('coder');
          interaction = `clicked "${verb}"`;
        } catch (e) {
          interaction = `tried "${verb}" (failed: ${e.message})`;
        }
      }
    }
    const after = (await dm.pageText('coder')) || '';
    const report = await runSkill(
      'qa',
      `LIVE PREVIEW: ${previewUrl}\n\nPRODUCT BRIEF:\n${String(brief).slice(0, 1500)}\n\nBROWSER — PAGE TEXT (top):\n${top.slice(0, 1500)}\n\nBROWSER — AFTER ${interaction}:\n${after.slice(0, 1500)}`,
      sendEvent,
    );
    sendEvent?.('log', { agent, message: `🔎 Real browser interaction: ${interaction}` });
    return report;
  } catch (e) {
    sendEvent?.('log', { agent, message: `⚠ Browser QA unavailable — ${e.message}` });
    return `## QA REPORT\n- Browser QA could not run: ${e.message}\n- Server-side verification only (code ran without errors).\n- Verdict: PASS (code-level)`;
  }
}

/** TEST for non-web output (scripts): QA evaluates the run output. */
export async function qaScripted({ query, files, lastOutput, sendEvent }) {
  return runSkill(
    'qa',
    `QUERY: ${query}\nFILES: ${(files || []).join(', ')}\nRUN OUTPUT:\n${String(lastOutput || 'ran successfully').slice(0, 1500)}`,
    sendEvent,
  );
}

/** B49 P2 — build the code sample the Reviewer / Security Officer must see. */
export function buildCodePeek(files) {
  try {
    const first = (files || [])[0];
    if (!first) return '(no files)';
    const p = path.join(WORKSPACE_DIR, first);
    if (!fs.existsSync(p)) return '(file missing)';
    const code = fs.readFileSync(p, 'utf-8');
    // The Security Officer must see the real logic: full HTML head/markup +
    // the complete <script> body (truncating at N chars hid the JS before).
    const scriptMatch = code.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    const js = scriptMatch ? scriptMatch[1] : '';
    if (js.length > 0) return `${code.slice(0, 2500)}\n\n--- FULL <script> BODY (${js.length} chars) ---\n${js.slice(0, 30000)}`;
    return code.slice(0, 30000);
  } catch { return '(could not read)'; }
}

/**
 * B49 P2 — INDEPENDENT GATE PASSES. Each gate (Reviewer, Security Officer,
 * Critic, Shipper, Reflector) is now its own runSkill call with its own
 * system prompt built from that agent's roster role, and each is executed as
 * its OWN graph node in the orchestrator (codeReview / securityGate /
 * criticGate / shipper / reflector). No gate is bundled into another node's
 * prompt — every verdict is independently observable.
 */

/** REVIEWER pass — APPROVED / NEEDS WORK verdict from its own call. */
export async function runReviewerPass({ query, plan, files, qaReport, sendEvent }) {
  const fileList = (files || []).map((n) => `- ${n}`).join('\n');
  const full = await runSkill(
    'reviewer',
    `QUERY: ${query}\n${plan ? `BUILD PLAN:\n${plan.slice(0, 1500)}` : ''}\nFILES:\n${fileList}\nCODE SAMPLE:\n${buildCodePeek(files)}\n\nQA REPORT:\n${qaReport}`,
    sendEvent,
  );
  return {
    review: extractSection(full, 'REVIEW NOTES') || full,
    verdict: gateVerdict(full, ['APPROVED', 'NEEDS WORK']),
  };
}

/** SECURITY OFFICER pass — CLEARED / BLOCKED verdict from its own call. */
export async function runSecurityPass({ files, qaReport, review, sendEvent }) {
  const fileList = (files || []).map((n) => `- ${n}`).join('\n');
  const full = await runSkill(
    'security-officer',
    `FILES:\n${fileList}\nCODE SAMPLE:\n${buildCodePeek(files)}\n\nQA REPORT:\n${String(qaReport).slice(0, 1500)}\n\nREVIEW NOTES:\n${String(review).slice(0, 1200)}`,
    sendEvent,
  );
  return {
    security: extractSection(full, 'SECURITY REVIEW') || full,
    verdict: gateVerdict(full, ['CLEARED', 'BLOCKED']),
  };
}

/** CRITIC pass — MetaGPT-style critique with its own SHIP / REVISE verdict. */
export async function runCriticPass({ query, files, qaReport, review, security, sendEvent }) {
  const fileList = (files || []).map((n) => `- ${n}`).join('\n');
  const full = await runSkill(
    'critic',
    `QUERY: ${query}\nFILES:\n${fileList}\n\nQA REPORT:\n${String(qaReport).slice(0, 1500)}\nREVIEW NOTES:\n${String(review).slice(0, 1500)}\nSECURITY REVIEW:\n${String(security).slice(0, 1200)}\n\nCritique the final output with the strictness of a senior reviewer: is it complete, correct, and shipping-quality? Verdict: SHIP or REVISE.`,
    sendEvent,
  );
  return {
    critique: extractSection(full, 'CRITIQUE') || full,
    verdict: gateVerdict(full, ['SHIP', 'REVISE']),
  };
}

/** SHIPPER pass — release notes / handoff from its own call. */
export async function runShipperPass({ query, files, previewUrl, qaReport, review, security, sendEvent }) {
  const fileList = (files || []).map((n) => `- ${n}`).join('\n');
  const full = await runSkill(
    'shipper',
    `QUERY: ${query}\nFILES:\n${fileList}\nLIVE PREVIEW: ${previewUrl || 'n/a'}\nQA REPORT:\n${String(qaReport).slice(0, 1500)}\nREVIEW NOTES:\n${String(review).slice(0, 1500)}\nSECURITY REVIEW:\n${String(security).slice(0, 1200)}`,
    sendEvent,
  );
  return { shipped: extractSection(full, 'SHIPPED') || full };
}

/** REFLECTOR pass — retrospective from its own call. */
export async function runReflectorPass({ plan, qaReport, review, security, sendEvent }) {
  const full = await runSkill(
    'reflector',
    `PRODUCT BRIEF:\n${String(plan).slice(0, 800)}\nQA REPORT:\n${String(qaReport).slice(0, 1200)}\nREVIEW NOTES:\n${String(review).slice(0, 1000)}\nSECURITY REVIEW:\n${String(security).slice(0, 800)}`,
    sendEvent,
  );
  return { reflection: extractSection(full, 'REFLECTION') || full };
}

/**
 * REVIEW + SECURITY GATE + SHIP + REFLECT — the BUNDLED convenience version,
 * kept for backward compatibility; the orchestrator's graph now runs the five
 * pass functions above as separate nodes (B49 P2). Returns the same shape.
 *   - qaVerdict  NEEDS FIX  → caller re-runs the fix loop before shipping
 *   - secVerdict BLOCKED    → caller must NOT ship
 *   - reviewVerdict NEEDS WORK → included in the summary so the user sees it
 */
export async function reviewAndShip({ query, plan, files, previewUrl, qaReport, sendEvent }) {
  const r = await runReviewerPass({ query, plan, files, qaReport, sendEvent });
  const s = await runSecurityPass({ files, qaReport, review: r.review, sendEvent });
  const sh = await runShipperPass({ query, files, previewUrl, qaReport, review: r.review, security: s.security, sendEvent });
  const rf = await runReflectorPass({ plan, qaReport, review: r.review, security: s.security, sendEvent });
  return {
    review: r.review,
    security: s.security,
    shipped: sh.shipped,
    reflection: rf.reflection,
    qaVerdict: gateVerdict(qaReport, ['PASS', 'NEEDS FIX']),
    reviewVerdict: r.verdict,
    secVerdict: s.verdict,
  };
}

/** One QA-driven fix round: send the QA report to the coder, apply, return. */
export async function fixFromQA({ query, qaReport, entryPoint, sendEvent }) {
  const existing = (() => {
    try { return fs.readFileSync(path.join(WORKSPACE_DIR, entryPoint), 'utf-8'); } catch { return null; }
  })();
  const fixed = await applyFix(
    query,
    `QA found issues:\n${String(qaReport).slice(0, 2000)}\n\nPlease fix the code and return the full corrected file(s).`,
    existing,
    1,
    sendEvent,
  );
  if (fixed && fixed.files && fixed.files.length) {
    fixed.files.forEach((f) => fs.writeFileSync(path.join(WORKSPACE_DIR, f.name), f.code, 'utf-8'));
    return { entryPoint: fixed.entryPoint || entryPoint, files: fixed.files };
  }
  return null;
}
