/**
 * JEXI OS — Phase 17 Scope E — CONTEXT FILESYSTEM / LAYERS.
 *
 * Progressive disclosure: judge relevance BEFORE paying for details.
 *
 *   load(uri, question) —
 *     1. read L0 (always cheap, ~1 sentence)
 *     2. if L0 answers the question → stop, report tier + tokens
 *     3. else read L1 (core info) → stop if it answers
 *     4. else read L2 (full content) — last resort
 *
 * The judge is DETERMINISTIC keyword coverage: tokenize the question (drop
 * stopwords), a tier "answers" when every keyword occurs in that tier's
 * content. Labeled: `keyword-coverage (deterministic) — LLM relevance
 * judgment NOT VERIFIED`. Swap in a model judge later via `options.judge` —
 * the tier ladder stays identical.
 *
 * `tokensUsed` counts every tier actually read on the way to the answer —
 * the honest cost of progressive disclosure.
 */

import { parseUri } from './uri.js';

export const KEYWORD_JUDGE_LABEL = 'keyword-coverage (deterministic) — LLM relevance judgment NOT VERIFIED';

const STOPWORDS = new Set(('a an and are as at be by do does for from how i in is it its of on or that the ' +
  'this to was what when where which who why will with').split(' '));

export function questionKeywords(question) {
  return [...new Set(String(question || '').toLowerCase().match(/[a-z0-9_]+/g) || [])]
    .filter((t) => !STOPWORDS.has(t) && t.length > 1);
}

export function coverage(keywords, content) {
  if (!keywords.length) return { covered: 1, missing: [] };
  const hay = new Set(String(content || '').toLowerCase().match(/[a-z0-9_]+/g) || []);
  const missing = keywords.filter((k) => !hay.has(k));
  return { covered: (keywords.length - missing.length) / keywords.length, missing };
}

/**
 * Build a layer loader over a VikingFs.
 * @param {import('./filesystem.js').VikingFs} vfs
 * @param {object} [o]  { judge: ({question, keywords, content}) => boolean }
 */
export function createLoader(vfs, o = {}) {
  const judge = o.judge || (({ keywords, content }) => coverage(keywords, content).missing.length === 0);

  /**
   * @param {string} uri       viking:// URI (file or directory)
   * @param {string} question  what the caller wants to know
   * @returns {Promise<{uri, tier, content, tokens, tokensUsed, keywords,
   *                    coverage, ladder: Array<{tier, tokens, answered}>, judge}>}
   */
  async function load(uri, question, { minTier = null } = {}) {
    parseUri(uri); // validate early
    const keywords = questionKeywords(question);
    const order = minTier ? ['L0', 'L1', 'L2'].filter((t) => t >= minTier) : ['L0', 'L1', 'L2'];
    const ladder = [];
    let tokensUsed = 0;

    for (let i = 0; i < order.length; i++) {
      const tier = order[i];
      let r;
      try {
        r = vfs.read(uri, { tier });
      } catch (e) {
        if (e.code === 'E_NO_TIER') { ladder.push({ tier, tokens: 0, answered: false, note: 'tier not present' }); continue; }
        throw e;
      }
      tokensUsed += r.tokens;
      const answered = i === order.length - 1 ? true : judge({ question, keywords, content: r.content });
      const cov = coverage(keywords, r.content);
      ladder.push({ tier, tokens: r.tokens, answered, coverage: cov.covered, missing: cov.missing });
      if (answered) {
        return {
          uri: String(uri),
          tier,
          content: r.content,
          tokens: r.tokens,
          tokensUsed,
          keywords,
          ladder,
          judge: o.judge ? 'injected judge' : KEYWORD_JUDGE_LABEL,
        };
      }
    }
    /* c8 ignore-next: the loop's last tier always answers */
    throw Object.assign(new Error(`load: no tier answered for ${uri}`), { code: 'E_NO_TIER_ANSWERED' });
  }

  return { load, judgeLabel: o.judge ? 'injected judge' : KEYWORD_JUDGE_LABEL };
}

export default { createLoader, questionKeywords, coverage, KEYWORD_JUDGE_LABEL };
