/**
 * JEXI OS — PHASE 13 SCOPE A — CAPABILITY INFERENCE.
 *
 * The roster spans 400+ agents across 18 divisions, but the source corpora
 * (JEXI's agents/ tree, the vendored agency-agents catalog) declare prose
 * roles, not capability tokens. Inference maps a spec's own words onto the
 * controlled vocabulary in agent-spec.js.
 *
 * It is deterministic and local: same input -> same tokens, no model call, no
 * network, no randomness. Ordered rules — the first match wins — so a label is
 * reproducible across runs and machines. This is a VOCABULARY MAP, not task
 * scripting: it never reads a user request.
 */

import { CAPABILITIES } from './agent-spec.js';

const CAP_SET = new Set(CAPABILITIES);

/** Ordered keyword rules. First matching rule contributes its tokens. */
const RULES = [
  [/threat|pentest|penetration|exploit|vulnerab|vuln\b|malware|phish|ransom|forensic|incident response|red team|blue team|soc\b|attack|recon|firewall|crypto|encrypt|auth\b|oauth|iam\b|zero.trust|compliance|audit/i, ['security', 'verification']],
  [/test|qa\b|quality|fuzz|chaos|e2e|end.to.end|regression|coverage|verifier|verification/i, ['verification', 'code']],
  [/data engineer|analytics|database|sql\b|etl\b|pipeline|warehouse|dataset|statistic|machine learning|ml\b|mle\b|rag\b|embedding|vector/i, ['data', 'analytics']],
  [/research|investigat|synthes|fact.check|source|competitiv|market research|literature|scientific|discovery/i, ['research', 'synthesis', 'search']],
  [/design|ux\b|ui\b|brand|accessib|typograph|visual|wireframe|prototyp|diagram/i, ['design']],
  [/devops|sre\b|platform|infrastructure|kubernetes|docker|terraform|cloud|deploy|release|observability|monitoring|on.call/i, ['infrastructure', 'automation']],
  [/architect|engineer|developer|programmer|coder|reviewer|refactor|debug|compiler|backend|frontend|full.stack|api design|software/i, ['code', 'planning']],
  [/product manager|roadmap|prd\b|prioriti|discovery|backlog|stakeholder|product owner/i, ['product', 'planning']],
  [/market|seo|growth|content|copywrit|editor|writer|writing|story|social media|campaign|brand voice/i, ['marketing', 'synthesis']],
  [/sales|revenue|business develop|account|finance|financial|invest|budget|pricing|forecast|accounting/i, ['finance', 'analytics']],
  [/legal|privacy|gdpr|contract|policy|regulat|licens/i, ['compliance', 'verification']],
  [/integr|webhook|third.party|api\b|connector|middleware|interoperab/i, ['integration', 'code']],
  [/translat|locali|i18n|l10n|cultural|language|linguist/i, ['language']],
  [/teach|tutor|curricul|learn|pedagog|instruct|mentor|training/i, ['teaching', 'synthesis']],
  [/automat|workflow|schedul|trigger|orchestrat|integration flow/i, ['automation', 'integration']],
  [/voice|speech|audio|narration|tts\b|asr\b|acoustic|conversation design|phonetic/i, ['media', 'design']],
  [/chart|dashboard|visualiz|graphic|infographic|plot|graph\b/i, ['analytics', 'design']],
  [/memory|knowledge|curator|retrieval|context|recall|archive|taxonom/i, ['memory', 'synthesis']],
  [/computer|browser|desktop|automation agent|operator|gui|screen/i, ['computer', 'automation']],
  [/support|customer success|helpdesk|troubleshoot|onboarding|service desk/i, ['support', 'synthesis']],
  [/search|retriev|index|crawl|scrap/i, ['search']],
  [/planner|planning|decompos|strategy|strateg|roadmap|coordinat/i, ['planning', 'reasoning']],
  [/research|analysis|analy|evaluate|assess|reason|judg|critique/i, ['reasoning', 'analytics']],
];

/** Division fallbacks, used when no rule matches or to top up an empty set. */
const DIVISION_DEFAULTS = {
  automation: ['automation'],
  business: ['finance', 'analytics'],
  content: ['marketing', 'synthesis'],
  data: ['data'],
  design: ['design'],
  engineering: ['code'],
  integration: ['integration'],
  learning: ['teaching'],
  legal: ['compliance'],
  localization: ['language'],
  meta: ['reasoning'],
  ops: ['infrastructure'],
  product: ['product'],
  research: ['research'],
  security: ['security'],
  testing: ['verification'],
  visualization: ['analytics'],
  voice: ['media'],
};

/**
 * Infer capability tokens for an agent from its own metadata.
 *
 *   inferCapabilities({ division, role, name, description }) -> string[]
 *
 * Always returns at least one token, sorted and de-duplicated, in a stable
 * order so two runs on the same input produce identical arrays.
 */
export function inferCapabilities(input = {}, { max = 4 } = {}) {
  const hay = [input.name, input.role, input.description, input.id]
    .filter(Boolean).join(' ');

  const hits = [];
  for (const [re, caps] of RULES) {
    if (re.test(hay)) {
      for (const c of caps) if (!hits.includes(c)) hits.push(c);
    }
    if (hits.length >= max) break;
  }

  if (hits.length === 0) {
    const fallback = DIVISION_DEFAULTS[input.division] || ['reasoning'];
    for (const c of fallback) if (!hits.includes(c)) hits.push(c);
  }

  return hits.filter((c) => CAP_SET.has(c)).sort();
}