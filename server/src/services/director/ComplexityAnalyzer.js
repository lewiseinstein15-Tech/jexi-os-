/**
 * B211 B2 — COMPLEXITY ANALYZER: mission classification → execution depth.
 *
 * ONE classification pass before planning decides HOW DEEP the mission runs:
 *
 *   complexity: SIMPLE | MODERATE | COMPLEX | LONG_HORIZON
 *   risk:       LOW | MEDIUM | HIGH | CRITICAL
 *   executionDepth (deterministic mapping — one place, no magic elsewhere):
 *     imagination      — run the Imagination Engine before planning
 *     checkpointMode   — light | standard | deep (reporting/checkpoint cadence)
 *     requiresApproval — CRITICAL risk gates the mission behind user approval
 *     suggestedParallel— worker hint for the ready-work batch
 *
 * Honesty rules:
 *   - decidedBy records WHO classified: 'llm' (a real lane answered with a
 *     valid verdict) or 'heuristics' (no lane answered — deterministic
 *     signal-counting, marked as such, never presented as model judgment)
 *   - heuristics never inflate: uncertainty maps DOWN to the simpler tier
 *   - risk is classified from what the objective LITERALLY says; nothing is
 *     assumed about intent
 */

import { parseModelJson } from './JsonRepair.js';

export const COMPLEXITY_LEVELS = ['SIMPLE', 'MODERATE', 'COMPLEX', 'LONG_HORIZON'];
export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/** Deterministic depth mapping. Single source of truth for execution depth. */
export function depthFor(complexity, risk) {
  const c = COMPLEXITY_LEVELS.includes(complexity) ? complexity : 'MODERATE';
  const r = RISK_LEVELS.includes(risk) ? risk : 'LOW';
  const base = {
    SIMPLE:       { imagination: false, checkpointMode: 'light',   suggestedParallel: 3 },
    MODERATE:     { imagination: false, checkpointMode: 'standard', suggestedParallel: 3 },
    COMPLEX:      { imagination: true,  checkpointMode: 'standard', suggestedParallel: 3 },
    LONG_HORIZON: { imagination: true,  checkpointMode: 'deep',    suggestedParallel: 2 },
  }[c];
  return { ...base, requiresApproval: r === 'CRITICAL' };
}

/* ── heuristic signals (deterministic fallback — and the honesty floor) ── */

const DOMAIN_SIGNALS = [
  ['code',      /\b(code|build|implement|api|script|app|refactor|bug|fix|function|component|library|test)\b/],
  ['research',  /\b(research|investigate|find out|compare|survey|study|look up)\b/],
  ['synthesis', /\b(write|draft|summarize|summarise|compose|report on|essay|article)\b/],
  ['data',      /\b(data|dataset|csv|scrape|extract|transform|convert|migrate|database)\b/],
  ['design',    /\b(design|wireframe|layout|mockup|logo|ui|ux)\b/],
  ['verify',    /\b(verify|audit|check|validate|review|proofread)\b/],
];

const HORIZON_RE = /\b(full[- ]stack|end[- ]to[- ]end|entire (app|site|system|pipeline)|whole (app|site|system)|complete (app|site|system)|from scratch|pipeline)\b/;
const SEQ_RE = /\b(then|after that|next|once|before|and finally|step \d|first\b[^.?!]*\bthen)\b/g;

/** Destructive/irreversible/external-effect markers — risk comes from the text. */
const MONEY_RE = /\b(pay|purchase|buy|send money|transfer \$|checkout|subscribe)\b/;
const BROADCAST_RE = /\b(email|message|post|publish|send|notify)\b[^.?!]{0,40}\b(everyone|all users|all contacts|all customers|the whole team|every user|all members)\b/;
const DESTRUCTIVE_RE = /\b(delete|drop|wipe|erase|destroy|overwrite|reset|purge|remove all)\b/;
const DESTRUCTIVE_SCOPE_RE = /\b(production|database|repo|repository|everything|all data|all files|entire|whole)\b/;
const EXTERNAL_EFFECT_RE = /\b(send|email|post|publish|submit|deploy|delete|drop|overwrite|reset|wipe|notify)\b/;
const SENSITIVE_RE = /\b(credentials?|passwords?|api keys?|secrets?|tokens?)\b/;

function heuristicComplexity(text) {
  const l = String(text || '').toLowerCase();
  const words = l.match(/[a-z0-9']+/g) || [];
  const domains = DOMAIN_SIGNALS.filter(([, re]) => re.test(l)).map(([name]) => name);
  const seqMarkers = (l.match(SEQ_RE) || []).length;
  const horizon = HORIZON_RE.test(l);
  const lengthBonus = (words.length > 40 ? 1 : 0) + (words.length > 90 ? 1 : 0);
  const score = domains.length + seqMarkers + lengthBonus + (horizon ? 2 : 0);

  const reasons = [];
  if (domains.length) reasons.push(`domains: ${domains.join('+')}`);
  if (seqMarkers) reasons.push(`${seqMarkers} sequencing marker(s)`);
  if (horizon) reasons.push('horizon marker (full build, end-to-end, pipeline)');
  if (lengthBonus) reasons.push(`long objective (${words.length} words)`);

  let complexity;
  if (horizon && domains.length >= 2) complexity = 'LONG_HORIZON';
  else if (score >= 6) complexity = 'LONG_HORIZON';
  else if (score >= 4) complexity = 'COMPLEX';
  else if (score >= 2) complexity = 'MODERATE';
  else complexity = 'SIMPLE';
  if (!reasons.length) reasons.push('single short objective, no multi-domain signals');
  return { complexity, reasons, domains };
}

function heuristicRisk(text) {
  const l = String(text || '').toLowerCase();
  const reasons = [];
  let risk = 'LOW';
  if (MONEY_RE.test(l)) { risk = 'CRITICAL'; reasons.push('spending/transfer verbs (money is irreversible)'); }
  else if (BROADCAST_RE.test(l)) { risk = 'CRITICAL'; reasons.push('broadcast to many recipients (external, irreversible)'); }
  else if (DESTRUCTIVE_RE.test(l) && DESTRUCTIVE_SCOPE_RE.test(l)) { risk = 'CRITICAL'; reasons.push('destructive verb against a broad/production scope'); }
  else if (DESTRUCTIVE_RE.test(l)) { risk = 'HIGH'; reasons.push('destructive verb'); }
  else if (EXTERNAL_EFFECT_RE.test(l)) { risk = 'HIGH'; reasons.push('external side effect (send/deploy/publish)'); }
  else if (SENSITIVE_RE.test(l)) { risk = 'MEDIUM'; reasons.push('sensitive material (credentials/secrets) mentioned'); }
  if (!reasons.length) reasons.push('no destructive, financial, broadcast or external-effect signals');
  return { risk, reasons };
}

/** Deterministic, LLM-free classification. Always available, always honest about what it is. */
export function heuristicAnalysis(objective) {
  const c = heuristicComplexity(objective);
  const r = heuristicRisk(objective);
  return {
    complexity: c.complexity,
    risk: r.risk,
    reasons: [...c.reasons, ...r.reasons].slice(0, 6),
    decidedBy: 'heuristics',
  };
}

/**
 * Classify a mission objective. LLM-first (a real lane refines with judgment);
 * heuristics are the floor and the fallback. Never throws — a classification
 * failure degrades to heuristics, marked honestly.
 * @param {string} objective
 * @param {{ llm?: Function }} opts  llm: ({ system, user }) => Promise<string>
 */
export async function analyzeObjective(objective, { llm } = {}) {
  const text = String(objective || '');
  const heuristic = heuristicAnalysis(text);

  if (typeof llm === 'function') {
    try {
      const system = [
        'You are JEXI — the Director. MISSION COMPLEXITY classification.',
        'Classify the objective for execution depth. You are classifying WORK STRUCTURE, not difficulty of thought.',
        'complexity: SIMPLE (one short self-contained task) | MODERATE (2-3 steps, one domain) | COMPLEX (multi-domain or multi-stage) | LONG_HORIZON (full build / end-to-end system / many stages over time).',
        'risk: LOW | MEDIUM (sensitive material) | HIGH (external side effects: send/deploy/publish/destructive) | CRITICAL (money, broadcast to many people, or destructive action against production/broad scope).',
        'Reasons must cite the actual words in the objective. When unsure between two tiers, choose the SIMPLER tier and say why.',
        'Output ONLY JSON: {"complexity":"...","risk":"...","reasons":["..."]}',
      ].join('\n');
      const raw = await llm({ system, user: `# MISSION OBJECTIVE\n"${text.slice(0, 2000)}"` });
      const parsed = parseModelJson(raw);
      if (parsed && typeof parsed === 'object' &&
          COMPLEXITY_LEVELS.includes(parsed.complexity) && RISK_LEVELS.includes(parsed.risk)) {
        return {
          complexity: parsed.complexity,
          risk: parsed.risk,
          reasons: (Array.isArray(parsed.reasons) ? parsed.reasons : []).map(String).slice(0, 6),
          decidedBy: 'llm',
          executionDepth: depthFor(parsed.complexity, parsed.risk),
        };
      }
    } catch { /* no lane answered — heuristics below, marked honestly */ }
  }
  return { ...heuristic, executionDepth: depthFor(heuristic.complexity, heuristic.risk) };
}
