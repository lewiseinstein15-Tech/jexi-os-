/**
 * JEXI OS — GLOBAL WORLD MODEL (AGI Phase 4).
 *
 * A structured representation of JEXI's world (spec §24): users, projects,
 * files, repositories, websites, applications, APIs, tools, tasks, goals,
 * constraints, dependencies, events, results, uncertainties.
 *
 * NOT a chat-history database: entities are typed, facts are epistemic claim
 * records (Phase B vocabulary — inferences stay LIKELY, observations are
 * KNOWN, conflicts become CONTRADICTED), relations are typed edges, and the
 * event log is bounded. Mission-scoped WorldState remains the mission's view;
 * this is the global store it feeds (full unification lands with the
 * CognitiveCore phase, strangler-style).
 */

import fs from 'node:fs';
import path from 'node:path';
import { makeClaim, mergeClaims } from './Epistemics.js';

const FILE = () => path.join(process.env.DATA_DIR || './data', 'world-model.json');
export const ENTITY_TYPES = ['user', 'project', 'file', 'repo', 'site', 'app', 'api', 'tool', 'task', 'goal', 'constraint', 'event'];
export const RELATION_TYPES = ['part-of', 'depends-on', 'uses', 'owns', 'relates-to', 'produced', 'blocked-by'];
const MAX_EVENTS = 300;

let model = null;

function blank() {
  return { entities: {}, relations: [], events: [], updatedAt: null, version: 1 };
}

function load() {
  if (model) return model;
  try {
    model = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    if (!model.entities) model = blank();
  } catch { model = blank(); }
  return model;
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(FILE()), { recursive: true });
    model.updatedAt = new Date().toISOString();
    const tmp = FILE() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(model));
    fs.renameSync(tmp, FILE());
  } catch { /* disk issues must never break execution */ }
}

/** Get or create a typed entity. */
export function entity(type, name) {
  const m = load();
  if (!ENTITY_TYPES.includes(type)) throw new Error(`unknown entity type '${type}'`);
  const key = `${type}:${String(name).toLowerCase().slice(0, 120)}`;
  if (!m.entities[key]) {
    m.entities[key] = { key, type, name: String(name).slice(0, 200), facts: {}, relations: [], createdAt: new Date().toISOString() };
  }
  return m.entities[key];
}

/**
 * Record a fact about an entity as an epistemic claim (Phase B rules apply:
 * an INFERRED fact never overwrites an OBSERVED one; conflicting KNOWN facts
 * become CONTRADICTED with both sides kept).
 */
export function recordFact(type, name, { attribute, value, source = 'OBSERVED', confidence = 0.8, evidence = null }) {
  const e = entity(type, name);
  const claim = makeClaim({ key: `${e.key}#${attribute}`, value, source, confidence, evidence });
  const prev = e.facts[attribute];
  e.facts[attribute] = prev ? mergeClaims(prev, claim) : claim;
  persist();
  return e.facts[attribute];
}

/** Typed relation between two entities. */
export function relate(fromType, fromName, relation, toType, toName) {
  if (!RELATION_TYPES.includes(relation)) throw new Error(`unknown relation '${relation}'`);
  const from = entity(fromType, fromName);
  const to = entity(toType, toName);
  if (!from.relations.some((r) => r.relation === relation && r.to === to.key)) {
    from.relations.push({ relation, to: to.key, at: new Date().toISOString() });
  }
  persist();
  return from;
}

/** Append a world event (bounded). */
export function recordEvent(kind, detail = {}, { source = 'OBSERVED' } = {}) {
  const m = load();
  m.events.push({ at: new Date().toISOString(), kind: String(kind).slice(0, 80), detail, epistemic: source === 'OBSERVED' ? 'KNOWN' : source === 'PREDICTED' ? 'UNCERTAIN' : 'LIKELY' });
  while (m.events.length > MAX_EVENTS) m.events.shift();
  persist();
  return m.events.at(-1);
}

/** What does JEXI currently believe about an entity? */
export function entityView(type, name) {
  const e = entity(type, name);
  const facts = {};
  for (const [attr, claim] of Object.entries(e.facts)) {
    facts[attr] = { value: claim.value, epistemic: claim.epistemic, confidence: claim.confidence, source: claim.source };
  }
  return { key: e.key, type: e.type, name: e.name, facts, relations: e.relations };
}

/** Structured query: by type, by name fragment, by relation. */
export function queryWorld({ type = null, nameContains = null, relatedTo = null, limit = 50 } = {}) {
  const m = load();
  let rows = Object.values(m.entities);
  if (type) rows = rows.filter((e) => e.type === type);
  if (nameContains) rows = rows.filter((e) => e.name.toLowerCase().includes(String(nameContains).toLowerCase()));
  if (relatedTo) {
    const target = String(relatedTo).toLowerCase();
    rows = rows.filter((e) => e.relations.some((r) => r.to.includes(target)) || e.key.includes(target));
  }
  return rows.slice(0, limit).map((e) => entityView(e.type, e.name));
}

/** The uncertainty report: every claim not yet KNOWN, weakest first. */
export function uncertainties() {
  const m = load();
  const out = [];
  for (const e of Object.values(m.entities)) {
    for (const [attr, claim] of Object.entries(e.facts)) {
      if (claim.epistemic !== 'KNOWN') out.push({ entity: e.key, attribute: attr, epistemic: claim.epistemic, source: claim.source, value: claim.value });
    }
  }
  const rank = { CONTRADICTED: 0, UNKNOWN: 1, UNCERTAIN: 2, LIKELY: 3, KNOWN: 4 };
  return out.sort((a, b) => rank[a.epistemic] - rank[b.epistemic]);
}

export function worldModelStats() {
  const m = load();
  const byType = {};
  for (const e of Object.values(m.entities)) byType[e.type] = (byType[e.type] || 0) + 1;
  return { entities: Object.keys(m.entities).length, byType, relations: m.relationsFlat ? m.relationsFlat : Object.values(m.entities).reduce((n, e) => n + e.relations.length, 0), events: m.events.length };
}

/** Test seam: wipe everything including the file. */
export function __resetWorldModel() {
  model = blank();
  try { fs.rmSync(FILE(), { force: true }); } catch { /* fine */ }
}

/** Test seam: drop the in-memory cache but KEEP the file (simulates a restart). */
export function __dropCache() { model = null; }
