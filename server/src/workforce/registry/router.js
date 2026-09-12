/**
 * WORKFORCE TWO-STAGE ROUTER (Phase 2, Scope D — Agents).
 *
 * Stage 1 (CLASSIFIER): a tiny deterministic intent classifier that maps a
 * request to a small set of requirement tokens. It is intentionally NOT a
 * keyword matcher over agent names — it answers "what capability does this
 * work need?", not "which agent is named in this sentence?".
 *
 * Stage 2 (RESOLUTION): deterministic lookup against the capability index.
 *   - one requirement  -> exactly one best employee (highest capability
 *     coverage, support agents pushed to the back).
 *   - multiple/later  -> harmonic ranking over the requirement set (top-1
 *     only). The router NEVER returns a team from a single requirement —
 *     "Fix this bug and run the tests" STAYS one coworker (the exact
 *     requirement the Scope D contract mandates).
 *   - no requirements  -> null (no agent: the request is direct-answer).
 *
 * Permission resolution is part of resolution: coding work that needs write
 * access resolves to a WRITE-capable coder, read-only work resolves to a
 * READ-only analyst — never the reverse.
 */
import { ensureIndex, listAgents, findByCapability } from './index.js';

/** Requirement token vocabulary. Task words (bug/run/tests) collapse to
 * capability tokens (code, verification) — never to agent ids. */
const REQ_SYNONYMS = {
  code: ['code', 'fix', 'implement', 'debug', 'write', 'build', 'refactor', 'coding'],
  research: ['research', 'investigate', 'find', 'search', 'analyze', 'compare'],
  verification: ['test', 'verify', 'check', 'validate', 'review', 'qa', 'run tests'],
  security: ['security', 'harden', 'threat', 'audit', 'vulnerability'],
  data: ['data', 'query', 'sql', 'analyze data', 'report'],
  design: ['design', 'ui', 'ux', 'style', 'visual'],
  memory: ['remember', 'recall', 'summarize', 'episode'],
  computer: ['browser', 'desktop', 'click', 'navigate', 'playwright'],
};

/** Mutating code verbs — presence turns a `code` requirement into WRITE work,
 * so the router never hands a code-mutation request to a read-only analyst. */
const MUTATION_VERBS = ['fix', 'implement', 'debug', 'write', 'build', 'refactor', 'repair', 'patch'];

/** Stage 1: request -> requirement tokens + mutation flag.
 * Returns { requirements, mutation, keyword } where `mutation` is true when
 * the request couples `code` with a mutating verb ("fix this bug"). */
export function classifyRequest(query) {
  const q = String(query || '').toLowerCase();
  const requirements = new Set();
  let keyword = null;
  let mutation = false;
  for (const [req, words] of Object.entries(REQ_SYNONYMS)) {
    for (const w of words) {
      if (q.includes(w)) {
        requirements.add(req);
        keyword = keyword || w;
        break;
      }
    }
  }
  if (requirements.has('code') && MUTATION_VERBS.some((v) => q.includes(v))) {
    mutation = true;
  }
  return { requirements: [...requirements], keyword, mutation };
}

/** Stage 2: deterministic resolution over the capability index.
 * `requireWritableCoder` — when true (e.g. "fix this bug and write files"),
 * only WRITE-permission employees are eligible. */
export function resolveAgent(requirements, { requireWrite = false } = {}) {
  ensureIndex();
  const reqs = Array.isArray(requirements) ? requirements : [];
  if (!reqs.length) return null;

  const all = listAgents();
  const score = (agent) => {
    const caps = new Set(agent.capabilities.map((c) => c.toLowerCase()));
    let covered = 0;
    for (const r of reqs) {
      if (caps.has(r)) covered += 1;
      else if (agent.supportedTools.some((t) => t.toLowerCase().includes(r))) covered += 0.5;
    }
    // permission gate: write-required work picks WRITE-capable agents
    if (requireWrite && !agent.permissions.includes('WRITE')) return 0;
    return covered / reqs.length;
  };

  const ranked = all
    .filter((a) => score(a) > 0)
    .map((a) => ({ agent: a, score: score(a) }))
    .sort((x, y) => y.score - x.score || (x.agent.support ? 1 : -1) - (y.agent.support ? 1 : -1));

  if (!ranked.length) return null;

  const top = ranked[0];
  const ties = ranked.filter((r) => r.score === top.score && r.agent.agentId !== top.agent.agentId);
  if (top.score === 0.5 && ties.length) return null; // ambiguous half-coverage
  return top.agent;
}

/** Convenience: full two-stage flow. Returns { requirements, mutation, agent, agents }
 * `requireWrite` can be forced by the caller; otherwise the router INFERS it
 * from the request's mutation verbs (`fix`/`implement`/... on `code`). */
export function routeRequest(query, { requireWrite } = {}) {
  const { requirements, mutation } = classifyRequest(query);
  const write = typeof requireWrite === 'boolean' ? requireWrite : mutation;
  const agent = resolveAgent(requirements, { requireWrite: write });
  return { requirements, mutation, agent, agents: agent ? [agent] : [] };
}

/** Read-only vs write-capable coding lookup: the Scope D contract guarantees
 * the READ-coding agent and WRITE-coding agent are DIFFERENT agents. */
export function codingAgents() {
  ensureIndex();
  const coders = listAgents().filter((a) => a.capabilities.includes('code'));
  const writable = coders.find((a) => a.permissions.includes('WRITE')) || null;
  const readOnly = coders.filter((a) => !a.permissions.includes('WRITE')).shift() || null;
  return { writable, readOnly };
}