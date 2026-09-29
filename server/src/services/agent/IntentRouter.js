/**
 * Per-intent budgets.
 *
 * One flat pair of constants made every turn pay for the most expensive kind
 * of turn. A research question and a refactor need very different room, and
 * the budget is the main thing standing between a confused model and a
 * runaway one — so it is derived from the intent here, in one place, where it
 * can be read and tested.
 */
import { isCodingIntent } from './CodingLoop.js';

export const INTENT_BUDGETS = {
  code:     { iterations: 16, toolCalls: 40, verifyRounds: 5 },
  coding:   { iterations: 16, toolCalls: 40, verifyRounds: 5 },
  debug:    { iterations: 14, toolCalls: 36, verifyRounds: 5 },
  research: { iterations: 10, toolCalls: 20, verifyRounds: 3 },
  default:  { iterations: 8,  toolCalls: 14, verifyRounds: 2 },
  direct:   { iterations: 3,  toolCalls: 4,  verifyRounds: 1 },
};

export function budgetForIntent(intent, query = '') {
  const key = String(intent || '').toLowerCase();
  if (INTENT_BUDGETS[key]) return INTENT_BUDGETS[key];
  return isCodingIntent({ intent: key }, query) ? INTENT_BUDGETS.code : INTENT_BUDGETS.default;
}

/**
 * The skill whose `whenToUse` best matches a coding query, if any.
 *
 * Returns the catalog entry — including its `allowedTools` — so the caller can
 * narrow the offered tool set to what the skill actually declared.
 */
export async function activeCodingSkill(query) {
  let index = {};
  try {
    const { catalog } = await import('../../skills/catalog.js');
    index = await catalog();
  } catch {
    return null;   // no skills installed is not an error
  }
  const q = String(query || '').toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const meta of Object.values(index)) {
    const w = String(meta?.whenToUse || '').toLowerCase();
    if (!w || !meta?.allowedTools?.length) continue;
    const terms = w.split(/[^a-z0-9]+/).filter((t) => t.length > 3);
    let score = terms.reduce((n, t) => n + (q.includes(t) ? 1 : 0), 0);
    if (/(pytest|unittest|tox|failing test|make .* pass)/.test(q) && /pytest|unittest|tox|test/.test(w)) score += 2;
    if (score > bestScore) { bestScore = score; best = meta; }
  }
  return bestScore > 0 ? best : null;
}

export { isCodingIntent };
