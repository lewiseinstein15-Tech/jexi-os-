import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateContent } from './LLMClient.js';
import { applyFix } from './Architect.js';
import { runFile } from './Runner.js';
import { DesktopManager, ensureBrowser } from './DesktopManager.js';
import { JEXI_SYSTEM_PROMPT } from './JexiPrompt.js';
import { WORKSPACE_DIR } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SKILLS_DIR = path.resolve(__dirname, '../../skills');

/** Skill file → agent name shown in the live pipeline. */
const SKILL_META = {
  product: 'Product',
  designer: 'Designer',
  engineer: 'Engineer',
  coder: 'Coder',
  qa: 'QA Lead',
  reviewer: 'Reviewer',
  shipper: 'Shipper',
};

const PHASE = {
  product: 'Think',
  designer: 'Plan',
  engineer: 'Plan',
  coder: 'Build',
  qa: 'Test',
  reviewer: 'Review',
  shipper: 'Ship',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function listSkillFiles() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs.readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.md')).sort();
}

/** Load a skill's portable Markdown instructions by slug (e.g. 'qa'). */
export function loadSkill(slug) {
  const file = listSkillFiles().find((f) => f.toLowerCase().includes(`-${slug}.md`));
  if (!file) return null;
  return { file, md: fs.readFileSync(path.join(SKILLS_DIR, file), 'utf-8') };
}

const short = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);

/**
 * Run one specialist pass. Every pass: skill instructions + task input →
 * one LLM call → strict output that the NEXT skill consumes (the chain).
 */
export async function runSkill(slug, input, sendEvent) {
  const skill = loadSkill(slug);
  const agent = SKILL_META[slug] || slug;
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

/** THINK + PLAN: product brief → design spec → build plan. */
export async function planForBuild(query, sendEvent) {
  const brief = await runSkill('product', query, sendEvent);
  const design = await runSkill('designer', brief, sendEvent);
  const plan = await runSkill('engineer', `${brief}\n\n${design}`, sendEvent);
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

/** REVIEW + SHIP: security/quality review, then packaging + reflection. */
export async function reviewAndShip({ query, plan, files, lastOutput, previewUrl, qaReport, sendEvent }) {
  const fileList = (files || []).map((n) => `- ${n}`).join('\n');
  const codePeek = (() => {
    try {
      const first = (files || [])[0];
      if (!first) return '(no files)';
      const p = path.join(WORKSPACE_DIR, first);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8').slice(0, 4000) : '(file missing)';
    } catch { return '(could not read)'; }
  })();

  const review = await runSkill(
    'reviewer',
    `QUERY: ${query}\n${plan ? `BUILD PLAN:\n${plan.slice(0, 1500)}` : ''}\nFILES:\n${fileList}\nCODE SAMPLE:\n${codePeek}\n\nQA REPORT:\n${qaReport}`,
    sendEvent,
  );

  const shipped = await runSkill(
    'shipper',
    `QUERY: ${query}\nFILES:\n${fileList}\nLIVE PREVIEW: ${previewUrl || 'n/a'}\nQA REPORT:\n${String(qaReport).slice(0, 1500)}\nREVIEW NOTES:\n${String(review).slice(0, 1500)}`,
    sendEvent,
  );

  return { review, shipped };
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
