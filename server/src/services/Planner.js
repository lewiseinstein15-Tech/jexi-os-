import { searchKnowledge } from './MemoryManager.js';
import { AGENT_ROSTER, getAgent, skillsForTeam, rosterStats } from './AgentRoster.js';
import { toolsForTeam } from './ToolRegistry.js';

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
 * SLUGS, not display names — resolved to roster entries by getAgent(). */
const TEAM_PLAN = {
  image_recognition: ['vision', 'reasoner', 'memory'],
  clear_memory: ['memory'],
  link_analysis: ['navigator', 'extractor', 'reasoner', 'memory'],
  math_solve: ['math', 'reasoner', 'memory'],
  self_check: ['self-diagnose', 'reasoner', 'memory'],
  code_task: ['product', 'designer', 'engineer', 'architect', 'coder', 'runner', 'debugger', 'qa', 'reviewer', 'critic', 'security', 'shipper', 'reflector'],
  computer_use: ['navigator', 'vision', 'reasoner', 'memory'],
  study_topic: ['scholar', 'researcher', 'document-analyst', 'memory'],
  conversation: ['jexi', 'context-manager', 'archivist'],
  memory_query: ['memory', 'archivist', 'context-manager'],
  knowledge_recall: ['books', 'document-analyst', 'reasoner', 'memory'],
  news_latest: ['news-scout', 'news-filter', 'news-editor', 'reasoner', 'memory'],
  research: ['query-analyzer', 'searcher', 'reranker', 'extractor', 'synthesizer', 'fact-checker', 'critic', 'memory'],
  learning_research: ['researcher', 'reasoner', 'memory'],
  explain_team: ['planner'],
  github: ['github', 'shipper'],
  translate: ['translator', 'reviewer'],
  data: ['data', 'data-engineer', 'reasoner'],
  devops: ['devops', 'shipper'],
  docs: ['writer', 'reviewer'],
  perf: ['perf', 'coder', 'reviewer'],
  // Round 4 — deep-domain teams: each new intent routes to its own specialists,
  // so the 200+ roster is actually USED (AutoGen GroupChatManager / LangGraph
  // supervisor pattern: the planner names the right team, never all of them).
  creative_writing: ['novelist', 'screenwriter', 'poet', 'songwriter', 'editor', 'critic'],
  business_plan: ['business-analyst', 'startup-advisor', 'financial-advisor', 'market-analyst', 'strategist'],
  marketing_plan: ['market-analyst', 'growth-marketer', 'seo-specialist', 'copywriter', 'brand'],
  event_planning: ['event-planner', 'wedding-planner', 'travel', 'finance'],
  meal_plan: ['chef', 'nutrition', 'health'],
  workout_plan: ['fitness', 'health', 'nutrition'],
  investing_advice: ['investor', 'financial-advisor', 'tax-advisor'],
  tech_support: ['support-engineer', 'debugger', 'coder', 'writer'],
  security_audit: ['pentester', 'security', 'appsec', 'risk-analyst'],
  content_creation: ['content-strategist', 'blog-writer', 'seo-writer', 'video-script-writer', 'editor'],
  study_exam: ['exam-coach', 'study', 'teacher', 'flashcard-maker'],
  career_plan: ['career', 'recruiter', 'resume', 'interviewer'],
  relationship_advice: ['relationship-coach', 'counselor', 'dating-coach'],
  startup_advice: ['startup-advisor', 'business-analyst', 'pricing-strategist', 'investor'],
  productivity: ['task-manager', 'scheduler', 'note-taker', 'email-triage'],
  data_ml: ['data-scientist', 'ml-engineer', 'ml-ops', 'data-engineer'],
  cloud_devops: ['cloud-engineer', 'kubernetes-engineer', 'terraform-engineer', 'sre', 'devops'],
  api_backend: ['api-engineer', 'auth-engineer', 'backend', 'database'],
  mobile_app: ['mobile-engineer', 'ios-engineer', 'android-engineer', 'react-native-engineer', 'qa'],
  game_dev: ['game-developer', 'designer', 'coder', 'qa'],
  home_life: ['home-org', 'interior-designer', 'event-planner', 'gardener'],
};

/** "gather news/research/study, THEN build" → the compound team, run in phases. */
const COMPOUND_DETECT = [
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

    // 0. Image given → vision recognition
    if (hasImage) {
      return { intent: 'image_recognition', tasks: ['vision', 'reasoning', 'memory'], reasoning: 'User provided an image to analyze.', payload: opts.image };
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

    // 1. Clear memory
    if (/clear (all )?memory|forget everything|wipe memory|delete memory/i.test(q)) {
      return { intent: 'clear_memory', tasks: ['memory'], reasoning: 'User wants to wipe memory.' };
    }

    // 2. Any link in the message → analyze it (YouTube, TikTok, Instagram, article, any site)
    const linkMatch = query.match(/https?:\/\/[^\s)'"]+/i);
    if (linkMatch && !/http:\/\/localhost|127\.0\.0\.1|\.onion/i.test(linkMatch[0])) {
      return { intent: 'link_analysis', tasks: ['browser', 'extractor', 'reasoning', 'memory'], reasoning: 'User shared a link — JEXI will open it with the browser and summarize.', payload: { url: linkMatch[0], fullQuery: query } };
    }

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

    // 9. Research / search / facts
    const isResearch = /search|research|find|look up|google|what is|who is|when did|where is|why does|how to|explain|latest|news|history|capital|population|meaning|difference between|benefits of|types of|top \d/i.test(q);
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
