import { searchKnowledge } from './MemoryManager.js';

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

/** Which specialists run, in order, for each intent (the "plan first" contract). */
const TEAM_PLAN = {
  image_recognition: ['Vision', 'Reasoner', 'Memory Agent'],
  clear_memory: ['Memory Agent'],
  link_analysis: ['Navigator', 'Extractor', 'Reasoner', 'Memory Agent'],
  math_solve: ['Reasoner', 'Memory Agent'],
  self_check: ['SelfDiagnose', 'Reasoner', 'Memory Agent'],
  code_task: ['Product', 'Designer', 'Engineer', 'Coder', 'Runner', 'Debugger', 'QA Lead', 'Reviewer', 'Security Officer', 'Shipper', 'Reflector'],
  computer_use: ['Navigator', 'Vision', 'Reasoner', 'Memory Agent'],
  study_topic: ['Scholar', 'Researcher', 'Memory Agent'],
  conversation: ['JEXI'],
  memory_query: ['Memory Agent'],
  knowledge_recall: ['Books', 'Reasoner', 'Memory Agent'],
  news_latest: ['News Scout', 'News Filter', 'News Editor', 'Reasoner', 'Memory Agent'],
  research: ['Query Analyzer', 'Searcher', 'Re-ranker', 'Extractor', 'Synthesizer', 'Memory Agent'],
  learning_research: ['Researcher', 'Reasoner', 'Memory Agent'],
  explain_team: ['Planner'],
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
];

export class Planner {
  /** Classify the intent (fast, deterministic, free) then attach the team plan. */
  async analyzeIntent(query, opts = {}) {
    const plan = await this._classify(query, opts);
    // Decorate every plan with the ordered specialist team ("plan first")
    if (plan.intent === 'compound_task') {
      plan.steps = (plan.phases || []).flatMap((p) => p.agents);
    } else {
      plan.steps = TEAM_PLAN[plan.intent] || plan.tasks || [];
    }
    plan.planSummary = plan.steps.join(' → ');
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

    // 3. Math detection — symbols, formulas, calculations, word problems
    //    (checked BEFORE coding: "calculate" etc. is math unless it's a build request)
    const mathHints = /(calculate|compute|solve|integrate|derivative|differentiate|sum of|multiply|divide|sqrt|square root|equation|formula|math|algebra|calculus|geometry|trigonometry|percentage|what is \d|\d+\s*[+\-×÷*\/]\s*\d|\^2|\$\$)/i;
    if (mathHints.test(q) && !this.isCoding(scopedQuery)) {
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

    // 6. Coding / programming — the FULL AGENT TEAM plans, builds, QA-tests and ships.
    //    Checked BEFORE study/research so "build me a study planner", "an app to
    //    track habits", "/team build…" and "/careful check my code" all land here
    //    (slash commands are stripped first — isCoding tests the scopedQuery).
    if (this.isCoding(scopedQuery)) {
      return { intent: 'code_task', tasks: ['architect', 'coder', 'runner', 'debugger', 'qa', 'reviewer', 'memory'], reasoning: 'Coding task — the team: product → designer → engineer → coder → QA → reviewer → shipper.', scope, query: scopedQuery };
    }

    // 6.4 COMPUTER USE — the user wants JEXI to DRIVE the browser (navigate,
    //    click, type, interact), not just search. Checked after coding (so
    //    "build a web scraper" still hits the team) and before research (so
    //    "use the browser to find…" actually drives the browser instead of
    //    falling into the text-search pipeline).
    const SITES = 'wikipedia|google|youtube|amazon|github|stack ?overflow|reddit|twitter|facebook|instagram|netflix|spotify|apple|microsoft|bbc|cnn|nytimes|duckduckgo|bing';
    const browserDriving = new RegExp(
      'use (the |your |a )?(browser|computer|desktop)|' +
      'browse the web|' +
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

    // 6.5 Study / deep learn (AFTER coding so "study planner" apps aren't hijacked)
    if (/study|learn everything about|fill knowledge base|master topic|teach me (everything about )?/i.test(q)) {
      const topic = query.replace(/study|learn everything about|fill knowledge base|master topic|teach me/i, '').trim().replace(/^about\s+/i, '');
      return { intent: 'study_topic', tasks: ['scholar', 'research', 'memory'], reasoning: 'User wants JEXI to deep-study and store in the knowledge library.', payload: topic };
    }

    // 7. Greetings & pure conversation
    if (/^(hello|hey|hi|sup|yo|howdy|good morning|good evening|what's up|wassup|who are you|what are you|who made you|who created you)\b/i.test(q)) {
      return { intent: 'conversation', tasks: ['memory'], reasoning: 'Conversation / identity question.' };
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

    // 9. Research / search / facts
    const isResearch = /search|research|find|look up|google|what is|who is|when did|where is|why does|how to|explain|latest|news|history|capital|population|meaning|difference between|benefits of|types of|top \d/i.test(q);
    if (isResearch) {
      return { intent: 'research', tasks: ['search', 'browser', 'extractor', 'reasoner', 'memory'], reasoning: 'Needs current/verified information from the internet.' };
    }

    // 10. Default: learning research
    return { intent: 'learning_research', tasks: ['research', 'reasoning', 'memory'], reasoning: 'General question — research and answer.' };
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
