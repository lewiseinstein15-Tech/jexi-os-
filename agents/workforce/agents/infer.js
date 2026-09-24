/**
 * JEXI OS — PHASE 13 SCOPE A — DIVISION INFERENCE.
 *
 * Only JEXI's canonical `agents/**\/*.agent.md` files declare a `division:` in
 * frontmatter. The other roster sources — server agent contracts, plugin
 * contributions, SOUL profiles, runtime employees — predate the roster and
 * carry no division, so one is inferred from the agent's own id and name.
 *
 * Deterministic and local: ordered rules, first match wins. The rule list is
 * a mapping table over names, not a task router — it never sees a user request.
 */

import { inferCapabilities } from './capabilities.js';

/** Ordered [pattern, division] pairs. First match wins. */
const RULES = [
  [/threat|pentest|penetration|exploit|vuln|recon|phish|crypto|auth|security|firewall|malware|forensic|soc\b|redteam|red-team|ad-operator|wireless|mobile-oper|ssrf|xss|injection|detector|scanner|hunter|auditor/i, 'security'],
  [/test|qa\b|fuzz|chaos|e2e|verif|coverage/i, 'testing'],
  [/design|ux\b|ui\b|brand|accessib|diagram|visual-designer|wireframe/i, 'design'],
  [/analytic|database|data-|datascience|data\b|sql|etl|warehouse|mle\b|rag-|dataset|mle-/i, 'data'],
  [/research|analyst|synthes|fact-check|competitive|market-research|reverser|user-research|researcher/i, 'research'],
  [/devops|sre\b|platform|release|incident|deploy|ops\b|infra/i, 'ops'],
  [/product|roadmap|prd\b|pm\b/i, 'product'],
  [/content|writer|writing|copy|editor|story|marketing|seo|strategy/i, 'content'],
  [/voice|speech|audio|narration|conversation|acoustic/i, 'voice'],
  [/chart|dashboard|graph|visuali|viz\b/i, 'visualization'],
  [/i18n|l10n|locali|translat|language/i, 'localization'],
  [/legal|privacy|compliance|contract|policy|licens/i, 'legal'],
  [/api\b|integration|webhook|connector|gateway/i, 'integration'],
  [/learn|tutor|curricul|skill-curator|teaching|mentor|education/i, 'learning'],
  [/workflow|automation|automat|schedul|trigger|orchestrat/i, 'automation'],
  [/engineer|architect|developer|programmer|coder|reviewer|refactor|debug|builder|operator|shipper|planner|reflector|memory|email|github/i, 'engineering'],
  [/business|finance|financial|sales|revenue|growth|account|invest/i, 'business'],
];

/** Infer one of JEXI's 18 division ids from an agent's id and name. */
export function inferDivision(id, name) {
  const hay = `${id || ''} ${name || ''}`;
  for (const [re, division] of RULES) if (re.test(hay)) return division;
  return 'engineering';
}

/**
 * Infer the trust tier an agent starts at, by origin. Nothing in the roster has
 * a verified action history at load time, so this is a provenance statement:
 * JEXI's own files start `trusted`, everything imported starts `provisional`.
 */
export function initialTrustLevel(origin) {
  switch (origin) {
    case 'jexi-canonical':
    case 'jexi-coworker':
      return 'trusted';
    case 'server-contract':
    case 'runtime-employee':
    case 'soul-profile':
      return 'provisional';
    case 'plugin':
      return 'provisional';
    case 'agency-agents':
      return 'provisional';
    default:
      return 'provisional';
  }
}

export { inferCapabilities };