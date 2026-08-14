import { z } from 'zod';
import { searchKnowledge } from './MemoryManager.js';
import { AGENT_ROSTER, getAgent, skillsForTeam, rosterStats } from './AgentRoster.js';
import { toolsForTeam } from './ToolRegistry.js';
import { generateContent, resolveKeys } from './LLMClient.js';
import { DOMAINS, matchDomains } from './DomainRegistry.js';

/**
 * JEXI's Planner — decides which agents/tools to use and when.
 * This is the "know when to call which tool" brain.
 *
 * Open-source lineage: LangGraph Supervisor / AutoGen GroupChatManager
 * (a planner names the team FIRST), Plan-and-Solve (plan, then execute
 * one-by-one until finished), CrewAI sequential process (strict handoffs).
 *
 * analyzeIntent() = classify (deterministic fast-path regex, zero AI cost)
 *                 + decorate (attach the ordered agent team + plan summary
 *                 so the Orchestrator announces it BEFORE running anything).
 */

/** Which specialists run, in order, for each intent (the "plan first" contract).
 * SLUGS, not display names — resolved to roster entries by getAgent().
 * B49 P1 — every roster entry must appear in at least one team below (or a
 * COMPOUND_DETECT phase / SkillChain runSkill pass); the audit script
 * (scripts/audit-roster.js) fails CI on any orphan. Exported so the audit
 * can verify reachability programmatically. */
export const TEAM_PLAN = {
  image_recognition: ['vision', 'reasoner', 'memory'],
  clear_memory: ['memory'],
  link_analysis: ['video-analyst', 'navigator', 'extractor', 'reasoner', 'memory'],
  math_solve: ['math', 'reasoner', 'memory'],
  self_check: ['self-diagnose', 'reasoner', 'memory', 'tool-router', 'toolsmith', 'agent-builder', 'prompt', 'guardrail'],
  code_task: ['product', 'designer', 'engineer', 'ux-researcher', 'accessibility', 'architect', 'coder', 'runner', 'sandbox', 'debugger', 'qa', 'reviewer', 'critic', 'security', 'shipper', 'reflector', 'ui-developer', 'frontend', 'landing-page-builder', 'email-developer'],
  computer_use: ['navigator', 'vision', 'computer-use', 'reasoner', 'memory'],
  study_topic: ['scholar', 'researcher', 'history', 'science', 'document-analyst', 'memory'],
  // B51 P2 — simple definitional/factual questions: model knowledge + optional
  // memory, NO web/browser/study agents (cheapest correct tool first).
  direct_answer: ['jexi', 'context-manager'],
  conversation: ['jexi', 'context-manager', 'archivist'],
  memory_query: ['memory', 'archivist', 'context-manager'],
  knowledge_recall: ['books', 'document-analyst', 'reasoner', 'memory'],
  news_latest: ['news-scout', 'news-filter', 'news-editor', 'reporter', 'reasoner', 'memory'],
  research: ['query-analyzer', 'searcher', 'reranker', 'extractor', 'synthesizer', 'fact-checker', 'critic', 'memory'],
  learning_research: ['researcher', 'reasoner', 'memory'],
  explain_team: ['planner', 'orchestrator'],
  github: ['github', 'shipper'],
  translate: ['translator', 'translator-v2', 'reviewer', 'editor', 'proofreader'],
  data: ['data', 'data-engineer', 'data-viz', 'scraper', 'sql', 'regex', 'reasoner'],
  devops: ['devops', 'shipper'],
  docs: ['writer', 'reviewer', 'summarizer'],
  perf: ['perf', 'coder', 'reviewer'],
  // Round 4 — deep-domain teams: each new intent routes to its own specialists,
  // so the 200+ roster is actually USED (AutoGen GroupChatManager / LangGraph
  // supervisor pattern: the planner names the right team, never all of them).
  // B49 P1 — every specialist added below was previously an ORPHAN (defined
  // but never composed into any team); wiring it in makes the catalog honest.
  creative_writing: ['novelist', 'screenwriter', 'poet', 'songwriter', 'editor', 'critic', 'summarizer'],
  business_plan: ['business-analyst', 'startup-advisor', 'financial-advisor', 'market-analyst', 'strategist', 'sales-rep', 'crm-specialist', 'customer-success'],
  marketing_plan: ['market-analyst', 'growth-marketer', 'seo-specialist', 'copywriter', 'brand', 'product-marketer', 'lifecycle-marketer', 'community-manager', 'devrel-engineer', 'social', 'email', 'ad-copywriter', 'newsletter-writer', 'brand-designer'],
  event_planning: ['event-planner', 'wedding-planner', 'travel', 'finance'],
  meal_plan: ['chef', 'nutrition', 'health'],
  workout_plan: ['fitness', 'health', 'nutrition', 'sleep-coach', 'meditation-coach'],
  investing_advice: ['investor', 'financial-advisor', 'tax-advisor'],
  tech_support: ['support-engineer', 'debugger', 'coder', 'writer'],
  security_audit: ['pentester', 'security', 'appsec', 'risk-analyst', 'red-team', 'blue-team', 'cryptographer', 'privacy-officer', 'compliance-officer', 'forensic-analyst', 'security-trainer', 'guardrail'],
  content_creation: ['content-strategist', 'blog-writer', 'seo-writer', 'video-script-writer', 'editor', 'technical-editor', 'ux-writer', 'copyeditor', 'white-paper-writer', 'case-study-writer', 'api-docs-writer', 'podcaster', 'speech-writer', 'essayist', 'grant-writer', 'newsletter-writer', 'ad-copywriter', 'ghostwriter', 'illustrator', 'motion-designer', 'sound-designer'],
  study_exam: ['exam-coach', 'study', 'teacher', 'flashcard-maker', 'homework-helper', 'grader', 'curriculum-designer', 'lab-assistant', 'research-mentor', 'academic-writer', 'coding-tutor', 'languages', 'tutor'],
  career_plan: ['career', 'recruiter', 'resume', 'interviewer', 'hr-specialist'],
  // Round 6 — platform & reliability teams (pulled in only when the intent
  // requires them: observability for metrics, sandbox for code, offline only
  // when providers are down, voice when speaking, plugin for packages,
  // chaos only behind the test flag).
  observability: ['observability', 'concurrency', 'reasoner', 'memory'],
  offline_mode: ['offline', 'reasoner', 'memory'],
  voice_command: ['voice-orchestrator', 'reasoner', 'memory'],
  plugin_task: ['plugin-manager', 'reasoner'],
  chaos_test: ['chaos-agent', 'orchestrator', 'reflector'],
  relationship_advice: ['relationship-coach', 'counselor', 'dating-coach'],
  startup_advice: ['startup-advisor', 'business-analyst', 'pricing-strategist', 'investor'],
  productivity: ['task-manager', 'scheduler', 'note-taker', 'email-triage', 'meeting-planner', 'expense-tracker', 'operations-manager', 'executive-assistant'],
  data_ml: ['data-scientist', 'ml-engineer', 'ml-ops', 'data-engineer', 'data-quality', 'bi-analyst', 'reporting-analyst', 'database-admin'],
  cloud_devops: ['cloud-engineer', 'kubernetes-engineer', 'terraform-engineer', 'sre', 'devops', 'network-engineer', 'log-analyst', 'monitoring-engineer', 'deploy-engineer', 'infra-auditor', 'database-ops', 'backup-engineer', 'release-engineer', 'ci-engineer', 'cost-optimizer', 'incident-commander'],
  api_backend: ['api-engineer', 'auth-engineer', 'backend', 'database', 'devtools-engineer'],
  mobile_app: ['mobile-engineer', 'ios-engineer', 'android-engineer', 'react-native-engineer', 'qa'],
  game_dev: ['game-developer', 'designer', 'coder', 'qa'],
  home_life: ['home-org', 'interior-designer', 'event-planner', 'gardener', 'fashion-stylist', 'beauty-advisor', 'pet-care', 'parenting'],
  // B49 P1 — new intent for previously-orphaned legal specialists.
  legal_task: ['legal-drafter', 'negotiator', 'legal', 'privacy-officer', 'compliance-officer'],
  // B50 — academic/scientific field routing: every field in the Domain
  // registry maps to its specialist team, data-driven (a new field only
  // needs a registry entry to become a routable intent + reachable agents).
  ...Object.fromEntries(DOMAINS.map((d) => [`domain:${d.id}`, d.team])),
};

/** "gather news/research/study, THEN build" → the compound team, run in phases.
 * Exported so the roster audit can verify phase names resolve to roster slugs. */
export const COMPOUND_DETECT = [
  {
    re: /(build|create|make|write|code|develop)\b[^.!?\n]{0,80}\b(news|headlines?|latest stories|breaking stories|today['’]?s (stories|news)|current events)\b/i,
    phases: [
      { name: 'News Team', intent: 'news_latest', agents: ['News Scout', 'News Filter', 'News Editor', 'Reasoner'] },
      { name: 'Coding Team', intent: 'code_task', agents: ['Product', 'Designer', 'Engineer', 'Coder', 'Runner', 'Debugger', 'QA Lead', 'Reviewer', 'Security Officer', 'Shipper', 'Reflector'] },
    ],
    reasoning: 'The user wants something built from fresh news — the News Team gathers first, then the Coding Team builds on that context.',
  },
  {
    re: /(build|create|make|write|code|develop)\b[^.!?\n]{0,80}\b(weather|calculator|tracker|dashboard|app|website|web ?page|tool|game|quiz|planner)\b[^.!?\n]{0,80}\b(research|find out|look up|based on|from (the )?(data|facts|information)|about)\b/i,
    phases: [
      { name: 'Research Team', intent: 'research', agents: ['Query Analyzer', 'Searcher', 'Re-ranker', 'Extractor', 'Synthesizer'] },
      { name: 'Coding Team', intent: 'code_task', agents: ['Product', 'Designer', 'Engineer', 'Coder', 'Runner', 'Debugger', 'QA Lead', 'Reviewer', 'Security Officer', 'Shipper', 'Reflector'] },
    ],
    reasoning: 'The user wants an app whose content needs research first — Research gathers facts, then the Coding Team builds on them.',
  },
  // RESEARCH-FIRST — "research X, then apply/build/make Y". This is the classic
  // two-team phrasing ("go research the best layout, then apply it"). Without it,
  // these requests fell into the heavy coding sprint and the chat went silent.
  // The trailing modifier keeps "research a recipe, then make it" (cooking) in
  // research — there must be an app/UI/design deliverable after the build verb.
  {
    re: /\b(research|study|find out|look up|investigate|check out|go research|search( for| up)?)\b[^.!?\n]{0,90}\b(then|and then|and|afterwards|after that|finally)\b[^.!?\n]{0,70}\b(apply|implement|build|create|develop|redesign|restyle|restructure|revamp|style)\b[^.!?\n]{0,80}\b(to make|so it|so the|look|better|nicer|cooler|prettier|cleaner|modern|beautiful|professional|app(lication)?|ui|interface|frontend|website|web ?page|dashboard|component|page|panel|tool|game|calculator|tracker|portfolio|script|code|project|theme|design)\b/i,
    phases: [
      { name: 'Research Team', intent: 'research', agents: ['Query Analyzer', 'Searcher', 'Re-ranker', 'Extractor', 'Synthesizer'] },
      { name: 'Coding Team', intent: 'code_task', agents: ['Product', 'Designer', 'Engineer', 'Coder', 'Runner', 'Debugger', 'QA Lead', 'Reviewer', 'Security Officer', 'Shipper', 'Reflector'] },
    ],
    reasoning: 'The user wants RESEARCH first, then the findings APPLIED/built on top — the Research Team gathers, then the Coding Team applies it.',
  },
];

/**
 * Priority 2 — structured routing. The classification schema is the single
 * validated contract for the planner's primary (LLM) path; the regex cascade
 * survives as fast-path/fallback only.
 */
export const CLASSIFIER_INTENTS = [
  'image_recognition', 'clear_memory', 'link_analysis', 'math_solve', 'self_check',
  'code_task', 'computer_use', 'study_topic', 'direct_answer', 'conversation', 'memory_query',
  'knowledge_recall', 'news_latest', 'research', 'learning_research', 'explain_team',
  'github', 'translate', 'data', 'devops', 'docs', 'perf', 'compound_task',
  'creative_writing', 'business_plan', 'marketing_plan', 'event_planning', 'meal_plan',
  'workout_plan', 'investing_advice', 'tech_support', 'security_audit', 'content_creation',
  'study_exam', 'career_plan', 'relationship_advice', 'startup_advice', 'productivity',
  'data_ml', 'cloud_devops', 'api_backend', 'mobile_app', 'game_dev', 'home_life',
  'legal_task',
];

export const ClassificationSchema = z.object({
  intent: z.enum(CLASSIFIER_INTENTS),
  confidence: z.number().min(0).max(1),
  teamSlugs: z.array(z.string()),
  reasoning: z.string(),
});

/** Few-shot positives, incl. the confusable pairs that actually exist here. */
const CLASSIFIER_FEW_SHOTS = [
  { q: 'build me a study planner app with reminders', intent: 'code_task', reason: 'An app deliverable — the coding team builds it.' },
  { q: 'study calculus for my exam', intent: 'study_topic', reason: 'A topic to learn, NOT an app. Study, never code_task.' },
  { q: 'what is the capital of kenya', intent: 'direct_answer', reason: 'A simple fact — answer directly, no web/study pipeline (B51 P2).' },
  { q: 'what is computer science', intent: 'direct_answer', reason: 'Definitional — answer from knowledge, never study_topic/research (B51 P2).' },
  { q: 'my book explains photosynthesis — what does it say', intent: 'knowledge_recall', reason: 'Asks about the user\'s own book/library.' },
  { q: 'commit and push my code to github', intent: 'github', reason: 'A real git operation.' },
  { q: 'translate this to french: good morning', intent: 'translate', reason: 'A translation request.' },
  { q: 'latest news about ai regulation', intent: 'news_latest', reason: 'Fresh news gathering.' },
  { q: 'solve 2x + 5 = 13', intent: 'math_solve', reason: 'A concrete math problem.' },
  { q: 'who are you', intent: 'conversation', reason: 'Identity question — answer directly.' },
  { q: 'analyze this csv and chart the results', intent: 'data', reason: 'Data analysis with a chart.' },
  { q: 'build an app that tracks my water intake', intent: 'code_task', reason: 'An app deliverable even without an explicit build verb.' },
  { q: 'write a readme for my project', intent: 'docs', reason: 'Documentation for existing work.' },
  { q: 'make my website load faster', intent: 'perf', reason: 'A performance task, not a build.' },
];

const CLASSIFIER_SYSTEM = `You are JEXI OS's intent classifier. You read a user request and decide which single specialist pipeline should handle it.

Available intents: ${CLASSIFIER_INTENTS.join(', ')}

Rules:
- Choose EXACTLY ONE intent. Never invent new intents.
- "build/ create/ make/ develop + app/ website/ tool/ tracker/ planner/ calculator..." is ALWAYS code_task — even when the subject mentions study, data, news, etc. The DELIVERABLE decides, not the subject.
- A topic the user wants to LEARN (no app deliverable) is study_topic, study_exam or research — never code_task.
- Simple "what is X" / definitional / one-line factual questions are direct_answer — answered from knowledge, NEVER research or study_topic. Research is only for questions needing current or multi-source external evidence.
- Answers about the user's own books/knowledge library are knowledge_recall.
- Latest/breaking news is news_latest. Facts from the web are research.
- Concrete math (equations, derivatives, integrals, calculations) is math_solve.
- Git/GitHub actions (commit, push, PR, issues) are github.
- Output ONLY a single JSON object — no markdown fences, no prose:
{"intent":"...","confidence":0.95,"teamSlugs":["coder","qa"],"reasoning":"one short line"}`;

/** Extract the first JSON object from an LLM reply (tolerates prose/fences). */
function extractJson(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  if (trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed); } catch (e) {}
  }
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (e) {}
  }
  return null;
}

export class Planner {
  /** Classify the intent (fast, deterministic, free) then attach the team plan. */
  async analyzeIntent(query, opts = {}) {
    const plan = await this._classify(query, opts);
    // Resolve the ordered specialist team — one source of truth for who runs.
    const teamSlugs = this._teamFor(plan);
    const team = teamSlugs.map((s) => getAgent(s)).filter(Boolean);
    plan.teamSlugs = teamSlugs;
    plan.steps = teamSlugs.map((s) => (getAgent(s)?.name) || s);
    plan.planSummary = plan.steps.join(' → ');
    // Decorate every plan with the roster subset + skills + tools this task
    // will exercise (Agent Roster & Skill Registry & Tool Registry) so the
    // pipeline can announce the team, stream the skills, and auto-route the
    // exact tool set — zero manual tool instruction (AutoTool pattern).
    plan.roster = team.map((a) => a.name);
    plan.skillIds = skillsForTeam(team).map((s) => s.slug);
    plan.skillsLine = skillsForTeam(team).map((s) => s.name).slice(0, 12).join(' · ');
    plan.rosterStats = rosterStats();
    plan.rosterSummary = `${team.length} specialists · ${skillsForTeam(team).length} skills`;
    plan.rosterCatalogSize = rosterStats().agents;
    plan.skillCatalogSize = rosterStats().skills;
    // AUTO TOOL ROUTING — the tool set is derived from the resolved team (for
    // compound tasks, the union of both phases' teams).
    const teamSets = plan.intent === 'compound_task'
      ? (plan.phases || []).map((p) => this._resolveNames(p.agents || []))
      : [teamSlugs];
    const seen = new Set();
    const toolSet = [];
    for (const set of teamSets) {
      for (const t of toolsForTeam(set.map((s) => getAgent(s)).filter(Boolean))) {
        if (!seen.has(t.slug)) { seen.add(t.slug); toolSet.push(t); }
      }
    }
    plan.tools = toolSet.map((t) => t.slug);
    plan.toolsLine = toolSet.map((t) => t.name).join(' · ');
    plan.toolCount = toolSet.length;
    return plan;
  }

  /** Ordered team slugs for a plan: TEAM_PLAN, else any task slugs that are real agents. */
  _teamFor(plan) {
    if (plan.intent === 'compound_task') {
      return (plan.phases || []).flatMap((p) => this._resolveNames(p.agents || []));
    }
    const slugs = TEAM_PLAN[plan.intent];
    if (slugs) return slugs;
    return (plan.tasks || []).map((t) => (getAgent(t) ? t : null)).filter(Boolean);
  }

  /** Resolve display names ('QA Lead', 'JEXI', 'Vision') to roster slugs. */
  _resolveNames(names) {
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
    const byNorm = new Map(AGENT_ROSTER.map((a) => [norm(a.name), a.slug]));
    return (names || []).map((n) => {
      const key = norm(n);
      if (byNorm.has(key)) return byNorm.get(key);
      // Prefix fallback: 'Vision' → 'Vision Agent', 'JEXI' → 'JEXI Core'
      const hit = AGENT_ROSTER.find((a) => norm(a.name).startsWith(key) || key.startsWith(norm(a.name)));
      return hit ? hit.slug : null;
    }).filter(Boolean);
  }

  /**
   * Confirmation-resume: the user answered "yes / go ahead" to a task JEXI
   * offered. Re-plan the ORIGINAL request (not the empty "yes", which used to
   * fall into research and made JEXI re-search instead of acting).
   *
   * A vague personal task like "I want to track my water intake" that first
   * landed in research gets nudged toward the coding team — but only when the
   * request really sounds like a personal task ("I want…", "track…", "remind
   * me…"), never for plain questions ("tell me about…", "how does…").
   */
  async planConfirmed(originalQuery) {
    const plan = await this.analyzeIntent(originalQuery);
    const passive = new Set(['research', 'learning_research', 'conversation']);
    if (passive.has(plan.intent)) {
      const asksToLearn = /understand|learn (about|how)|explain|tell me about|how (does|do|is|can)|what is|meaning of/i.test(String(originalQuery || ''));
      const asksForTask = /i (want|need|would like|'d like)\b|track|remind me|manage my|organize my|store my|convert|automate|monitor my|notif|keep track|log my|budget my|save my|wish to/i.test(String(originalQuery || ''));
      if (!asksToLearn && asksForTask) {
        const nudge = await this.analyzeIntent(`${originalQuery} — please build an app for it now`);
        if (!passive.has(nudge.intent)) return nudge;
      }
    }
    return plan;
  }

  async _classify(query, opts = {}) {
    const q = String(query || '').toLowerCase();
    const hasImage = Boolean(opts.image);

    // FAST PATH (P2) — only unambiguous, deterministic patterns earn a free
    // regex route (zero AI cost). Everything else goes through the LLM first.
    if (hasImage) {
      return { intent: 'image_recognition', tasks: ['vision', 'reasoning', 'memory'], reasoning: 'User provided an image to analyze.', payload: opts.image };
    }
    if (/clear (all )?memory|forget everything|wipe memory|delete memory/i.test(q)) {
      return { intent: 'clear_memory', tasks: ['memory'], reasoning: 'User wants to wipe memory.' };
    }
    const linkMatch = query.match(/https?:\/\/[^\s)'"]+/i);
    if (linkMatch && !/http:\/\/localhost|127\.0\.0\.1|\.onion/i.test(linkMatch[0])) {
      return { intent: 'link_analysis', tasks: ['browser', 'extractor', 'reasoning', 'memory'], reasoning: 'User shared a link — JEXI will open it with the browser and summarize.', payload: { url: linkMatch[0], fullQuery: query } };
    }

    // 0.5 Agent-team safety controls: /careful, /freeze, /guard <paths>, /unfreeze
    const scope = { mode: 'normal', paths: [] };
    const cmdMatch = q.match(/^\s*\/(careful|freeze|unfreeze|guard|team)\b(.*)$/i);
    if (cmdMatch) {
      const cmd = cmdMatch[1].toLowerCase();
      if (cmd === 'careful') scope.mode = 'careful';            // read-only QA, no destructive ops
      else if (cmd === 'freeze') scope.mode = 'freeze';          // plan only — write nothing
      else if (cmd === 'unfreeze') scope.mode = 'normal';        // unlock
      else if (cmd === 'guard') {                                // careful + only touch named files
        scope.mode = 'careful';
        scope.paths = String(cmdMatch[2] || '').split(/[\s,]+/).filter(Boolean);
      }
      // /team keeps normal mode — the team already runs for every build.
    } else if (/be careful|careful mode/i.test(q)) {
      scope.mode = 'careful';
    }
    const scopedQuery = query.replace(/^\s*\/(careful|freeze|unfreeze|guard|team)\b\s*/i, '').trim();

    // PRIMARY PATH (P2): schema-validated LLM classification — meaning-first
    // routing the regex cascade cannot express. Priority 6 memory is injected
    // so a remembered preference/project state can decide the intent.
    try {
      const llm = await this._classifyLLM(query, { ...opts, scope, scopedQuery });
      if (llm) return llm;
    } catch (e) {
      // Provider failure must never kill classification — fall through to the
      // deterministic cascade (fail closed, never crash).
    }

    // FALLBACK: the deterministic regex cascade (fast, free, no keys needed).
    return this._classifyRegex(query, { ...opts, scope, scopedQuery });
  }

  /**
   * P2 — schema-validated LLM classification (the primary path). Returns null
   * when no AI key is configured, the model is unsure (< 0.5), or the reply
   * fails schema validation — the caller then falls back to the regex cascade
   * (never a crash).
   */
  async _classifyLLM(query, opts = {}) {
    const keys = resolveKeys();
    if (!keys.groqKey && !keys.geminiKey && !keys.openrouterKey && !keys.xaiKey) return null;
    try {
      const memoryContext = opts.memoryContext
        ? `\n\nRemembered context about the user/project (use it ONLY if it directly decides this request):\n${opts.memoryContext.slice(0, 1500)}`
        : '';
      const shots = CLASSIFIER_FEW_SHOTS.map((s) => `User: "${s.q}" → ${s.intent} (${s.reason})`).join('\n');
      const activeTaskNote = opts.activeTaskId
        ? `\nAn ACTIVE product task exists (${opts.activeTaskId}). Modification language — \"add …\", \"change …\", \"update …\", \"fix …\", \"make the …\", \"now also …\" — means the user wants to EDIT that product: classify code_task, never research/direct_answer.`
        : '';
      const prompt = `Classify this user request into exactly one JEXI OS intent.${memoryContext}${activeTaskNote}

Examples:\n${shots}

NEGATIVE EXAMPLES (do NOT confuse these pairs):\n- "build a study planner app" → code_task (an APP!) — never study_topic\n- "study calculus" → study_topic (a TOPIC!) — never code_task\n- "write documentation for my code" → docs — never code_task\n- "make my app faster" → perf — never code_task\n- "latest news about X" → news_latest — never research\n- "what is computer science" → direct_answer (definitional — answer from knowledge, NO study/research pipeline)\n- "what is the capital of Kenya" → direct_answer (simple fact — no web/study)\n- "study computer science for my exam" → study_topic (explicit learning request)\n- "add dark mode to the calculator" → code_task (MODIFY an existing product — never research)\n- "change the button color" → code_task (modification — never research)\n\nUser request: "${query}"\n\nReturn ONLY valid JSON: {"intent": "...", "confidence": 0.0-1.0, "teamSlugs": [...], "reasoning": "..."}`;
      const raw = await generateContent(prompt, CLASSIFIER_SYSTEM, null, { temperature: 0 });
      const parsed = extractJson(raw);
      if (!parsed) return null;
      const validated = ClassificationSchema.safeParse(parsed);
      if (!validated.success) return null;
      const { intent, confidence, teamSlugs, reasoning } = validated.data;
      if (confidence < 0.5) return null; // unsure → deterministic fallback
      return { intent, tasks: teamSlugs || [], reasoning, confidence };
    } catch (e) {
      return null;
    }
  }

  /** P2 fallback — the original deterministic regex cascade (unchanged logic). */
  async _classifyRegex(query, opts = {}) {
    const q = String(query || '').toLowerCase();
    const { scope = { mode: 'normal', paths: [] }, scopedQuery = String(query || '') } = opts;
    const hasImage = Boolean(opts.image);

    // 3. Math detection — symbols, formulas, calculations, word problems.
    //    (checked BEFORE coding: "calculate" etc. is math unless it's a build request)
    //    Topic words alone (calculus, algebra, geometry) must NOT trigger a solve:
    //    "study calculus" is a study task and "what is calculus" is a research
    //    question — they need a compute verb or an actual expression to be math.
    // Word-bound the verb tokens: /compute/ would otherwise match "comPUTER" and
    // /solve/ would match "reSOLVED" — sending "how do computers work" to the
    // math team. No 'ing' ending: "quantum COMPUTING" is a field, not the verb.
    const mathCompute = /(\bcalculat(?:e|es|ed)\b|\bcomput(?:e|es|ed)\b|\bsolv(?:e|es|ed)\b|integrate|derivative|differentiate|sum of|multiply|divide|sqrt|square root|equation|formula|percentage|what is \d|\d+\s*[+\-×÷*\/]\s*\d|\^2|\$\$)/i;
    const mathTopic = /(math|algebra|calculus|geometry|trigonometry)/i;
    const mathAsk = /(\bcalculat(?:e|es|ed)\b|\bcomput(?:e|es|ed)\b|\bsolv(?:e|es|ed)\b|problem|question|homework|how (do|can) (i|you) (solve|do|find)|work (out|this) out)/i;
    if ((mathCompute.test(q) || (mathTopic.test(q) && mathAsk.test(q))) && !this.isCoding(scopedQuery)) {
      return { intent: 'math_solve', tasks: ['reasoning', 'memory'], reasoning: 'Mathematical question — solve with structured LaTeX steps.' };
    }

    // 5. Self-diagnosis — JEXI checks her own system, reads her source, reports root causes.
    //    Checked BEFORE coding so "check yourself ... errors ... fix" style queries never
    //    get misrouted to the coding pipeline.
    if (/self[- ]?check|check yourself|diagnos(e|tic)|run (a )?(system|self) check|system status|are you (ok|okay|healthy|fine)|monitor yourself|what'?s wrong|any errors|health check/i.test(q)) {
      return { intent: 'self_check', tasks: ['self', 'reasoning', 'memory'], reasoning: 'JEXI runs a full self-diagnosis and reports system health with root causes.' };
    }

    // 5.1 OBSERVABILITY — metrics, latency, tokens, traces, provider health.
    //     The Observability Agent answers from the live metrics store.
    if (/(metrics|latency|token (usage|count|spend)|traces?|spans?|provider (health|status)|how (much|many) tokens|uptime|response times?|request counts?)/i.test(q)) {
      return { intent: 'observability', tasks: ['observability', 'reasoning'], reasoning: 'User asks about live system metrics/observability — the Observability Agent reports from the real metrics store.' };
    }

    // 5.15 OFFLINE MODE — explicit offline/local-model requests, or the caller
    //     signaling that providers are unhealthy (opts.offline). The Offline Agent
    //     routes to Ollama / llama.cpp when available.
    if (opts.offline || /offline (mode|llm|model)|local (llm|model|ai)|ollama|llama\.cpp|run (it |this )?(offline|locally|without (the )?internet)/i.test(q)) {
      return { intent: 'offline_mode', tasks: ['offline', 'reasoning'], reasoning: 'User wants an offline/local run — the Offline Agent routes to a local LLM backend.' };
    }

    // 5.2 VOICE COMMAND — voice input (opts.audio) or explicit speak/listen
    //     requests. The Voice Orchestrator owns the speech pipeline.
    if (opts.audio || /(use|enable|turn on) (voice|speech)|voice (command|input|mode)|(say|speak|read|play|listen to) (it|this|that|out loud|aloud)|read (it|this|that) (to|out loud|aloud) me|talk to me/i.test(q)) {
      return { intent: 'voice_command', tasks: ['voice-orchestrator', 'reasoning'], reasoning: 'Voice/speech request — the Voice Orchestrator runs the STT/TTS pipeline.' };
    }

    // 5.25 PLUGIN TASK — install/add/load an external skill/tool package.
    //     The Plugin Manager validates and loads it into the registry.
    if (/(install|add|load|enable|update|remove|unload|uninstall) (a |an |the |new )?(plugin|extension|add-?on|skill pack|tool pack)|(plugin|skill pack|tool pack) (for|manager)|what plugins? (are|do) (there|you|i) (have|use|need)|list (my |the |your )?plugins?/i.test(q)) {
      return { intent: 'plugin_task', tasks: ['plugin-manager', 'reasoning'], reasoning: 'Plugin management request — the Plugin Manager validates and loads the package.' };
    }

    // 5.3 CHAOS TEST — test-only, feature-flagged. Only fires when the caller
    //     passes opts.chaos (JEXI_CHAOS=1 in the host env enables the agent).
    if (opts.chaos && /(chaos|inject (a |an |the )?(provider |tool )?(failure|timeout|error)|failure injection|hardening test|break (the )?system)/i.test(q)) {
      return { intent: 'chaos_test', tasks: ['chaos-agent', 'orchestrator'], reasoning: 'Chaos-engineering request behind the JEXI_CHAOS flag — the Chaos Agent injects controlled failures.' };
    }

    // 5.2 EXPLAIN THE TEAM — "how do you decide which agents to use" is a question
    //     about JEXI herself, not a task. She explains the planner + team routing.
    if (/which agents? (will|should|do) (you|i) (use|run|pick|call|choose)|how do you (decide|choose|pick|know) (which|what) (agents?|team|specialists?|skills?)|how (does|do) (your|the) (team|agent team|pipeline|planning|agents?) (work|plan|decide|choose|pick)|explain (your|the) (agent )?(team|planning|routing|pipeline)|explain how (your|the|you) (agent )?(team|planner|system|agents?) (plan|work|decide)|how (do|does) you plan (a |your |the |out )?(task|request|build)|plan (which|what) agents/i.test(q)) {
      return { intent: 'explain_team', tasks: ['planner'], reasoning: 'User asks how JEXI plans and routes her agent team — she explains the planner-first architecture.' };
    }

    // 5.5 COMPOUND TASK — the task needs TWO teams: gather (news/research) FIRST,
    //    then BUILD on top of it. The planner names both phases up front; the
    //    orchestrator runs them one-by-one, feeding phase 1's output to phase 2.
    //    (Plan-and-Solve / supervisor pattern: plan first, execute in order.)
    const compound = COMPOUND_DETECT.find((c) => c.re.test(q));
    if (compound) {
      return { intent: 'compound_task', phases: compound.phases, reasoning: compound.reasoning };
    }

    // 5.7 DOCUMENTATION — "write a readme / docs for this project" is a writer task,
    //    not a coding task. Checked BEFORE coding so "write documentation for my code"
    //    never gets misrouted to the build pipeline (but "build a docs website" still
    //    codes — the negative lookahead keeps app/tool nouns out of this intent).
    if (/\b(write|create|generate|update|add|document)\s+(a\s+|the\s+)?(readme|documentation|docs|api reference|how[- ]to guide|release notes?)(?!\s+(app|tool|generator|bot|website|web ?page))\b|document (this|my|the) code/i.test(q)) {
      return { intent: 'docs', tasks: ['writer'], reasoning: 'User wants documentation written for existing work — the Technical Writer reads the files and writes real docs.' };
    }

    // 5.8 GITHUB — git operations (commit, push, PR, issues, repo). Real CLI work,
    //     not coding. Checked BEFORE coding because "push my code to github" mentions
    //     code; action-first / git-dominant / git-phrase patterns keep "build a push
    //     notification app" in the coding team.
    const gitActionFirst = /^(?:please\s+)?(?:can you\s+)?(?:commit|push|clone|pull|git status|upload to github|send to github)\b/i.test(q);
    const gitDominant = /\b(push|commit|clone|pull|upload|sync)\b[^.!?\n]{0,50}\b(github|git|remote|origin)\b/i.test(q);
    const gitPhrases = /(create|make|new|start|open)\s+(a\s+|an\s+)?(repo|repository)|\brepo(ository)?\s+(create|new)|open (a )?pull request|create (a )?pull request|pr (create|list)|list (pull requests|prs|issues)|issue (create|list)|open (an? )?issue|create (an? )?issue|file (an? )?issue|git status|github (connected|token|auth|connected\?)|check github|init (a )?(git )?repo\b/i.test(q);
    if (gitActionFirst || gitDominant || gitPhrases) {
      return { intent: 'github', tasks: ['github'], reasoning: 'Git/GitHub operation — the GitHub Agent runs the real gh/git CLI and reports honest output.' };
    }

    // 5.9 PERF — "make my app faster" is a performance task, NOT a build task.
    //     Checked BEFORE coding ("make my app load faster" mentions make+app and
    //     would otherwise route to the coding team). The regex needs a speed
    //     symptom, so "build a speed tracker app" still codes.
    const perfHints = /\boptimize\b|performance issue|bottleneck|bundle size|web vitals|laggy|improve (the )?performance|speed ?up|loads? (faster|slow(ly)?)|load time|too slow|running slow|make (it|this|the|my|our) [^.!?\n]{0,35} (faster|slow(er|ly)?|snappier)\b/i;
    if (perfHints.test(q)) {
      return { intent: 'perf', tasks: ['perf'], reasoning: 'Performance request — the Performance Engineer measures the real files, fixes the top bottlenecks and proves the improvement.' };
    }

    // 6. Coding / programming — the FULL AGENT TEAM plans, builds, QA-tests and ships.
    //    Checked BEFORE study/research so "build me a study planner", "an app to
    //    track habits", "/team build…" and "/careful check my code" all land here
    //    (slash commands are stripped first — isCoding tests the scopedQuery).
    if (this.isCoding(scopedQuery)) {
      return { intent: 'code_task', tasks: ['architect', 'coder', 'runner', 'debugger', 'qa', 'reviewer', 'memory'], reasoning: 'Coding task — the team: product → designer → engineer → coder → QA → reviewer → shipper.', scope, query: scopedQuery };
    }

    // 6.1 B53 P3 — MODIFY an existing product: with an active product task,
    //     add/change/update/fix language is a CODE CONTINUE that applies the
    //     edit to the existing workspace — never research the word "change".
    const MODIFY_LANG = /^(?:can you |please |now |let'?s |also )?(add|change|update|fix|modify|improve|remove|restyle|redesign|restructure|tweak|polish|style|make the|make it|make my|make this|now also|also make)\b/i;
    if (opts.activeTaskId && MODIFY_LANG.test(q)) {
      return { intent: 'code_task', tasks: ['coder', 'runner', 'debugger', 'qa', 'reviewer', 'memory'], reasoning: 'Modification request on the active product task — apply the change to the existing workspace.', scope, query: scopedQuery };
    }

    // 6.3 TRANSLATE — meaning-first translation with a reflection loop. Checked after
    //     coding so "build a translation app" still builds, and before computer-use
    //     so a plain text request never grabs the browser.
    if (/^\s*(please\s+)?(can you\s+)?translate\b|\btranslate (this|the|that|it|following|to|into)|\b(in|into)\s+(french|spanish|german|italian|portuguese|japanese|korean|chinese|mandarin|hindi|arabic|russian|swahili|dutch|polish|turkish|yoruba|igbo|hausa|greek|latin)\b/i.test(q)) {
      return { intent: 'translate', tasks: ['translator'], reasoning: 'Translation request — the Translator runs the draft → critique → revise reflection loop.' };
    }

    // 6.4 COMPUTER USE — the user wants JEXI to DRIVE the browser (navigate,

    // 6.4 COMPUTER USE — the user wants JEXI to DRIVE the browser (navigate,
    //    click, type, interact), not just search. Checked after coding (so
    //    "build a web scraper" still hits the team) and before research (so
    //    "use the browser to find…" actually drives the browser instead of
    //    falling into the text-search pipeline).
    const SITES = 'wikipedia|google|youtube|amazon|github|stack ?overflow|reddit|twitter|facebook|instagram|netflix|spotify|apple|microsoft|bbc|cnn|nytimes|duckduckgo|bing';
    const browserDriving = new RegExp(
      'use (the |your |a )?(browser|computer|desktop|internet)|' +
      'browse (the |on the |through |around |for |online |a bit )?(web|internet|net|browser)|' +
      'surf (the |on the )?(web|internet|net)|' +
      '(open|start|launch) (the |a |an )?(browser|internet|web)|' +
      '(look up|search|find|check) .{0,50} (in|on|using) (the )?(browser|web|internet)|' +
      '(open|go to|take me to|visit|navigate to) (the |this |a )?(website|site|web ?page|' + SITES + ')|' +
      '(click on|click the|tap on)( the)? (button|link|tab|search|icon|menu|\\d+)|' +
      'type .*(in|into|on) (the )?(search|input|box|field)|' +
      'search (for )?.* on (the |this )?(website|site|page|web)|' +
      'fill (in|out )?(the )?(form|login|signup|checkout)|' +
      '(log|sign)(\\s*(in|into))(\\s+to)?(\\s+(my|the|this|a))?\\s+(email|mail|gmail|outlook|yahoo|hotmail|account|bank|app|application|site|website|platform|dashboard|portal|twitter|facebook|instagram|youtube|amazon|netflix|spotify)|' +
      'search on (google|wikipedia|bing|duckduckgo|youtube|amazon)|' +
      'scroll (down|up|through)|' +
      'interact with (the |this |a )?(website|site|page|app|browser)|' +
      'computer ?use|desktop (automation|use)|control (the )?(computer|desktop|browser)',
      'i'
    );
    if (browserDriving.test(q)) {
      return { intent: 'computer_use', tasks: ['browser', 'reasoner', 'memory'], reasoning: 'User wants JEXI to drive the browser interactively — the Computer Use agent navigates, clicks and types.' };
    }

    // 6.45 DATA — analyze data, compute real statistics, build a chart. Checked
    //     after coding ("build a chart app" still codes) and before study/research.
    if (/\b(analyze|analyse|profile)\b.*\b(data|csv|json|dataset|spreadsheet|table|numbers)\b|\b(data|csv|json|dataset|spreadsheet)\b.*\b(analy|statistics|stats|mean|average|sum|chart|graph|plot|visuali[sz]e|insights?)\b|\b(make|build|create|generate|draw)\b.*\b(chart|graph|plot)\b.*\b(data|from|using)\b|\b(statistics|stats)\b/i.test(q)) {
      return { intent: 'data', tasks: ['data'], reasoning: 'Data analysis request — the Data Analyst loads the data, computes real statistics and charts it.' };
    }

    // 6.47 DEVOPS — deploy, containerize, CI/CD. Checked after coding ("build a
    //     deployment tool" still codes) and before study/research.
    if (/\b(deploy|deployment|docker|containeri[sz]e|ci\/cd|github actions|ci workflow|host (this|the|my)|put (this|the|my) (app|site|code) online)\b/i.test(q)) {
      return { intent: 'devops', tasks: ['devops'], reasoning: 'Deployment/infra request — the DevOps Agent detects the stack, generates the Dockerfile/CI and gives exact deploy steps.' };
    }

    // 6.5 Study / deep learn (AFTER coding so "study planner" apps aren't hijacked;
    //    also after math so "study calculus" is a study task, not a math solve).
    //    "study for an exam/test" routes to the exam-prep team, not deep study.
    if (/study|learn everything about|fill knowledge base|master topic|teach me (everything about )?/i.test(q)) {
      if (/study.*\b(exam|test|sat|act|gcse|ap |boards)\b/i.test(q)) {
        return { intent: 'study_exam', tasks: ['exam-coach', 'study', 'teacher'], reasoning: 'User wants exam/test preparation — the Exam Coach builds a prep plan.' };
      }
      const topic = query.replace(/study|learn everything about|fill knowledge base|master topic|teach me/i, '').trim().replace(/^about\s+/i, '');
      return { intent: 'study_topic', tasks: ['scholar', 'research', 'memory'], reasoning: 'User wants JEXI to deep-study and store in the knowledge library.', payload: topic };
    }

    // 7. Greetings & pure conversation — INCLUDES identity/origin questions
    //    (name, creator, origin, built-by). Without these, "what's your name",
    //    "who built you" and "your origin" fell through to WEB SEARCH and JEXI
    //    couldn't answer her own identity. Match anywhere in the message, not
    //    just at the start ("hey JEXI, what's your name?" must land here too).
    if (/^(hello|hey|hi|sup|yo|howdy|good morning|good evening|what's up|wassup|how are you)\b|\b(who are you|what are you|what'?s your name|your name|who (built|made|created|designed|programmed|invented) you|who is your (creator|maker|father|mom|mum|mother|owner|boss)|your (origin|creator|maker|builder|father|mother|story)|where (are you from|do you come from|were you (born|created|made))|are you (a |an )?(bot|robot|ai|human|real|girl|boy|machine)|what are you (made of|built with|made from)|is your name|tell me about yourself|introduce yourself)\b/i.test(q)) {
      return { intent: 'conversation', tasks: ['memory'], reasoning: 'Conversation / identity question — JEXI answers her name, creator and origin directly.' };
    }

    // 8. Memory questions
    if (/what is my name|what do you remember|who am i|remember me/i.test(q)) {
      return { intent: 'memory_query', tasks: ['memory'], reasoning: 'User asks about memory.' };
    }

    // 8.5+9. Knowledge base recall — ONE search (books first, studied topics
    //     second). Questions mentioning the user's own books/library match with a
    //     lower bar (minScore 1); everything else needs minScore 2. Previously this
    //     ran the search twice for book questions — now it never re-scans the
    //     library twice for the same message.
    const bookish = /my books?|the books?|in the (book|pdf|library)|from the (book|pdf)|according to (the )?(book|pdf|textbook)|read (the|my) (book|pdf)|uploaded (book|pdf|files?)|knowledge library/i.test(q);
    try {
      const kb = searchKnowledge(query, bookish ? 1 : 2);
      if (kb.length > 0) {
        return {
          intent: 'knowledge_recall',
          tasks: ['reasoning', 'memory'],
          reasoning: bookish ? 'User is asking about their own books/library — answer from those materials.' : 'Found matching knowledge in the library.',
          payload: kb,
        };
      }
    } catch (e) {}

    // 8.7 Latest news, Twitter/X & trending → dedicated news pipeline
    if (/(latest|today'?s|breaking|top|headlines?|current)\s*(news|events|stories?)|news (about|on|regarding)|headlines|what'?s? trending|trending on|(latest|breaking) (news|story)|twitter (news|trending|posts|trends)|tweets? (about|on|regarding)|x (posts|tweets|threads?)\b/i.test(q)) {
      return { intent: 'news_latest', tasks: ['news', 'twitter', 'reasoner', 'memory'], reasoning: 'User wants the latest news / social updates.' };
    }

    // 8.8 DEEP-DOMAIN ROUTING — the round-4 roster: domain keywords route to
    //     their own specialist team instead of the generic research fallback,
    //     so the 200+ catalog is actually deployed per task (supervisor pattern:
    //     name the right team, never all of them).
    const domain = this._domainIntent(q);
    if (domain) return domain;

    // 8.9 FIELD ROUTING — the academic/scientific DomainRegistry (agentUniverse
    //     "domain prompts" / MasRouter field-routing pattern): a question about
    //     structural analysis, gene editing or orbital mechanics routes to the
    //     field's own specialist team instead of the generic research fallback.
    //     B52 P3 — EXPLICIT research/current-events cues beat field routing:
    //     "research the history of computer science" must run the RESEARCH
    //     pipeline, not collapse into a direct field answer.
    const strongResearchCue = /research|search|latest|breaking|news|sources|compare|deep dive|investigate|report on|current/i.test(q);
    const fields = matchDomains(q);
    if (fields.length && !strongResearchCue) {
      const primary = fields[0];
      const cross = fields.slice(1).filter((f) => f.family !== primary.family).slice(0, 3).map((f) => f.name);
      return {
        intent: `domain:${primary.id}`,
        tasks: [...primary.team],
        reasoning: `Field recognized: ${primary.name} (${primary.family})${cross.length ? ' + ' + cross.join(', ') : ''} — the ${primary.name} specialist team takes it.`,
        domains: fields.map((f) => f.id),
      };
    }

    // 8.95 DIRECT ANSWER (B51 P2) — simple definitional / factual questions
    //     that need no external evidence are answered directly from model
    //     knowledge + optional memory: NO web search, NO browser, NO study
    //     pipeline. Kept BEFORE the research fallback. Excluded when the
    //     question needs current/external data or explicitly asks to learn.
    const directAnswerQ = /^(what is|what are|what'?s|define|what does|what do|explain (briefly )?what|who is|who was|where is)\b/i.test(q.trim())
      || /\b(meaning of|definition of|capital of|what is the capital of|difference between)\b/i.test(q);
    const needsExternal = /weather|forecast|temperature|price|cost of|stock|share price|latest|breaking|news|score|result|election|president|prime minister|current (time|date)|traffic|live\b/i.test(q);
    const wantsLearning = /study|master|learn (everything|about|to)|research|search|find|look up|compare sources/i.test(q);
    if (directAnswerQ && !needsExternal && !wantsLearning) {
      return { intent: 'direct_answer', tasks: ['jexi', 'context-manager'], reasoning: 'Simple definitional/factual question — answered directly from knowledge, no web or study pipeline needed.' };
    }

    // 9. Research / search / facts (B52 P3 — narrowed: bare definitional
    //    questions are already direct_answer at 8.95 and must NEVER fall back
    //    into research. Research now requires real research cues: explicit
    //    search/research/current-events/multi-source language. Plain "what
    //    is…", "explain…", "meaning of…" without such cues are NOT research.)
    const isResearch = /search|research|find out|look up|google|when did|why does|how to|latest|breaking|news|current (events|affairs)|history of|deep dive|investigate|report on|sources|compare|compare sources|trends?|analy[sz]e|benefits of|types of|top \d|who was (the|a)|capital of [a-z ]+ \d/i.test(q);
    if (isResearch) {
      return { intent: 'research', tasks: ['search', 'browser', 'extractor', 'reasoner', 'memory'], reasoning: 'Needs current/verified information from the internet.' };
    }

    // 9.5 AUTONOMOUS ACTION — a personal task phrased as a want/need WITHOUT a
    //     build verb ("I want to track my water intake", "remind me to drink
    //     water", "I need a todo list") is a BUILD, not a question. JEXI acts
    //     by herself and reports the result — she never stops to ask
    //     "want me to?" when the request is clearly a task.
    if (!/(build|create|make|write|develop|code)\b/i.test(q)) {
      const wantsTask = /i (want|need|would like|'d like|wanna|wish)\b|track |tracker|remind me|manage my|organize my|store my|monitor my|keep track|log my|budget my|save my|todo|to-do|planner|calculator|dashboard for|app for|website for|game about/i.test(q);
      const asksToLearn = /understand|learn (about|how)|explain|tell me about|how (does|do|is|can)|what is|meaning of/i.test(q);
      if (wantsTask && !asksToLearn) {
        const nudge = await this.analyzeIntent(`${query} — please build an app for it now`);
        if (nudge.intent === 'code_task' || nudge.intent === 'compound_task') return nudge;
      }
    }

    // 10. Default: learning research
    return { intent: 'learning_research', tasks: ['research', 'reasoning', 'memory'], reasoning: 'General question — research and answer.' };
  }

  /**
   * Deep-domain routing (round-4 roster): regex → intent for the teams that
   * handle whole domains autonomously — writing, business, marketing, events,
   * meals, workouts, investing, support, security, content, exams, careers,
   * relationships, startups, productivity, ML, cloud, mobile and games.
   * Build phrasings still flow to the coding team via isCoding() (checked
   * earlier) — these rules catch the domain requests around them.
   */
  _domainIntent(q) {
    const rules = [
      [/write (me |a |an )?(story|novel|book|short story)|write (a |an )?(screenplay|poem|song|lyrics)|story (idea|plot|outline)|novel (idea|outline)|poetry|creative writing|book (idea|outline|plot)/i, { intent: 'creative_writing', tasks: ['novelist', 'screenwriter', 'editor', 'critic'], reasoning: 'Creative writing request — the writing team drafts, edits and critiques.' }],
      [/business plan|business idea|business model|startup pitch|pitch (an |my |the )?idea|company plan|write a (business|company) plan/i, { intent: 'business_plan', tasks: ['business-analyst', 'startup-advisor', 'financial-advisor'], reasoning: 'Business planning — the analyst team builds the plan with financials.' }],
      [/marketing (plan|strategy|campaign|ideas?)|ad campaign|seo (plan|strategy|campaign)|social media (strategy|plan|campaign)|growth strategy|promote (my|the) (app|business|product|site|website)/i, { intent: 'marketing_plan', tasks: ['market-analyst', 'growth-marketer', 'seo-specialist'], reasoning: 'Marketing planning — the growth team builds the campaign.' }],
      [/plan (a |an |my |our )?(party|wedding|event|birthday|graduation|conference|dinner|gathering)|organi[sz]e (a |an |my |our )?(party|event|wedding|dinner)|event planning/i, { intent: 'event_planning', tasks: ['event-planner', 'wedding-planner', 'travel'], reasoning: 'Event planning — the events team handles logistics and budget.' }],
      [/meal (plan|ideas?|prep)|what should (i|we) (cook|eat|make) (for )?(dinner|lunch|breakfast)|dinner ideas|recipe (ideas?|for)|meal prep/i, { intent: 'meal_plan', tasks: ['chef', 'nutrition', 'health'], reasoning: 'Meal planning — the chef and nutritionist build the menu.' }],
      [/workout (plan|routine|schedule)|exercise (plan|routine)|gym (routine|plan)|training (plan|program|split)|get (in shape|fit)|fitness plan/i, { intent: 'workout_plan', tasks: ['fitness', 'health', 'nutrition'], reasoning: 'Fitness planning — the trainer builds the program.' }],
      [/invest(ing|ment)? (in|my|money)|portfolio (advice|help|rebalance)|stocks (to buy|advice)|save for retirement|401k|roth ira|should i (buy|invest)/i, { intent: 'investing_advice', tasks: ['investor', 'financial-advisor', 'tax-advisor'], reasoning: 'Investing guidance — the finance team advises on the money.' }],
      [/my (app|phone|laptop|computer|pc|wifi|printer|tv|camera|speaker|headphones) (is|has|keeps|won['’]?t) (broken|not working|glitch|crash|slow|freez|turn (on|off)|connect|start|charge|install)|help me (fix|troubleshoot)|troubleshoot(ing)? (my|this)|error message when|why (is|does) (my|the) (app|phone|laptop|computer) (not|won['’]?t)|keeps crashing/i, { intent: 'tech_support', tasks: ['support-engineer', 'debugger', 'coder'], reasoning: 'Tech support — the support engineer troubleshoots the problem.' }],
      [/(hack|pentest|pen[- ]test|security (audit|review|check)|audit (my|the|our) (app|site|code|system)|vulnerabilit(y|ies) (scan|check)|test (my|the|our) security|is (my|the|our) (app|site|code) secure)/i, { intent: 'security_audit', tasks: ['pentester', 'security', 'appsec'], reasoning: 'Security audit — the red-team specialists probe and report.' }],
      [/content (calendar|plan|strategy|ideas)|blog (post|idea|outline|topic)|youtube (script|idea|outline|video)|newsletter (issue|idea|outline)|write content (for|about)|content ideas/i, { intent: 'content_creation', tasks: ['content-strategist', 'blog-writer', 'seo-writer', 'video-script-writer'], reasoning: 'Content creation — the content team plans and writes it.' }],
      [/career (advice|plan|change|path|move)|job (search|hunt|application|interview)|find (a |me )?job|career goals|switch careers|get (a |hired for a )?job|career coach/i, { intent: 'career_plan', tasks: ['career', 'recruiter', 'resume'], reasoning: 'Career planning — the career team maps the path.' }],
      [/relationship (advice|help|problem|issues?)|my (boyfriend|girlfriend|husband|wife|partner|fianc[ée])|marriage advice|dating (advice|help)|how do i (ask|tell|talk to) (my|him|her)|i (like|love) someone/i, { intent: 'relationship_advice', tasks: ['relationship-coach', 'counselor', 'dating-coach'], reasoning: 'Relationship guidance — the coaching team helps.' }],
      [/my startup|i have a (business|startup) idea|should i (start|found) a company|fundrais(ing|e)|raise (money|funding|capital)|seed round|mvp (for|plan)|product[- ]market[- ]fit/i, { intent: 'startup_advice', tasks: ['startup-advisor', 'business-analyst', 'pricing-strategist'], reasoning: 'Startup advice — the founder team plans the launch.' }],
      [/organi[sz]e my (day|week|schedule|tasks|todo)|plan my (week|day|schedule)|get organized|productivity (tips|plan|system)|time management|manage my (tasks|time|schedule)|daily (routine|schedule)/i, { intent: 'productivity', tasks: ['task-manager', 'scheduler', 'note-taker'], reasoning: 'Productivity — the ops team organizes the plan.' }],
      [/(train|build|fine[- ]?tune) (a|an|my|the) (ml|machine learning|ai|model|classifier|recommendation|chatbot model)|machine learning (model|project)|data science (project|model|analysis)|predict(ion)? model/i, { intent: 'data_ml', tasks: ['data-scientist', 'ml-engineer', 'ml-ops'], reasoning: 'ML/data task — the science team builds and evaluates the model.' }],
      [/(kubernetes|k8s|terraform|aws |gcp |azure |cloud (architecture|setup)|infrastructure (as code|design)|cluster)/i, { intent: 'cloud_devops', tasks: ['cloud-engineer', 'kubernetes-engineer', 'terraform-engineer', 'sre'], reasoning: 'Cloud/infra task — the platform team designs the infrastructure.' }],
      [/(api (design|architecture|contract|schema|endpoint)|graphql (schema|design)|openapi|rest api (design|structure)|how should i (structure|design) (my|the|an) api)/i, { intent: 'api_backend', tasks: ['api-engineer', 'auth-engineer', 'backend'], reasoning: 'API design — the API team architects the contract.' }],
      [/(android|iphone|ios|react native|flutter|mobile app|app store|play store|publish (my|the) app)/i, { intent: 'mobile_app', tasks: ['mobile-engineer', 'ios-engineer', 'android-engineer', 'react-native-engineer'], reasoning: 'Mobile task — the mobile team builds for the platform.' }],
      [/game (design|mechanics|idea|concept|dev)|unity (game|project)|unreal (engine|game)|make (a |my )?game (better|more fun)|game developer/i, { intent: 'game_dev', tasks: ['game-developer', 'designer', 'coder'], reasoning: 'Game task — the game team designs and builds it.' }],
      [/decorate (my|the) (room|house|home|apartment)|interior design|organi[sz]e (my|the) (room|house|closet|garage)|declutter|home (setup|improvement)|gardening|garden (plan|ideas|design)/i, { intent: 'home_life', tasks: ['home-org', 'interior-designer', 'gardener'], reasoning: 'Home/life task — the home team plans the space.' }],
      [/(legal|contract|agreement|terms of service|privacy policy|non[- ]disclosure|\bnda\b|lease|draft (a|an|my|the) (contract|agreement|lease|terms)|compliance review|intellectual property|trademark|copyright)/i, { intent: 'legal_task', tasks: ['legal-drafter', 'negotiator', 'legal'], reasoning: 'Legal task — the legal team drafts documents and gives plain-language guidance.' }],
    ];
    for (const [re, res] of rules) {
      if (re.test(q)) return res;
    }
    return null;
  }

  isCoding(q) {
    const buildVerbs = /(write|build|create|make|develop|fix|debug|refactor|implement|generate|code|program|design|plan|need|want)/i;
    const codeNouns = /\b(python|javascript|js|typescript|ts|react|node(\.js)?|html|css|java|c\+\+|c#|go|rust|sql|bash|shell|script|function|class|api|server|program|app(lication)?|website|web ?page|web ?app|code|regex|pipeline|scraper|bot|component|database|endpoint|calculator|game|quiz|dashboard|tool|plugin|extension|landing page|portfolio|template|form|notebook|planner|tracker|manager|reminder|timer|stopwatch|converter|generator|finder|logger|monitor|notes?|todo|habit|budget|finance)\b/i;
    // Natural phrasings: "I need an app…", "I want a website…", "build me a calculator…"
    const wantDeliverable = /\b(i (need|want)|i'?d like|can you (build|make|create|write)|help me (build|make|create|write)|need (a|an)|want (a|an)|build me|make me|create (a|an)|build (a|an)|make (a|an))\b/i;
    const deliverable = /\b(app(lication)?|website|web ?app|web ?page|game|quiz|calculator|dashboard|tool|bot|plugin|extension|landing page|portfolio|template|scraper|script|planner|tracker|manager|reminder|timer|stopwatch|converter|generator|finder|logger|monitor|notes?|todo|habit|budget|finance|panel|page|form|screen)\b/i;
    return (buildVerbs.test(q) && codeNouns.test(q)) ||
      (wantDeliverable.test(q) && deliverable.test(q)) ||
      /```[\s\S]*```/i.test(q) || // user pasted code
      /(\berrors?\b|traceback|exception|syntax ?error|debug this code|code is broken|doesn'?t work|not working|fix this|fix the code|\bdebug\b)/i.test(q);
  }
}

export const planner = new Planner();
