/**
 * ARENA ASTRA REBUILD — Intent Engine (spec Part 5).
 *
 * Deterministic-first classification of what Lewis wants. Zero model calls.
 * Semantic reasoning is used ONLY when the deterministic gate abstains AND
 * the caller explicitly opts into it (callers pass `allowSemantic: true`
 * plus a reasoner function — the engine itself never imports an LLM).
 *
 * Categories:
 *   conversation | question | research | coding | debugging | file_op |
 *   browser_op | computer_op | creative | document | data | market |
 *   mission (multi-step) | schedule | memory | system
 *
 * Each result: { intent, confidence: 'high'|'medium'|'low', route,
 *   capabilities[], leanOk (one-call answer safe?), reason }
 *
 * route: 'fast' (JexiKernel zero/one-call) | 'lean' (one budget-capped call)
 *        | 'director' (full mission machinery) | 'mission' (explicit mission lane)
 */

const LEAN_BLOCKER_RE = /(build|create|make|write|generate|develop|deploy|publish|research|analy[sz]e|design|implement|install|set ?up|fix|debug|refactor|scrape|download|convert|translate|summari[sz]e|draft|plan|mission|project|app|website|web ?app|repo|repository|code|file|folder|directory|workspace|http|https|www\.|\.com|youtube|video|image|photo|picture|screenshot)/i;
const QUESTION_STARTER_RE = /^(what|who|when|where|which|why|whose|is|are|was|were|will|would|can|could|does|do|did|has|have|should|how many|how much|how long|how far|how old|how do i|how does|how to|tell me about|define|explain)\b/i;

const RULES = [
  // explicit system / memory commands first (highest precision)
  { intent: 'system', re: /^\s*\/(agents|workspace|refine|watch|guard|help|status|health|models|skills|tasks|goals|plugins|mcp)\b/i, route: 'fast', capabilities: [], reason: 'slash-command' },
  { intent: 'memory', re: /remember (this|that|my)|save (this |that )?(to |in )?(my )?memory|my projects?\b|continue my project|project .* is done|what do you (remember|know) about me/i, route: 'director', capabilities: ['memory'], reason: 'project-memory phrase' },
  { intent: 'schedule', re: /every (morning|day|night|evening|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|at \d{1,2}(:\d{2})?\s?(am|pm)|remind me|schedule (this|a|an)/i, route: 'director', capabilities: ['scheduling'], reason: 'natural-language schedule' },
  // market lane (external JEXI Market capability)
  { intent: 'market', re: /market (analysis|outlook|update)|stock|forex|nasdaq|s&p|dow jones|portfolio|crypto|bitcoin|eth\b|trading|bull ?market|bear ?market/i, route: 'director', capabilities: ['market_analysis'], reason: 'market vocabulary' },
  // browser / computer use
  { intent: 'browser_op', re: /open https?:\/\/|open (this|that|the)? ?(page|site|website|url|link)|go to https?:|browse to|click|scroll (down|up)|take a screenshot of|what does .* (website|page) (say|show)/i, route: 'director', capabilities: ['browser'], reason: 'browser verb' },
  { intent: 'computer_op', re: /open (the )?app|launch |press (enter|escape|tab)|type this|move the mouse|take over (my )?(screen|desktop|computer)/i, route: 'director', capabilities: ['computer_use'], reason: 'computer-use verb' },
  // debugging before coding (more specific)
  { intent: 'debugging', re: /(traceback|stack ?trace|error|exception|bug|broken|doesn'?t work|failed|crash|fix|debug|why (is|does|do).*(fail|error|broken|not work))/i, route: 'director', capabilities: ['debugging', 'coding'], reason: 'failure vocabulary' },
  // file operations
  { intent: 'file_op', re: /(read|show|open|list|create|edit|update|delete|move|copy|rename) (the |this |that |my )?(file|folder|directory|files)/i, route: 'director', capabilities: ['files'], reason: 'file verb' },
  // documents / data / creative
  { intent: 'document', re: /(pdf|docx?|document|resume|report|letter|contract|invoice|spreadsheet|xlsx|csv|slides?|presentation|pptx)/i, route: 'director', capabilities: ['documents'], reason: 'document vocabulary' },
  { intent: 'data', re: /(dataset|data ?frame|analyze|analyse|chart|graph|plot|statistics|regression|correlation|sql|query the data)/i, route: 'director', capabilities: ['data_analysis'], reason: 'data vocabulary' },
  { intent: 'creative', re: /(draw|paint|logo|poster|story|poem|song|lyrics|script|video|animation|3d|game|music|compose)/i, route: 'director', capabilities: ['creative'], reason: 'creative vocabulary' },
  // coding / research (broad — after the specific lanes)
  { intent: 'coding', re: /(build|create|\bmake\b|develop|implement|refactor|deploy|publish|code|\bscripts?\b|function|\bclass\b|\bapi\b|endpoint|component|\bapps?\b|website|web ?app|\brepos?\b|repository|pull request|\.js|\.py|\.ts|\bnpm\b|\bpip\b|\bgit\b)/i, route: 'director', capabilities: ['coding'], reason: 'build vocabulary' },
  { intent: 'research', re: /(research|investigate|compare|find out|look (up|into)|search (for|the)|what (is|are) the latest|news about|sources?|cite|deep ?dive)/i, route: 'director', capabilities: ['research', 'web_search'], reason: 'research vocabulary' },
  // multi-step mission language
  { intent: 'mission', re: /(multi-?step|mission|project plan|step by step|phase \d|first .* then |roadmap|work breakdown)/i, route: 'mission', capabilities: [], reason: 'mission language' },
];

const SMALLTALK_RE = /^(hi|hello|hey|yo|howdy|sup|hola|habari|mambo|niaje|thanks|thank you|thx|asante|bye|goodbye|later|good ?night|how are you|you good|haha+|lol+|nice|awesome|wow|ok|okay|got it|sounds good|cool|perfect|great)\b[\s.!?,']{0,30}$/i;
const IDENTITY_RE = /^(who are you|who built you|what are you|what'?s your name|who made you|introduce yourself)\b/i;

/**
 * Classify raw user text. Pure + synchronous + zero model calls.
 * @param {string} raw
 * @param {{ activeMission?: boolean, missionId?: string }} ctx
 * @returns {{ intent, confidence, route, capabilities, leanOk, reason }}
 */
export function classify(raw, ctx = {}) {
  const q = String(raw || '').trim();
  if (!q) {
    return { intent: 'conversation', confidence: 'high', route: 'fast', capabilities: [], leanOk: false, reason: 'empty input' };
  }
  // An active mission owns every turn (steering is handled by the mission lane).
  if (ctx.activeMission) {
    return { intent: 'mission', confidence: 'high', route: 'mission', capabilities: [], leanOk: false, reason: 'active mission owns the turn', missionId: ctx.missionId || null };
  }
  if (IDENTITY_RE.test(q) && q.length < 120) {
    return { intent: 'conversation', confidence: 'high', route: 'fast', capabilities: [], leanOk: false, reason: 'identity question', sub: 'identity' };
  }
  if (SMALLTALK_RE.test(q)) {
    return { intent: 'conversation', confidence: 'high', route: 'fast', capabilities: [], leanOk: false, reason: 'small talk', sub: 'smalltalk' };
  }
  for (const r of RULES) {
    if (r.re.test(q)) {
      return { intent: r.intent, confidence: 'high', route: r.route, capabilities: [...r.capabilities], leanOk: false, reason: r.reason };
    }
  }
  // Lean lane: short, self-contained, work-free questions → ONE budget-capped call.
  if (q.length <= 220 && !LEAN_BLOCKER_RE.test(q)) {
    const isQuestion = /\?\s*$/.test(q) || QUESTION_STARTER_RE.test(q);
    if (isQuestion) {
      return { intent: 'question', confidence: 'medium', route: 'lean', capabilities: [], leanOk: true, reason: 'short work-free question' };
    }
  }
  // Default: a general question/statement best handled by the Director with
  // full context (honest routing — never force a lean answer when unsure).
  return { intent: 'question', confidence: 'low', route: 'director', capabilities: [], leanOk: false, reason: 'default: needs reasoning' };
}

/**
 * Semantic fallback hook. The engine never calls a model itself; the caller
 * supplies a reasoner when (and only when) deterministic routing abstained.
 * @param {string} raw
 * @param {{ reasoner?: (prompt: string) => Promise<string> }} opts
 */
export async function classifySemantic(raw, opts = {}) {
  const base = classify(raw, opts);
  if (base.confidence !== 'low' || typeof opts.reasoner !== 'function') return base;
  try {
    const answer = String(await opts.reasoner(
      `Classify this user request into exactly one word: conversation, question, research, coding, debugging, file_op, browser_op, computer_op, creative, document, data, market, mission, schedule, memory, system.\nRequest: ${String(raw).slice(0, 400)}\nOne word only:`
    ) || '').trim().toLowerCase();
    const valid = new Set(['conversation', 'question', 'research', 'coding', 'debugging', 'file_op', 'browser_op', 'computer_op', 'creative', 'document', 'data', 'market', 'mission', 'schedule', 'memory', 'system']);
    if (valid.has(answer)) {
      return { ...base, intent: answer, confidence: 'medium', reason: 'semantic fallback', route: answer === 'conversation' ? 'fast' : 'director' };
    }
  } catch { /* semantic failure → keep the honest deterministic answer */ }
  return base;
}

/** Capability tags for the CapabilityRouter, derived from an intent result. */
export function capabilitiesFor(result) {
  if (!result) return [];
  if (Array.isArray(result.capabilities) && result.capabilities.length) return result.capabilities;
  const map = {
    research: ['web_search', 'encyclopedia', 'papers'], coding: ['docs', 'files', 'git'],
    debugging: ['docs', 'files'], data: ['analytics', 'math'], document: ['convert', 'docs'],
    market: ['economy'], browser_op: ['browser'], file_op: ['files'],
  };
  return map[result.intent] || [];
}
