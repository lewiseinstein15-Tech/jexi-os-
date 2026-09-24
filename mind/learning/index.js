/**
 * JEXI OS — Phase 7 Scope C: CONTINUOUS LEARNING / INSTINCTS — public API.
 *
 *   observer.js   records every tool call into per-session rolling journals
 *   analyzer.js   journals → candidate instincts (5 types, confidence scored)
 *   instinct.js   the instinct model + deterministic confidence
 *   store.js      append-only JSONL: project (.jexi/learning/project.jsonl)
 *                 and global ($JEXI_HOME/learning/global.jsonl, default ~/.jexi)
 *   promoter.js   project → global promotion when criteria are met
 *   index.js      recall for tasks + the context-manager INSTINCTS section
 *                 + the Stop-hook entry + this CLI
 *
 * RECALL: the Phase 6C context manager registers an 'instincts' source
 * (server/src/context/sources/index.js) that calls instinctsSection() here.
 * Recalled instincts appear under an "INSTINCTS" section — project instincts
 * load when they match the current task; global instincts are always available.
 *
 * CLI (on-demand operation, used by probes and operators):
 *   node learning/index.js journal  --session <id> [--tail N]
 *   node learning/index.js analyze  --session <id> [--conversation-file <path>] [--force]
 *   node learning/index.js store    --scope project|global [--id <prefix>] [--limit N]
 *   node learning/index.js sessions
 *   node learning/index.js recall   --task "<text>"
 *   node learning/index.js promote  [--min-confidence 0.8] [--min-sessions 3]
 */

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  INSTINCT_TYPES, computeConfidence, instinctId, normalizePattern, validateInstinct,
} from './instinct.js';
import {
  REPO_ROOT, projectStorePath, globalStorePath, projectLearningRoot,
  readRecords, foldStore, recordCandidate, listInstincts, appendRecord, promotionEvent,
} from './store.js';
import {
  record, observePreToolUse, observePostToolUse, readJournal, listSessions, journalPath,
} from './observer.js';
import {
  extractFromJournal, analyzeSession, analyzeAllSessions, wasAnalyzed, readStore, meetsPromotionCriteria,
} from './analyzer.js';
import { promoteQualified, PROMOTION_DEFAULTS } from './promoter.js';

export {
  INSTINCT_TYPES, computeConfidence, instinctId, normalizePattern, validateInstinct,
  REPO_ROOT, projectStorePath, globalStorePath, projectLearningRoot,
  readRecords, foldStore, recordCandidate, listInstincts, appendRecord, promotionEvent,
  record, observePreToolUse, observePostToolUse, readJournal, listSessions, journalPath,
  extractFromJournal, analyzeSession, analyzeAllSessions, wasAnalyzed, readStore, meetsPromotionCriteria,
  promoteQualified, PROMOTION_DEFAULTS,
};

/* ── RECALL ───────────────────────────────────────────────────────────── */

const MIN_RECALL_TOKENS = 1; // a single shared significant token recalls

function taskText(input = {}) {
  const lastUser = Array.isArray(input.history)
    ? [...input.history].reverse().find((h) => (h.role === 'user' || h.speaker === 'user'))
    : null;
  return String(
    input.task
    || input.instruction
    || input.mission?.goal
    || input.mission?.objective
    || lastUser?.content
    || lastUser?.text
    || '',
  );
}

function scoreMatch(task, pattern) {
  const t = sigTokens(task);
  if (!t.length) return 0;
  const p = new Set(sigTokens(pattern));
  let shared = 0;
  for (const tok of t) if (p.has(tok)) shared++;
  return shared;
}

function sigTokens(text) {
  return [...new Set(String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((x) => x.length >= 3 && !['the','and','for','with','that','this','from','into','when','was','were','have','not','but','all','can','are','its','out','you','your'].includes(x)))];
}

/**
 * Recall instincts relevant to a task.
 * Project instincts load when they match; global instincts are always available.
 */
export function recallForTask(repoRoot, task, { projectLimit = 5, globalLimit = 3 } = {}) {
  const project = listInstincts(projectStorePath(repoRoot), { scope: 'project' }).instincts
    .filter((i) => !i.promoted)
    .map((i) => ({ instinct: i, score: scoreMatch(task, `${i.pattern} ${i.type}`) }))
    .filter((x) => x.score >= MIN_RECALL_TOKENS)
    .sort((a, b) => (b.score - a.score) || (b.instinct.confidence - a.instinct.confidence))
    .slice(0, projectLimit)
    .map((x) => x.instinct);

  const global = listInstincts(globalStorePath(), { scope: 'global' }).instincts
    .sort((a, b) => (b.confidence - a.confidence) || Date.parse(b.lastSeen) - Date.parse(a.lastSeen))
    .slice(0, globalLimit);

  return { task: String(task || ''), project, global };
}

function formatInstinctLine(i) {
  const scopeTag = i.scope === 'global' ? 'global' : 'project';
  const sessions = i.sessionIds?.length ?? 0;
  return `- [${scopeTag}|${i.type}|${i.confidence}] ${i.pattern} (seen ${i.sightings ?? 1}x in ${sessions} session${sessions === 1 ? '' : 's'}, outcome: ${i.lastOutcome || 'succeeded'})`;
}

/**
 * The context-manager section: "INSTINCTS" — empty string when nothing to
 * recall (the context builder skips empty sources).
 */
export async function instinctsSection(input = {}, { repoRoot = REPO_ROOT } = {}) {
  const task = taskText(input);
  const { project, global } = recallForTask(repoRoot, task);
  const lines = [];
  for (const g of global) lines.push(formatInstinctLine(g));
  for (const p of project) lines.push(formatInstinctLine(p));
  if (!lines.length) return '';
  return ['INSTINCTS:', ...lines.slice(0, 8).map((l) => l.slice(0, 220))].join('\n');
}

/* ── Stop-hook entry (kernel seam calls this at turn/mission end) ─────── */

export function runStopAnalysis({ sessionId, agentId = null, repoRoot = REPO_ROOT, ...rest } = {}) {
  try {
    if (!sessionId) return { skipped: 'no sessionId' };
    return analyzeSession(repoRoot, sessionId, { conversation: rest.conversation || [] });
  } catch (e) {
    return { skipped: e?.message || String(e) };
  }
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function num(name, fallback) {
  const v = Number(arg(name, NaN));
  return Number.isFinite(v) ? v : fallback;
}

function printJson(label, obj) {
  console.log(`${label}:`);
  console.log(JSON.stringify(obj, null, 2));
}

async function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'journal': {
      const sid = arg('--session');
      if (!sid) throw new Error('journal needs --session <id>');
      let entries = readJournal(REPO_ROOT, sid);
      const tail = num('--tail', 0);
      if (tail > 0) entries = entries.slice(-tail);
      printJson(`journal ${sid} (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'})`, entries);
      break;
    }
    case 'sessions': {
      printJson('sessions', listSessions(REPO_ROOT));
      break;
    }
    case 'analyze': {
      const sid = arg('--session');
      if (!sid) throw new Error('analyze needs --session <id>');
      let conversation = [];
      const cf = arg('--conversation-file');
      if (cf) conversation = JSON.parse(fs.readFileSync(cf, 'utf8'));
      const res = analyzeSession(REPO_ROOT, sid, { conversation, force: process.argv.includes('--force') });
      printJson(`analyze ${sid}`, res);
      break;
    }
    case 'store': {
      const scope = arg('--scope', 'project');
      const file = scope === 'global' ? globalStorePath() : projectStorePath(REPO_ROOT);
      let { instincts, badLines } = listInstincts(file);
      const idPrefix = arg('--id');
      if (idPrefix) instincts = instincts.filter((i) => i.id.startsWith(idPrefix));
      const limit = num('--limit', 0);
      if (limit > 0) instincts = instincts.slice(0, limit);
      printJson(`store ${scope} (${instincts.length} instinct${instincts.length === 1 ? '' : 's'}, ${badLines} bad lines)`, instincts);
      break;
    }
    case 'recall': {
      const task = arg('--task', '');
      printJson(`recall for task: ${JSON.stringify(task)}`, recallForTask(REPO_ROOT, task));
      break;
    }
    case 'promote': {
      const res = promoteQualified(REPO_ROOT, {
        minConfidence: num('--min-confidence', PROMOTION_DEFAULTS.minConfidence),
        minSessions: num('--min-sessions', PROMOTION_DEFAULTS.minSessions),
      });
      printJson('promotion', res);
      break;
    }
    default:
      console.log('commands: journal --session <id> [--tail N] | sessions | analyze --session <id> [--conversation-file <f>] [--force] | store --scope project|global [--id <pfx>] [--limit N] | recall --task "<text>" | promote [--min-confidence N] [--min-sessions N]');
      process.exitCode = cmd ? 2 : 0;
  }
}

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] || '').href;
  } catch {
    return false;
  }
})();
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
