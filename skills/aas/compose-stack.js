/**
 * JEXI OS — AAS CORE — compose-stack.js
 *
 * Validates an agent's skill selection against the local catalog:
 *   UNKNOWN_ID          — id not in catalog
 *   DESCRIPTION_OVERLAP — two selected skills describe the same capability
 *                         (cosine similarity of description token vectors
 *                          >= OVERLAP_THRESHOLD 0.85 — same threshold the
 *                          AAS curator uses for dedupe)
 *   BUDGET_EXCEEDED     — descriptions total over DESCRIPTION_BUDGET_CHARS
 *
 * Export: compose(ids) → Promise<{ valid, errors:[{code,id,reason}], stack }>
 */
import { get, list } from './catalog.js';

export const OVERLAP_THRESHOLD = 0.85;
export const DESCRIPTION_BUDGET_CHARS = Number(process.env.JEXI_AAS_BUDGET || 1200);

export function tokenize(text) {
  return String(text).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
}

export function cosineSimilarity(aText, bText) {
  const a = tokenize(aText), b = tokenize(bText);
  if (!a.length || !b.length) return 0;
  const tf = (tokens) => {
    const m = new Map();
    for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
    return m;
  };
  const fa = tf(a), fb = tf(b);
  let dot = 0, na = 0, nb = 0;
  for (const [, v] of fa) na += v * v;
  for (const [, v] of fb) nb += v * v;
  for (const [t, v] of fa) { const w = fb.get(t); if (w) dot += v * w; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export async function compose(ids) {
  const errors = [];
  const wanted = Array.isArray(ids) ? ids : [];
  const resolved = [];
  const seen = new Map(); // id → count (duplicate selections are overlaps: cosine(x,x)=1.0)

  for (const id of wanted) {
    const skill = get(id);
    if (!skill) {
      errors.push({ code: 'UNKNOWN_ID', id: String(id), reason: `'${id}' is not in the local catalog (${list().length} skills known)` });
      continue;
    }
    seen.set(id, (seen.get(id) || 0) + 1);
    if (seen.get(id) === 2) {
      errors.push({
        code: 'DESCRIPTION_OVERLAP',
        id: `${id}+${id}`,
        reason: `'${id}' selected twice — identical descriptions are 100% similar (>= ${Math.round(OVERLAP_THRESHOLD * 100)}%); select each skill once`,
      });
      continue; // second copy never enters the stack — no duplicate-resolution below
    }
    resolved.push(skill);
  }

  for (let i = 0; i < resolved.length; i += 1) {
    for (let j = i + 1; j < resolved.length; j += 1) {
      const sim = cosineSimilarity(resolved[i].description, resolved[j].description);
      if (sim >= OVERLAP_THRESHOLD) {
        errors.push({
          code: 'DESCRIPTION_OVERLAP',
          id: `${resolved[i].id}+${resolved[j].id}`,
          reason: `descriptions are ${Math.round(sim * 100)}% similar (>= ${Math.round(OVERLAP_THRESHOLD * 100)}%): '${resolved[i].id}' and '${resolved[j].id}' describe the same capability — select one`,
        });
      }
    }
  }

  const totalChars = resolved.reduce((n, s) => n + s.description.length, 0);
  if (totalChars > DESCRIPTION_BUDGET_CHARS) {
    errors.push({
      code: 'BUDGET_EXCEEDED',
      id: '<stack>',
      reason: `descriptions total ${totalChars} chars > budget ${DESCRIPTION_BUDGET_CHARS} — drop or trim skills to fit the context budget`,
    });
  }

  const valid = errors.length === 0;
  return {
    valid,
    errors,
    stack: valid ? {
      ids: resolved.map((s) => s.id),
      skills: resolved.map(({ id, name, description, whenToUse, path }) => ({ id, name, description, whenToUse, path })),
      totalDescriptionChars: totalChars,
      budget: DESCRIPTION_BUDGET_CHARS,
      overlapThreshold: OVERLAP_THRESHOLD,
      composedAt: new Date().toISOString(),
    } : null,
  };
}

export default { compose, cosineSimilarity, OVERLAP_THRESHOLD, DESCRIPTION_BUDGET_CHARS };
