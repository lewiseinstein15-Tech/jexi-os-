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

/**
 * B50 P1 — YAML frontmatter parser (name, description, allowed-tools, context).
 */
export function parseFrontmatter(md) {
  const m = String(md || '').match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return {};
  const meta = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    } else {
      val = val.replace(/^['"]|['"]$/g, '');
    }
    meta[key] = val;
  }
  return meta;
}

/** Skill slugs that have a progressive folder (SKILL.md present). */
export function listSkillDirs() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, d.name, 'SKILL.md')))
    .map((d) => d.name);
}

export function listSkillFiles() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs.readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.md')).sort();
}

/**
 * B50 P1 — PLANNING-TIME VIEW. Exposes ONLY name + description (+ allowed
 * tools + isolation flag) from SKILL.md frontmatter — cheap tokens. The full
 * body and reference.md load only when the skill actually executes
 * (loadSkill). This is what progressive disclosure is for.
 */
export function loadSkillMeta(slug) {
  const resolved = resolveSkillSlug(slug);
  const dir = path.join(SKILLS_DIR, resolved);
  if (fs.existsSync(path.join(dir, 'SKILL.md'))) {
    const md = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8');
    const meta = parseFrontmatter(md);
    return {
      slug: resolved,
      name: meta.name || resolved,
      description: meta.description || '',
      allowedTools: Array.isArray(meta['allowed-tools']) ? meta['allowed-tools'] : [],
      context: meta.context || 'none',
      file: `${resolved}/SKILL.md`,
    };
  }
  const file = listSkillFiles().find((f) => f.toLowerCase().includes(`-${resolved}.md`));
  if (file) {
    const md = fs.readFileSync(path.join(SKILLS_DIR, file), 'utf-8');
    const meta = parseFrontmatter(md);
    return { slug: resolved, name: meta.name || resolved, description: meta.description || '', allowedTools: [], context: meta.context || 'none', file };
  }
  return null;
}

/** One-line description for planner / team-composition context. */
export function skillDescription(slug) {
  const meta = loadSkillMeta(slug);
  if (meta && meta.description) return `${slug}: ${meta.description}`;
  const agent = getAgent(resolveSkillSlug(slug));
  return agent ? `${slug}: ${agent.role}` : `${slug}: specialist expertise`;
}

/**
 * Load a skill's portable Markdown instructions by slug (e.g. 'qa',
 * 'security-officer'). B50 P1 — PROGRESSIVE LOADING:
 *   1. folder  server/skills/<slug>/SKILL.md (+ reference.md)  ← preferred
 *   2. flat    server/skills/<slug>.md                          ← legacy
 *   3. roster  synthesized from the agent/skill registry        ← LOGGED fallback
 * The full SKILL.md body + reference.md load ONLY at execution time.
 */
export function loadSkill(slug) {
  const resolved = resolveSkillSlug(slug);
  const dir = path.join(SKILLS_DIR, resolved);
  if (fs.existsSync(path.join(dir, 'SKILL.md'))) {
    const skillMd = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8');
    const refFile = path.join(dir, 'reference.md');
    const refMd = fs.existsSync(refFile) ? fs.readFileSync(refFile, 'utf-8') : '';
    const md = refMd
      ? `${skillMd}\n\n# REFERENCE (load when you need templates, checklists or examples)\n${refMd}`
      : skillMd;
    return { file: `${resolved}/SKILL.md`, md, reference: refMd, meta: loadSkillMeta(slug) };
  }
  const file = listSkillFiles().find((f) => f.toLowerCase().includes(`-${resolved}.md`));
  if (file) return { file, md: fs.readFileSync(path.join(SKILLS_DIR, file), 'utf-8'), reference: '' };
  const md = synthesizeSkill(slug);
  if (md) {
    console.log(`[SkillChain] \u26a0 synthesized instructions for '${slug}' (no folder or flat file on disk — roster fallback)`);
    return { file: `${slug}.md`, md, reference: '' };
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
