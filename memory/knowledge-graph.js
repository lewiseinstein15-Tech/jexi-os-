/**
 * JEXI OS — Phase 17 Scope D — MEMORY / KNOWLEDGE GRAPH (enhancement layer).
 *
 * Entity/relation graph built from Phase 4 `MemoryEntry` objects.
 *
 *   Entity types : person | project | technology | concept | decision
 *   Relation types: mentioned_with | references | contradicts | supersedes
 *                  | depends_on
 *
 * EXTRACTION — LABELED RULE-BASED EXTRACTOR (no LLM key needed, none used):
 * `createRuleExtractor()` really parses entry text with deterministic rules:
 *   • `backticked identifiers`            → technology (decision if the
 *                                           sentence says "decided/decision")
 *   • Capitalized Firstname Lastname      → person
 *   • "the X project" / "project X"       → project
 *   • "the idea/concept of X"             → concept
 *   • "depends on X"                      → depends_on  ⟨subject → X⟩
 *   • "supersedes|replaces X"             → supersedes   ⟨subject → X⟩
 *   • "contradicts|conflicts with X"      → contradicts  ⟨subject → X⟩
 *   • "references|see: X"                 → references   ⟨subject → X⟩
 *   • any two entities in one entry       → mentioned_with (pairwise)
 * `subject` of an entry = its first extracted entity (or metadata.subject).
 * Label: every graph built with it carries `extractor: 'rule-based — LLM
 * extraction NOT VERIFIED'`. Plug an LLM extractor later via
 * `buildGraph(entries, { extractor })` — same output contract.
 */

export const ENTITY_TYPES = Object.freeze(['person', 'project', 'technology', 'concept', 'decision']);
export const RELATION_TYPES = Object.freeze(['mentioned_with', 'references', 'contradicts', 'supersedes', 'depends_on']);

const RULE_EXTRACTOR_LABEL = 'rule-based — LLM extraction NOT VERIFIED';

/** Deterministic rule-based entity/relation extractor (labeled). */
export function createRuleExtractor() {
  return {
    name: RULE_EXTRACTOR_LABEL,
    /** @returns {{entities: Array<{name, type}>, relations: Array<{type, from, to}>}} */
    extract(content) {
      const text = String(content || '');
      const entities = [];
      const relations = [];
      const seen = new Set();
      const push = (name, type) => {
        const key = name.toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        entities.push({ name, type });
      };

      // Backticked identifiers — the entry author's explicit entity markup.
      const backticked = [...text.matchAll(/`([A-Za-z][A-Za-z0-9_. -]{1,40})`/g)].map((m) => m[1].trim());
      for (const name of backticked) {
        const sentence = text.slice(Math.max(0, text.indexOf(name) - 60), text.indexOf(name) + 60).toLowerCase();
        const type = /\b(decided|decision|we choose|chose)\b/.test(sentence) ? 'decision' : 'technology';
        push(name, type);
      }

      // Person: Capitalized First Last. A leading stopword (Project, Team,
      // Decision, …) marks a non-person phrase and is skipped — deterministic;
      // may still over-match, which is acceptable and labeled.
      const PERSON_STOP = new Set(['the', 'this', 'that', 'these', 'those', 'project', 'team', 'decision', 'note', 'correction', 'audit', 'phase', 'scope']);
      for (const m of text.matchAll(/\b([A-Z][a-z]{1,15}) ([A-Z][a-z]{1,15})\b/g)) {
        const name = `${m[1]} ${m[2]}`;
        if (PERSON_STOP.has(m[1].toLowerCase())) continue;
        push(name, 'person');
      }

      // project / concept phrasing around a capitalized or backticked token.
      for (const m of text.matchAll(/\bproject ([A-Za-z][A-Za-z0-9_-]{2,30})/gi)) push(m[1], 'project');
      for (const m of text.matchAll(/\bthe ([A-Za-z][A-Za-z0-9_-]{2,30}) project\b/gi)) push(m[1], 'project');
      for (const m of text.matchAll(/\bconcept of ([A-Za-z][A-Za-z0-9_-]{2,30})/gi)) push(m[1], 'concept');

      // Directed relations ⟨subject → X⟩; subject resolved after extraction.
      const pushRel = (type, to) => relations.push({ type, from: '__subject__', to: String(to).trim().replace(/`/g, '') });
      // Contradicts: prefer an explicit `backticked` target (exact name), then
      // fall back to the open phrasing rule.
      const contraBack = [...text.matchAll(/\b(?:contradicts|conflicts with) `([^`\n]{1,60})`/gi)];
      if (contraBack.length) for (const m of contraBack) pushRel('contradicts', m[1]);
      else for (const m of text.matchAll(/\b(?:contradicts|conflicts with) ([A-Za-z][A-Za-z0-9_.-]{1,40}?)(?=[.,;:]|$|\s(?:which|that|because)\b|\s`)/gi)) pushRel('contradicts', m[1]);

      const relRules = [
        { re: /\bdepends on `([^`\n]{1,60})`/gi, backtick: true, type: 'depends_on' },
        { re: /\bdepends on ([A-Za-z][A-Za-z0-9_.-]{1,40}?)(?=[.,;]|$|\s--|\s(and|which|that)\b)/gi, type: 'depends_on' },
        { re: /\b(?:supersedes|replaces) `([^`\n]{1,60})`/gi, backtick: true, type: 'supersedes' },
        { re: /\b(?:supersedes|replaces) ([A-Za-z][A-Za-z0-9_.-]{1,40}?)(?=[.,;]|$|\s--|\s(?:and|which|that|because)\b)/gi, type: 'supersedes' },
        { re: /\b(?:references|see:) `([^`\n]{1,60})`/gi, backtick: true, type: 'references' },
        { re: /\b(?:references|see:) ([A-Za-z][A-Za-z0-9_.-]{1,40}?)(?=[.,;]|$)/gi, type: 'references' },
      ];
      for (const { re, type } of relRules) {
        for (const m of text.matchAll(re)) pushRel(type, m[1]);
      }

      // Pairwise co-occurrence within the entry.
      for (let i = 0; i < entities.length; i++) {
        for (let j = i + 1; j < entities.length; j++) {
          relations.push({ type: 'mentioned_with', from: entities[i].name, to: entities[j].name });
        }
      }

      const subject = entities[0]?.name || null;
      for (const r of relations) if (r.from === '__subject__') r.from = subject;
      return { entities, relations: relations.filter((r) => r.from && r.to) };
    },
  };
}

/**
 * Build the graph from entries.
 * @param {Array<object>} entries  MemoryEntry[] (+ optional metadata.entities
 *                                 for entries that carry explicit annotations)
 * @param {object} [o]             { extractor = createRuleExtractor() }
 * @returns graph — plain object with Maps exposed as arrays on demand
 */
export function buildGraph(entries, { extractor = createRuleExtractor() } = {}) {
  const entities = new Map();   // lowercased name → { name, type, entryIds:Set }
  const relations = [];         // { type, from, to, entryId }
  let entryCount = 0;

  const addEntity = (name, type, entryId) => {
    const key = String(name).toLowerCase();
    if (!key) return;
    if (!entities.has(key)) entities.set(key, { name: String(name), type: type || 'concept', entryIds: new Set() });
    const e = entities.get(key);
    if (entryId) e.entryIds.add(entryId);
  };
  const addRelation = (type, from, to, entryId) => {
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) return;
    relations.push({ type, from: from.toLowerCase(), to: to.toLowerCase(), entryId });
  };

  for (const entry of entries || []) {
    entryCount += 1;
    const id = entry.id || `entry-${entryCount}`;
    const explicit = Array.isArray(entry.metadata?.entities) ? entry.metadata.entities : [];
    const extracted = extractor.extract(entry.content);
    const all = [...explicit, ...extracted.entities];
    for (const ent of all) addEntity(ent.name, ent.type, id);

    // Subject: first explicit, else first extracted, else metadata.subject.
    const subject = all[0]?.name ?? entry.metadata?.subject ?? null;

    for (const rel of extracted.relations) {
      const from = rel.from === '__subject__' || rel.from === null ? subject : rel.from;
      addRelation(rel.type, from, rel.to, id);
    }
    // Explicit metadata relations (optional, same contract).
    for (const rel of entry.metadata?.relations || []) addRelation(rel.type, rel.from ?? subject, rel.to, id);
  }

  return {
    extractor: extractor.name || 'unknown',
    entities,
    relations,
    entryCount,
    /** Pairs of entities joined by a contradicts edge (with entry ids). */
    contradictionPairs() {
      return relations.filter((r) => r.type === 'contradicts')
        .map((r) => ({ a: r.from, b: r.to, entryIds: [r.entryId] }));
    },
  };
}

/** Entity lookup by exact (case-insensitive) name. */
export function getEntity(graph, name) {
  const e = graph.entities.get(String(name).toLowerCase());
  return e ? { ...e, entryIds: [...e.entryIds] } : null;
}

/**
 * neighbors(name) — every entity directly connected to `name`, with the
 * relations that bind them. Sorted by relation type then name (deterministic).
 */
export function neighbors(graph, name) {
  const key = String(name).toLowerCase();
  if (!graph.entities.has(key)) {
    const err = new Error(`neighbors: unknown entity "${name}"`);
    err.code = 'E_UNKNOWN_ENTITY';
    throw err;
  }
  const out = [];
  for (const r of graph.relations) {
    if (r.from === key) out.push({ relation: r.type, direction: 'out', other: r.to, entryId: r.entryId });
    else if (r.to === key) out.push({ relation: r.type, direction: 'in', other: r.from, entryId: r.entryId });
  }
  out.sort((a, b) => a.relation.localeCompare(b.relation) || a.other.localeCompare(b.other));
  return { entity: getEntity(graph, key), related: out };
}

/**
 * path(a, b) — shortest chain (BFS, undirected traversal over typed edges).
 * @returns {Array<{from, relation, to}>} the chain, or null with {code}
 */
export function path(graph, a, b) {
  const s = String(a).toLowerCase(), t = String(b).toLowerCase();
  if (!graph.entities.has(s)) { const e = new Error(`path: unknown entity "${a}"`); e.code = 'E_UNKNOWN_ENTITY'; throw e; }
  if (!graph.entities.has(t)) { const e = new Error(`path: unknown entity "${b}"`); e.code = 'E_UNKNOWN_ENTITY'; throw e; }
  if (s === t) return [];
  const adj = new Map();
  const link = (x, y, r) => { if (!adj.has(x)) adj.set(x, []); adj.get(x).push({ to: y, rel: r }); };
  for (const r of graph.relations) { link(r.from, r.to, r.type); link(r.to, r.from, r.type); }
  const prev = new Map([[s, null]]);
  const queue = [s];
  while (queue.length) {
    const cur = queue.shift();
    for (const { to, rel } of adj.get(cur) || []) {
      if (prev.has(to)) continue;
      prev.set(to, { via: cur, rel });
      if (to === t) {
        const chain = [];
        let step = to;
        while (prev.get(step)?.via) {
          const p = prev.get(step);
          chain.unshift({ from: p.via, relation: p.rel, to: step });
          step = p.via;
        }
        return chain;
      }
      queue.push(to);
    }
  }
  const e = new Error(`path: no path between "${a}" and "${b}"`);
  e.code = 'E_NO_PATH';
  throw e;
}

export default { ENTITY_TYPES, RELATION_TYPES, createRuleExtractor, buildGraph, getEntity, neighbors, path };
