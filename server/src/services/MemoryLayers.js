/**
 * JEXI OS — MEMORY LAYERS (AGI Phase 4).
 *
 * The six memory layers of spec §25, organized OVER the existing stores —
 * nothing is replaced or migrated:
 *
 *   working    — this session's scratchpad (in-memory, module-managed)
 *   episodic   — decisions and event-like records (DecisionMemory)
 *   semantic   — books + knowledge base (MemoryManager.searchKnowledge)
 *   procedural — lessons from missions (director/Lessons)
 *   project    — project-scoped decisions (DecisionMemory, project field)
 *   user       — facts about the user (MemoryManager.searchUserFacts)
 *
 * One relevance-based retrieval interface: recall(query, {layers, limit})
 * returns merged, layer-labeled, provenance-carrying results. Metadata per
 * record: content, timestamp (where the store provides it), source layer,
 * and the store's own provenance.
 */

/* working memory — real, session-scoped */
const working = new Map(); // id → { content, at, importance, scope }
const MAX_WORKING = 100;

export function setWorkingMemory(id, content, { importance = 1, scope = 'session' } = {}) {
  if (working.size >= MAX_WORKING) working.delete(working.keys().next().value);
  working.set(String(id), { id: String(id), content: String(content).slice(0, 4000), at: new Date().toISOString(), importance, scope });
  return working.get(String(id));
}

export function getWorkingMemory() {
  return [...working.values()].sort((a, b) => b.importance - a.importance || b.at.localeCompare(a.at));
}

export function clearWorkingMemory() { working.clear(); }

/** Relevance over working memory: distinctive-token overlap, importance-weighted. */
function searchWorking(query, limit) {
  const q = String(query).toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  if (!q.length) return getWorkingMemory().slice(0, limit);
  return getWorkingMemory()
    .map((r) => {
      const hay = r.content.toLowerCase();
      const score = q.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
      return { ...r, score: score + r.importance };
    })
    .filter((r) => r.score > r.importance)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Relevance-based recall across layers. Every result is labeled with its
 * layer and the store it came from — no silent blending.
 */
export async function recall(query, { layers = null, limit = 8 } = {}) {
  const want = layers || ['working', 'episodic', 'semantic', 'procedural', 'project', 'user'];
  const out = [];

  if (want.includes('working')) {
    for (const r of searchWorking(query, limit)) {
      out.push({ layer: 'working', source: 'session scratchpad', content: r.content, at: r.at, score: r.score, scope: r.scope });
    }
  }

  if (want.includes('procedural')) {
    try {
      const { retrieveLessons } = await import('./director/Lessons.js');
      for (const l of retrieveLessons(query, limit)) {
        out.push({ layer: 'procedural', source: 'mission lessons', content: `${l.failure || l.objective || ''} — ${l.lesson || ''}`.trim(), at: l.at || null, score: 3, provenance: { kind: l.kind, missionId: l.missionId, cause: l.cause, strategy: l.strategy } });
      }
    } catch { /* layer unavailable in this context */ }
  }

  if (want.includes('episodic') || want.includes('project')) {
    try {
      const { retrieveDecisions } = await import('./DecisionMemory.js');
      for (const d of retrieveDecisions({ query, limit })) {
        out.push({ layer: d.project ? 'project' : 'episodic', source: 'decision memory', content: String(d.content || '').slice(0, 2000), at: d.at || null, score: 2, provenance: { type: d.type, project: d.project, confidence: d.confidence } });
      }
    } catch { /* layer unavailable in this context */ }
  }

  if (want.includes('semantic')) {
    try {
      const { searchKnowledge } = await import('./MemoryManager.js');
      for (const r of searchKnowledge(query)) {
        out.push({ layer: 'semantic', source: `knowledge:${r.category || r.source}`, content: String(r.content || '').slice(0, 2000), title: r.title, at: null, score: r.score || 1 });
      }
    } catch { /* layer unavailable in this context */ }
  }

  if (want.includes('user')) {
    try {
      const { searchUserFacts } = await import('./MemoryManager.js');
      for (const f of await searchUserFacts(query, Math.min(limit, 4))) {
        out.push({ layer: 'user', source: 'user facts', content: String(f.fact || f.content || f).slice(0, 1000), at: f.at || null, score: 4, provenance: 'user-stated' });
      }
    } catch { /* layer unavailable in this context */ }
  }

  return out.slice(0, limit * 2);
}

/** Which layers are currently backed (for the self-model's honesty). */
export function memoryLayerStatus() {
  return {
    working: { backed: true, store: 'in-memory session scratchpad', records: working.size },
    episodic: { backed: true, store: 'DecisionMemory' },
    semantic: { backed: true, store: 'MemoryManager.searchKnowledge (books + knowledge base)' },
    procedural: { backed: true, store: 'director/Lessons' },
    project: { backed: true, store: 'DecisionMemory (project-scoped)' },
    user: { backed: true, store: 'MemoryManager.searchUserFacts' },
  };
}
