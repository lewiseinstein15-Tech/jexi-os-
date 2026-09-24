/**
 * JEXI OS — Phase 22 Scope C — GRAPH-BASED RAG (LightRAG pattern).
 *
 * Pattern (HKUDS/LightRAG @ c7e7a24, MIT): retrieval that carries ENTITY and
 * RELATIONSHIP structure through both indexing and query, complementing
 * vector/BM25 relevance with graph traversal.
 *
 * What is ported from upstream:
 *   - the entity/relationship data model (LightRAG's `entity_name`,
 *     `entity_type`, `description`, `source_id`, and the
 *     source→target→keywords→description relation row);
 *   - the default entity-type vocabulary (LightRAG `prompt.py`
 *     `default_entity_types_guidance`: Person, Creature, Organization,
 *     Location, Event, Concept, Method, Content, Data, Artifact,
 *     NaturalObject, Other);
 *   - the retrieval shape: seed entities, expand to their relationships
 *     (`_get_node_data` → `_find_most_related_edges_from_entities` in
 *     `operate.py`), then rank entities and relations.
 *
 * What is NOT ported: LightRAG extracts with an LLM and stores in a pluggable
 * graph/vector DB. This scope is rule-based and standalone.
 *
 *   EXTRACTION IS RULE-BASED.
 *   Label: "rule-based - LLM extraction NOT VERIFIED".
 *
 * This is a STANDALONE subsystem: it does not import or touch memory/** or
 * server/**, and nothing wires it into retrieval (that is a zone-owner task).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const EXTRACTION_MODE = 'rule-based';
export const LLM_EXTRACTION_LABEL = 'rule-based - LLM extraction NOT VERIFIED';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function snapshotDir() {
  return process.env.JEXI_RAG_DIR || path.join(REPO_ROOT, '.jexi', 'rag');
}
function snapshotFile() { return path.join(snapshotDir(), 'graph.json'); }

/** LightRAG's default entity-type vocabulary (prompt.py). Order preserved. */
export const ENTITY_TYPES = [
  'Person', 'Creature', 'Organization', 'Location', 'Event', 'Concept', 'Method',
  'Content', 'Data', 'Artifact', 'NaturalObject', 'Other',
];

/** Error carrying a stable code, so callers branch on code, not message text. */
export class RagError extends Error {
  constructor(code, reason) {
    super(`${code}: ${reason}`);
    this.name = 'RagError';
    this.code = code;
    this.reason = reason;
  }
}

/* ------------------------------------------------------------------ *
 * Rule-based entity extraction
 * ------------------------------------------------------------------ */

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with',
  'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this',
  'that', 'these', 'those', 'we', 'you', 'they', 'he', 'she', 'i', 'not', 'no', 'so',
  'if', 'then', 'than', 'when', 'while', 'which', 'who', 'whom', 'can', 'will', 'may',
  'has', 'have', 'had', 'do', 'does', 'did', 'use', 'uses', 'used', 'also', 'into',
  'over', 'under', 'about', 'each', 'both', 'any', 'all', 'one', 'two', 'more', 'most',
]);

/** Domain lexicon — lowercase terms that are entities even when not capitalised. */
const LEXICON = [
  'retrieval augmented generation', 'knowledge graph', 'vector search', 'bm25',
  'lightrag', 'graphrag', 'graph rag', 'entity', 'relationship', 'embedding',
  'adjacency', 'traversal', 'retrieval', 'indexing', 'chunk', 'keyword', 'token',
  'prompt', 'workflow', 'memory', 'session', 'compression', 'observation', 'skill',
  'gate', 'forge', 'dispatch', 'n8n', 'obsidian', 'persistence', 'determinism',
];

const ACRONYM_RE = /\b[A-Z][A-Z0-9]{1,5}\b/g;
const QUOTED_RE = /"([^"\n]{2,60})"|'([^'\n]{2,60})'|`([^`\n]{2,60})`/g;
const CAP_SEQ_RE = /\b([A-Z][a-zA-Z0-9]*(?:[ -](?:of|the|and)?[ -]?[A-Z][a-zA-Z0-9]*){0,4})\b/g;

const TYPE_RULES = [
  ['Organization', /\b(inc|corp|corporation|ltd|llc|gmbh|company|university|institute|foundation|group|labs?|team|committee|council|department)\b/i],
  ['Location', /\b(city|country|region|province|state|county|river|mountain|island|street|avenue|road|building|campus|district|north|south|east|west)\b/i],
  ['Person', /\b(mr|mrs|ms|dr|prof|professor|sir|president|ceo|engineer|scientist|author)\b/i],
  ['Event', /\b(conference|summit|meeting|workshop|ceremony|festival|incident|launch|release|phase|sprint)\b/i],
  ['Data', /\b(dataset|data|statistics|stats|metrics|measurement|record|table|ledger|corpus|benchmark)\b/i],
  ['Method', /\b(algorithm|method|technique|procedure|pipeline|workflow|process|protocol|loop|strategy|pattern)\b/i],
  ['Artifact', /\b(server|tool|device|software|library|framework|database|api|cli|engine|system|platform|client|module|script|node)\b/i],
  ['Concept', /\b(ism|ity|ness|ency|ance|ence|tion|sion|ment|ology|theory|principle|idea|belief|policy|law|retrieval|search|graph|ranking|relevance|traversal)\b/i],
  ['Content', /\b(book|article|paper|report|document|film|movie|novel|story|guide|manual|spec|specification)\b/i],
  ['Creature', /\b(animal|bird|fish|dog|cat|horse|insect|species|creature)\b/i],
  ['NaturalObject', /\b(mineral|metal|compound|element|planet|star|moon|gas|liquid|stone)\b/i],
];

/** Canonical display form: trimmed, internal whitespace collapsed, no edge punctuation. */
export function normalizeName(name) {
  return String(name).replace(/\s+/g, ' ').replace(/^[^\w(\[]+|[^\w)\]]+$/g, '').trim();
}

export function entityKey(name) {
  return normalizeName(name).toLowerCase();
}

function isCandidate(name) {
  const n = normalizeName(name);
  if (n.length < 3 || n.length > 60) return false;
  if (/^\d+$/.test(n)) return false;
  if (STOP.has(n.toLowerCase())) return false;
  return true;
}

function classifyEntity(name, context) {
  const hay = `${name} ${context || ''}`;
  for (const [type, re] of TYPE_RULES) if (re.test(hay)) return type;
  if (/[A-Z]{2,}/.test(name) && name === name.toUpperCase()) return 'Organization';
  if (/^[A-Z]/.test(name)) return 'Concept';
  return 'Other';
}

/**
 * Extract candidate entity mentions from one document body.
 * Deterministic: the same text yields the same mentions in the same order.
 */
function mentionEntities(text) {
  const found = new Map(); // key -> display name
  const add = (raw) => {
    const name = normalizeName(raw);
    if (!isCandidate(name)) return;
    const key = entityKey(name);
    if (!found.has(key)) found.set(key, name);
  };

  let m;
  QUOTED_RE.lastIndex = 0;
  while ((m = QUOTED_RE.exec(text)) !== null) add(m[1] || m[2] || m[3]);

  ACRONYM_RE.lastIndex = 0;
  while ((m = ACRONYM_RE.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 3), m.index);
    if (!/(^|[.!?]\s+|\n)\s*$/.test(before)) add(m[0]);
  }

  CAP_SEQ_RE.lastIndex = 0;
  while ((m = CAP_SEQ_RE.exec(text)) !== null) {
    const seq = m[1];
    const words = seq.split(/[ -]/).filter(Boolean).filter((w) => !/^(of|the|and)$/i.test(w));
    // A lone capitalised word at sentence start is prose, not an entity.
    const atSentenceStart = new RegExp(`(^|[.!?]\\s+|\\n\\s*)${seq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
      .test(text.slice(0, m.index + seq.length));
    if (words.length === 1 && atSentenceStart) continue;
    add(seq);
  }

  const lower = text.toLowerCase();
  for (const term of LEXICON) {
    if (lower.includes(term)) add(term);
  }
  return [...found.values()];
}

/** Sentences, deterministically split. */
function sentences(text) {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

const RELATION_VERBS = [
  'uses', 'use', 'depends on', 'requires', 'require', 'implements', 'extends',
  'contains', 'produces', 'indexes', 'index', 'reads', 'writes', 'stores',
  'retrieves', 'complements', 'wraps', 'calls', 'builds', 'ranks',
];

function salientKeywords(sentence, limit = 5) {
  const words = sentence.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w));
  const seen = new Set();
  const out = [];
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= limit) break;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * GraphRag — a real adjacency graph
 * ------------------------------------------------------------------ */

export class GraphRag {
  constructor() {
    /** entityKey -> { id, key, name, type, description, sourceIds[], degree } */
    this.nodes = new Map();
    /** edgeId -> { id, source, target, type, keywords[], description, sourceIds[], weight } */
    this.edges = new Map();
    /** entityKey -> [{ edge, other, direction }] — the adjacency list */
    this.adjacency = new Map();
    this.documents = [];
    this.indexed = false;
  }

  /* ---------------- indexing ---------------- */

  /**
   * index(documents) -> { entities, relationships, docCount }
   *
   * documents: array of strings or { id?, text }. Throws RagError
   * E_INVALID_DOCUMENTS with a specific reason when the set cannot be indexed.
   */
  index(documents) {
    const docs = validateDocuments(documents);

    this.nodes.clear();
    this.edges.clear();
    this.adjacency.clear();
    this.documents = [];

    const perDoc = docs.map((doc, i) => {
      const text = doc.text;
      const mentions = mentionEntities(text);
      for (const name of mentions) {
        const key = entityKey(name);
        if (!this.nodes.has(key)) {
          this.nodes.set(key, {
            id: hashId(`entity|${key}`),
            key,
            name,
            type: classifyEntity(name, ''),
            description: '',
            sourceIds: [],
            degree: 0,
          });
        }
      }
      this.documents.push({ id: doc.id, index: i, text, entityKeys: mentions.map(entityKey) });
      return { index: i, id: doc.id, text, mentions };
    });

    // Descriptions and source ids, in document order (deterministic).
    for (const doc of perDoc) {
      for (const sentence of sentences(doc.text)) {
        for (const name of doc.mentions) {
          if (!sentence.toLowerCase().includes(name.toLowerCase())) continue;
          const node = this.nodes.get(entityKey(name));
          if (!node) continue;
          if (node.description.length < 400 && !node.description.includes(sentence)) {
            node.description = node.description ? `${node.description} ${sentence}` : sentence;
          }
          const sid = sourceId(doc.id, sentence);
          if (!node.sourceIds.includes(sid)) node.sourceIds.push(sid);
        }
      }
    }

    // Relationships: explicit verb patterns first, then intra-sentence co-occurrence.
    for (const doc of perDoc) {
      for (const sentence of sentences(doc.text)) {
        const present = doc.mentions.filter((n) => sentence.toLowerCase().includes(n.toLowerCase()));
        addExplicitRelations(this, sentence, present, doc);
        for (let i = 0; i < present.length; i += 1) {
          for (let j = i + 1; j < present.length; j += 1) {
            addEdge(this, present[i], present[j], 'co-occurs',
              salientKeywords(sentence, 3), sentence, doc.id);
          }
        }
      }
    }

    // Degrees from the adjacency list — recomputed, never incremented ad hoc.
    for (const [key, list] of this.adjacency) {
      const node = this.nodes.get(key);
      if (node) node.degree = list.length;
    }
    for (const edge of this.edges.values()) edge.weight = edge.sourceIds.length;

    this.indexed = true;
    this.writeSnapshot();
    return {
      entities: this.entityList(),
      relationships: this.relationshipList(),
      docCount: this.documents.length,
      extraction_mode: EXTRACTION_MODE,
      label: LLM_EXTRACTION_LABEL,
    };
  }

  /** Entities in a stable order: key, then name. */
  entityList() {
    return [...this.nodes.values()]
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((n) => ({ ...n }));
  }

  /** Relationships in a stable order: source, target, type. */
  relationshipList() {
    return [...this.edges.values()]
      .sort(cmpEdge)
      .map((e) => ({ ...e }));
  }

  /** The adjacency list itself — the graph structure, not a flat list. */
  adjacencyList() {
    return [...this.adjacency.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([key, list]) => [
        key,
        [...list].sort((a, b) => (a.other < b.other ? -1 : a.other > b.other ? 1 : 0))
          .map(({ edge, other, direction }) => ({
            to: other, edgeId: edge.id, relation: edge.type, direction,
          })),
      ]);
  }

  /* ---------------- querying ---------------- */

  /**
   * query(question, { topK, depth }) -> { results, graphPath }
   *
   * Seeds on entities whose name matches the question, walks the adjacency
   * list outward (BFS, deterministic order), and returns the reached
   * documents together with the entity chain that justified each result.
   *
   * `requireTraversal` (default true) is what makes this a GRAPH query rather
   * than a keyword lookup: a seed entity that directly owns matching documents
   * is not itself an answer — the answer is reached by expanding THROUGH the
   * graph (LightRAG's `_get_node_data` expands every matched entity to its
   * related edges before building context). Set it false for naive local mode.
   */
  query(question, { topK = 5, depth = 2, requireTraversal = true } = {}) {
    if (!this.indexed || this.nodes.size === 0) {
      throw new RagError('E_NOT_INDEXED', 'no graph in memory and no snapshot loaded — call index() or load() first');
    }
    const q = String(question ?? '');
    if (!q.trim()) throw new RagError('E_INVALID_QUERY', 'question is empty');

    const qTokens = new Set(q.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));

    // 1) seed scoring — integer, deterministic
    const seeds = [];
    for (const node of this.nodes.values()) {
      const nameTokens = node.name.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
      const exact = q.toLowerCase().includes(node.name.toLowerCase()) ? 10 : 0;
      let hits = 0;
      for (const t of nameTokens) if (qTokens.has(t)) hits += 1;
      const score = exact + 3 * hits;
      if (score > 0) seeds.push({ key: node.key, score });
    }
    seeds.sort((a, b) => (b.score - a.score) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    if (seeds.length === 0) {
      return { results: [], graphPath: [], seeds: [], matched_entities: 0,
        extraction_mode: EXTRACTION_MODE, label: LLM_EXTRACTION_LABEL };
    }

    // 2) BFS over the adjacency list — records a real path per reached entity.
    //    Seeds themselves are NOT candidates when requireTraversal is set.
    const best = new Map(); // key -> { path, score, hops }
    const seedKeys = new Set(seeds.map((s) => s.key));
    const queue = [];
    for (const s of seeds) {
      best.set(s.key, { path: [{ from: null, relation: null, to: s.key, score: s.score }], score: s.score, hops: 0 });
      queue.push(s.key);
    }
    while (queue.length) {
      const key = queue.shift();
      const cur = best.get(key);
      if (cur.hops >= depth) continue;
      for (const step of this.adjacency.get(key) || []) {
        const nextScore = cur.score - 1; // each hop costs relevance
        const next = best.get(step.other);
        if (next && next.score >= nextScore) continue;
        best.set(step.other, {
          path: [...cur.path, { from: key, relation: step.relation, to: step.other, score: nextScore }],
          score: nextScore,
          hops: cur.hops + 1,
        });
        queue.push(step.other);
      }
    }

    // 3) documents reached by the walk, ranked by the best entity score they carry.
    const candidates = [...best.entries()].filter(([key, info]) => !(requireTraversal && info.hops === 0 && seedKeys.has(key)));
    const docScores = new Map();
    for (const [key, info] of candidates) {
      for (const doc of this.documents) {
        if (!doc.entityKeys.includes(key)) continue;
        const prev = docScores.get(doc.index);
        if (!prev || info.score > prev.score) {
          docScores.set(doc.index, { score: info.score, via: key, path: info.path });
        }
      }
    }

    const results = [...docScores.entries()]
      .sort((a, b) => (b[1].score - a[1].score) || (a[0] - b[0]))
      .slice(0, topK)
      .map(([index, info]) => {
        const doc = this.documents[index];
        const node = this.nodes.get(info.via);
        return {
          docId: doc.id,
          docIndex: index,
          score: info.score,
          matchedEntity: node ? node.name : info.via,
          entityType: node ? node.type : null,
          text: doc.text,
          via: info.path.map((p) => p.to),
        };
      });

    // graphPath: the chains that justified the results, best path first.
    // A chain always starts at a query seed and ends at the entity that
    // reached the document, so the caller sees why the document was returned.
    const seen = new Set();
    const graphPath = [];
    for (const r of results) {
      const key = r.via.join('>');
      if (seen.has(key)) continue;
      seen.add(key);
      const steps = [];
      for (let i = 1; i < r.via.length; i += 1) {
        const from = r.via[i - 1];
        const to = r.via[i];
        const step = (this.adjacency.get(from) || []).find((s) => s.other === to);
        steps.push({
          from: this.nodes.get(from)?.name ?? from,
          relation: step ? step.relation : 'related',
          to: this.nodes.get(to)?.name ?? to,
        });
      }
      graphPath.push({
        result: r.docId,
        hops: steps.length,
        seed: r.via[0],
        path: steps,
      });
    }

    return {
      results,
      graphPath,
      seeds: seeds.map((s) => ({ entity: this.nodes.get(s.key)?.name ?? s.key, score: s.score })),
      matched_entities: best.size,
      extraction_mode: EXTRACTION_MODE,
      label: LLM_EXTRACTION_LABEL,
    };
  }

  /* ---------------- persistence ---------------- */

  writeSnapshot() {
    const dir = snapshotDir();
    fs.mkdirSync(dir, { recursive: true });
    const payload = {
      kind: 'jexi.rag.graph-snapshot',
      version: 1,
      extraction_mode: EXTRACTION_MODE,
      label: LLM_EXTRACTION_LABEL,
      nodes: this.entityList(),
      edges: this.relationshipList(),
      documents: this.documents,
    };
    const file = snapshotFile();
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.renameSync(tmp, file); // atomic — a SIGKILL mid-write cannot truncate it
    return { file, bytes: fs.statSync(file).size, nodes: payload.nodes.length, edges: payload.edges.length };
  }

  /** load() -> true if a snapshot was loaded, false if none exists. */
  load() {
    const file = snapshotFile();
    if (!fs.existsSync(file)) return false;
    let payload;
    try { payload = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return false; }
    if (!payload || payload.kind !== 'jexi.rag.graph-snapshot') return false;

    this.nodes.clear();
    this.edges.clear();
    this.adjacency.clear();
    for (const n of payload.nodes || []) this.nodes.set(n.key, { ...n });
    for (const e of payload.edges || []) this.edges.set(e.id, { ...e });
    this.documents = payload.documents || [];
    for (const e of this.edges.values()) {
      link(this, e.source, e.target, e, 'out');
      link(this, e.target, e.source, e, 'in');
    }
    this.indexed = this.nodes.size > 0;
    return this.indexed;
  }

  /** Snapshot path, for probes and diagnostics. */
  snapshotPath() { return snapshotFile(); }
}

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function hashId(s) {
  return createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
}

function sourceId(docId, sentence) {
  return `doc:${docId}:s${hashId(sentence).slice(0, 8)}`;
}

function link(graph, key, other, edge, direction) {
  if (!graph.adjacency.has(key)) graph.adjacency.set(key, []);
  graph.adjacency.get(key).push({ edge, other, direction });
}

function edgeKeyOf(a, b, type) {
  const [x, y] = [entityKey(a), entityKey(b)].sort();
  return `${x}~${y}~${type}`;
}

function cmpEdge(a, b) {
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  if (a.target !== b.target) return a.target < b.target ? -1 : 1;
  if (a.type !== b.type) return a.type < b.type ? -1 : 1;
  return 0;
}

function addEdge(graph, a, b, type, keywords, sentence, docId) {
  const ka = entityKey(a);
  const kb = entityKey(b);
  if (ka === kb) return;
  if (!graph.nodes.has(ka) || !graph.nodes.has(kb)) return;
  const id = hashId(edgeKeyOf(ka, kb, type));
  let edge = graph.edges.get(id);
  if (!edge) {
    const [source, target] = ka < kb ? [ka, kb] : [kb, ka];
    edge = { id, source, target, type, keywords: [], description: '', sourceIds: [], weight: 0 };
    graph.edges.set(id, edge);
    link(graph, source, target, edge, 'out');
    link(graph, target, source, edge, 'in');
  }
  for (const k of keywords) if (!edge.keywords.includes(k)) edge.keywords.push(k);
  edge.keywords.sort();
  const sid = sourceId(docId, sentence);
  if (!edge.sourceIds.includes(sid)) edge.sourceIds.push(sid);
  if (edge.description.length < 300 && !edge.description.includes(sentence)) {
    edge.description = edge.description ? `${edge.description} ${sentence}` : sentence;
  }
}

/** Explicit "<A> <verb> <B>" patterns — the relation carries the verb as keyword. */
function addExplicitRelations(graph, sentence, present, doc) {
  for (const verb of RELATION_VERBS) {
    const re = new RegExp(`\\b(.+?)\\s+${verb.replace(/ /g, '\\s+')}\\s+(.+)$`, 'i');
    const m = re.exec(sentence);
    if (!m) continue;
    const left = present.filter((n) => m[1].toLowerCase().includes(n.toLowerCase()));
    const right = present.filter((n) => m[2].toLowerCase().includes(n.toLowerCase()));
    for (const l of left) {
      for (const r of right) {
        if (entityKey(l) === entityKey(r)) continue;
        addEdge(graph, l, r, verb.replace(/ /g, '-'), [verb.replace(/ /g, '-')], sentence, doc.id);
      }
    }
  }
}

/** Validation with a specific reason per failure mode. */
export function validateDocuments(documents) {
  if (!Array.isArray(documents)) {
    throw new RagError('E_INVALID_DOCUMENTS', `expected an array of documents, received ${typeof documents}`);
  }
  if (documents.length === 0) {
    throw new RagError('E_INVALID_DOCUMENTS', 'document set is empty (0 documents) — nothing to index');
  }
  const out = [];
  const seenIds = new Set();
  documents.forEach((raw, i) => {
    let id;
    let text;
    if (typeof raw === 'string') {
      id = `doc-${i}`;
      text = raw;
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      if (raw.text === undefined || raw.text === null) {
        throw new RagError('E_INVALID_DOCUMENTS', `document[${i}] has no "text" field`);
      }
      id = raw.id === undefined || raw.id === null ? `doc-${i}` : String(raw.id);
      text = raw.text;
    } else {
      throw new RagError('E_INVALID_DOCUMENTS', `document[${i}] is neither a string nor an object (received ${Array.isArray(raw) ? 'array' : typeof raw})`);
    }
    if (typeof text !== 'string') {
      throw new RagError('E_INVALID_DOCUMENTS', `document[${i}] ("${id}") "text" is ${typeof text}, expected string`);
    }
    if (!text.trim()) {
      throw new RagError('E_INVALID_DOCUMENTS', `document[${i}] ("${id}") is empty or whitespace-only`);
    }
    if (seenIds.has(id)) {
      throw new RagError('E_INVALID_DOCUMENTS', `duplicate document id "${id}" at index ${i}`);
    }
    seenIds.add(id);
    out.push({ id, text });
  });
  return out;
}

export default GraphRag;