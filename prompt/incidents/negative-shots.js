// prompt/incidents/negative-shots.js
// Phase 25 — Scope H: inject promoted rules into a prompt section as
// negative few-shots — concrete DO rules derived from the system's own
// accident history, not from abstract advice.
//
// INTEGRATION SURFACE (display-only in Scope H — nothing in prompt/assembly
// is wired): sections are Scope-A-shaped specs ({ id, label, order, kind,
// budget, build(ctx) => string }). inject() returns a NEW sections array in
// which the TARGET section's build is wrapped to append (or refresh) a
// bounded, deterministic rules block. The default target is the 'doing-tasks'
// section (order 4, static) from Scope A's canonical registry.
//
//   const registry = registerCanonical(createSectionRegistry());
//   const specs = registry.list().map((s) => ({ ...s }));   // unfrozen copies
//   const withShots = incidents.inject(specs, { section: 'doing-tasks' });
//   const nextRegistry = createSectionRegistry();  // registry is append-only:
//   for (const s of withShots) nextRegistry.register(s);    // rebuild it
//   // nextRegistry.get('doing-tasks').build(ctx) now ends with the block.
//
// Scope H rules implemented here:
//   RULE 4  bounded: maxRulesPerSection (default 5). Overflow drops the
//           OLDEST rules first (ascending ruleId = promotion order —
//           deterministic drop order).
//   RULE 5  idempotent: the block is marker-delimited; injecting again
//           REPLACES the existing marker block, so the same rules with the
//           same opts produce byte-identical section output.
//   RULE 7  deterministic: rules sorted by ruleId; rendered fields are
//           whitespace-collapsed to one line; no timestamps in the block.

import * as log from './log.js';
import { PromptError } from '../assembly/errors.js';

const { INCIDENT_CODES } = log;

const DEFAULT_TARGET = 'doing-tasks'; // Scope A: order 4, static
const DEFAULT_MAX = 5;                // RULE 4

const MARKER_OPEN_PREFIX = '<!-- jexi:negative-few-shots:v1';
const MARKER_CLOSE = '<!-- /jexi:negative-few-shots:v1 -->';
// The open marker carries render params (max/active/method) after the prefix.
const MARKER_BLOCK_RE =
  /<!-- jexi:negative-few-shots:v1[^\n]*-->[\s\S]*?<!-- \/jexi:negative-few-shots:v1 -->/g;

function oneLine(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

function byRuleId(a, b) {
  return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
}

/**
 * Render the negative-few-shots block from active rules.
 * -> { kept:[{ruleId,incidentId}], dropped:[ruleId...], block:string|null }
 * Oldest overflow is DROPPED FIRST (RULE 4): with N kept, the survivors are
 * the N highest ruleIds; `dropped` lists the rest in DROP order (oldest
 * first). Zero active rules -> block:null (an existing block gets removed).
 */
export function renderRules(activeRules, max) {
  const sorted = [...activeRules].sort(byRuleId);
  const cut = Math.max(0, sorted.length - max);
  const dropped = sorted.slice(0, cut).map((r) => r.ruleId);
  const kept = sorted.slice(cut);
  if (kept.length === 0) return { kept: [], dropped, block: null };
  const lines = [
    `${MARKER_OPEN_PREFIX} max=${max} active=${kept.length} method="${log.RULE_METHOD}" -->`,
    ...kept.map(
      (r) =>
        `- WHEN ${oneLine(r.when)} -> DO ${oneLine(r.do)} | BECAUSE ${oneLine(r.because)} | incident:${r.incidentId} rule:${r.ruleId}`,
    ),
    MARKER_CLOSE,
  ];
  return {
    kept: kept.map((r) => ({ ruleId: r.ruleId, incidentId: r.incidentId })),
    dropped,
    block: lines.join('\n'),
  };
}

/**
 * Splice the block into section text: strip any existing marker block first
 * (RULE 5 idempotency), then append. block=null removes an existing block
 * (e.g. after every rule was revoked or superseded away).
 */
function spliceBlock(text, block) {
  const core = String(text).replace(MARKER_BLOCK_RE, '').trimEnd();
  if (block === null) return core;
  return core === '' ? block : `${core}\n\n${block}`;
}

/** Currently active rules from the store (fresh read on every call). */
export function activeRules() {
  const { events } = log.readEvents();
  const state = log.computeState(events);
  return state.rules.filter(log.isActiveRule);
}

function validatedOpts(opts) {
  const max = opts.maxRulesPerSection ?? DEFAULT_MAX;
  if (!Number.isInteger(max) || max <= 0) {
    throw new PromptError(
      INCIDENT_CODES.INVALID_INJECT_OPTS,
      'maxRulesPerSection must be a positive integer',
      { got: String(opts.maxRulesPerSection) },
    );
  }
  const target = opts.section ?? opts.target ?? DEFAULT_TARGET;
  if (typeof target !== 'string' || target.trim() === '') {
    throw new PromptError(
      INCIDENT_CODES.INVALID_INJECT_OPTS,
      'section (target section id) must be a non-empty string',
      { got: String(target) },
    );
  }
  return { max, target };
}

/**
 * incidents.injectionPlan(opts) -> { target, max, kept, dropped, block }
 * The planning half of inject() — exposed so callers (and probes) can see
 * exactly which rules will be injected and which were dropped (RULE 4).
 */
export function injectionPlan(opts = {}) {
  const { max, target } = validatedOpts(opts);
  const rendered = renderRules(activeRules(), max);
  return {
    target,
    max,
    kept: rendered.kept,
    dropped: rendered.dropped,
    block: rendered.block,
  };
}

/**
 * incidents.inject(sections, opts) -> NEW sections array with rules injected.
 *
 * sections: Scope-A-shaped specs; the target section is matched by spec.id.
 *   - build-shaped:   { ..., build(ctx)=>string } -> build wrapped (ctx kept)
 *   - content-shaped: { ..., content:string }     -> content spliced
 *   - anything else on the target id is returned untouched.
 * Non-target entries are returned BY REFERENCE; inputs are never mutated.
 */
export function inject(sections, opts = {}) {
  if (!Array.isArray(sections)) {
    throw new PromptError(
      INCIDENT_CODES.INVALID_SECTIONS,
      'sections must be an array of section specs',
      { got: typeof sections },
    );
  }
  const plan = injectionPlan(opts); // validates opts + renders the block once
  return sections.map((spec) => {
    if (!spec || typeof spec !== 'object' || spec.id !== plan.target) return spec;
    if (typeof spec.build === 'function') {
      const originalBuild = spec.build;
      return {
        ...spec,
        build: (ctx) => spliceBlock(String(originalBuild(ctx ?? {})), plan.block),
      };
    }
    if (typeof spec.content === 'string') {
      return { ...spec, content: spliceBlock(spec.content, plan.block) };
    }
    return spec;
  });
}
