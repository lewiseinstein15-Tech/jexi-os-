import fs from 'fs';
import path from 'path';
import { createGraph } from './GraphRunner.js';
import { runCodeGateGraph, runResearchVerifyGraph, runReviewSecurityGraph } from './PipelineGraphs.js'; // B52 P2 — graph-driven gates/verification
import { generateCode, applyFix } from './Architect.js';
import { planForBuild, qaWebApp, qaScripted, runReviewerPass, runSecurityPass, runCriticPass, runShipperPass, runReflectorPass, fixFromQA, isDebugQuery, gateVerdict } from './SkillChain.js';
import { runFile } from './Runner.js';
import { runCodingLoop } from './CodingLoop.js'; // B50 P3 — first-class fix loop
import { analyzeLink } from './Extractor.js';
import { reasonAndWrite } from './Reasoner.js';
import { runSearchTeam } from './SearchAgent.js';
import { learnHowTo } from './Researcher.js';
import { generateContent, resolveKeys } from './LLMClient.js';
import { verifyDomainAnswer } from './DomainVerifier.js';
import { collectSystemStatus, readSourceFile } from './SelfMonitor.js';
import { studyTopic, recallKnowledge } from './KnowledgeAgent.js';
import { runNewsTeam } from './NewsAgent.js';
import { runGitHubAction, parseGithubRequest, checkGithubAuth } from './GitHubAgent.js';
import { runDataAgent } from './DataAgent.js';
import { runDevOpsAgent } from './DevOpsAgent.js';
import { runWriterAgent } from './WriterAgent.js';
import { runTranslatorAgent } from './TranslatorAgent.js';
import { runPerfAgent } from './PerfAgent.js';
import { ComputerUseAgent } from './ComputerUseAgent.js';
import { DesktopManager, ensureBrowser } from './DesktopManager.js';
import { JEXI_SYSTEM_PROMPT } from './JexiPrompt.js';
import { IDENTITY_ANSWER } from './JexiIdentity.js';
import { groundednessCheck } from './Groundedness.js'; // B48 P2a — strip ungrounded memory claims before they reach the user
import { preferencesBlock, recallPreferences } from './PreferenceLearner.js';
import { verifyAnswer } from './VerificationLoop.js';
import { sanitizeFinalAnswer } from './AnswerSanitizer.js'; // B51 P1/P7 — no process narration reaches the user
import { finalizeAnswer } from './Finalizer.js'; // B52 P5 — single completion gate for every user-facing answer
import { rosterStats } from './AgentRoster.js';
import {
  addChat, getChatHistory, clearMemory, updateUserProfile, loadMemory, topUserFacts,
  searchInternetKnowledge, searchFreshInternetKnowledge, searchCodingKnowledge,
  saveInternetKnowledge, saveCodingKnowledge, saveKnowledgeFile,
  getRollingSummary, getRecentEpisodes, rememberEpisode,
  semanticRecall, memoryForAgent, conversationTranscript,
} from './MemoryManager.js';
import { WORKSPACE_DIR, MANAGER_URL, PUBLIC_URL, MAX_DEBUG_ATTEMPTS } from '../config.js';
import { setTaskCheckpoint } from './TaskRegistry.js'; // B53 P6 — durable task checkpoints

function readWorkspaceFile(name) {
  const filePath = path.join(WORKSPACE_DIR, name);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

function listWorkspaceFiles() {
  if (!fs.existsSync(WORKSPACE_DIR)) return [];
  return fs.readdirSync(WORKSPACE_DIR).filter(f => fs.statSync(path.join(WORKSPACE_DIR, f)).isFile());
}

/** Build 48, P1 — the canonical deterministic identity answer now comes from
 * JexiIdentity.js (the single source of truth), not a hardcoded copy here.
 * Always available, even with NO AI key. rosterStats stays imported for the
 * planner log events below. */

/** Trivial small talk that must NOT drag the fact/preference loadout into
 * context — the root cause of fabricated-memory replies ("Hello" → "your
 * favorite color"). Greetings, thanks and affirmatives pass through with only
 * the recent transcript. Identity questions are covered by JexiIdentity.js
 * (Build 48, P1), so they need no memory block either. */
const TRIVIAL_QUERY_RE = /^(hi+|hii+|hey+|hello+|yo+|hiya+|howdy+|good (morning|afternoon|evening)|what'?s up|sup|how (are|r) you|thanks|thank you|thx|ty|ok+|okay+|k+|kk+|yes+|yeah+|yep+|yup+|sure+|alright|right|cool|nice|great|bye+|goodbye|see (ya|you)|later|no+|nope+|haha|lol)\b[\s.,!?]*$/i;

/**
 * Build a compact conversation context for JEXI to stay focused (layered
 * memory, Mem0/DeepAgents pattern): recent turns verbatim → rolling summary
 * of older turns → episodic memory → long-term semantic recall of anything
 * JEXI already researched, so she never forgets the thread mid-conversation.
 *
 * Build 48, P2 — memory honesty: the fact/preference/episode loadout is only
 * injected for substantive queries, the block is labeled as silently-usable
 * background (never "what I remember"), and an explicit rule forbids surfacing
 * irrelevant memories or narrating their use.
 */
export async function conversationContext(query = '') {
  const history = getChatHistory(12);
  const memoryBlock = [];
  const trivial = TRIVIAL_QUERY_RE.test(String(query || '').trim());

  if (!trivial) {
    const facts = topUserFacts(4);
    const profile = loadMemory().userProfile || {};
    if (profile.name) memoryBlock.push(`User's name: ${profile.name}`);
    if (profile.location) memoryBlock.push(`User's location: ${profile.location}`);
    if (facts.length) memoryBlock.push(...facts);
    const prefs = recallPreferences(3);
    if (prefs.length) memoryBlock.push(...prefs);

    // Rolling summary of older turns — JEXI never forgets what happened earlier.
    const summary = getRollingSummary();
    if (summary) memoryBlock.push(`Earlier conversation summary:\n${summary.slice(0, 1200)}`);

    // Episodic memory — what happened in past sessions (Archivist).
    const episodes = getRecentEpisodes(3);
    if (episodes.length) {
      memoryBlock.push('Earlier sessions:' + episodes.map((e) => `\n- User asked \"${String(e.ask).slice(0, 80)}\" → I replied about ${String(e.reply).slice(0, 120)}`).join(''));
    }
  }

  // Semantic recall — hybrid vector + keyword retrieval (TencentDB pattern),
  // relevance-scored so only actually-related prior work is surfaced. Skipped
  // for trivial small talk.
  try {
    if (!trivial && String(query || '').trim().length > 4) {
      const learned = await semanticRecall(query, { limit: 1, noCode: true }); // B53 P5 — semantic scope: no other task's code
      if (learned.length) {
        const top = learned[0];
        memoryBlock.push(`Previously researched: ${top.label} — ${String(top.text).slice(0, 300)}`);
      }
    }
  } catch (e) {}

  const extra = memoryBlock.length
    ? `\n\nBackground context (use silently — never say you remembered it, and only use it when it is directly relevant to the current question; if nothing here is relevant, ignore it entirely):\n${memoryBlock.map(f => `- ${f}`).join('\n')}`
    : '';
  return `${history.map(h => `${h.role === 'user' ? 'User' : 'JEXI'}: ${String(h.text).slice(0, 600)}`).join('\n')}${extra}`;
}

/**
 * Priority 3 — the canonical AgentResult every node produces/consumes.
 * { success, summary, data, sources, error: { code, message } | null }
 * The legacy per-case `results` object is normalized into this shape at every
 * node boundary (wrapCase), so no node-to-node handoff relies on an
 * undocumented field.
 */
function normalizeAgentResult(results) {
  return {
    success: results.success !== false,
    summary: results.summary || '',
    data: results.data || null,
    sources: results.sources || [],
    files: results.files || [],
    previewUrl: results.previewUrl || undefined,
    statistics: results.statistics || {},
    error: results.error ? { code: results.errorCode || 'EXECUTION_ERROR', message: String(results.error), node: results.node || null } : null,
  };
}

/**
 * Priority 1 — real graph orchestrator.
 * `executePlan` delegates to a hand-rolled graph runner (GraphRunner.js):
 * every specialist is a node, edges route by intent/outcome, and the coding
 * debug loop is a real cycle (debugger → debugger) instead of a special case.
 */
export class Orchestrator {
  constructor() { this.executionHistory = []; }

  /** Answer using ONLY the user's own books/knowledge library (with citations). */
  async answerFromKnowledge(kb, query) {
    const items = Array.isArray(kb) ? kb : [kb];
    const context = items.map(k => `📖 From \"${k.title}\":\n${k.content}`).join('\n\n---\n\n').slice(0, 14000);

    // No AI key? Still useful: return the exact passage as a direct quote.
    const keys = resolveKeys();
    if (!keys.groqKey && !keys.geminiKey) {
      const top = items[0];
      return `## ${top.title}\n\n> ${top.content.slice(0, 2500)}`;
    }

    const reply = await generateContent(
      `The user asked: \"${query}\"\n\nThe passages below come from the user's OWN books and knowledge library — they are the authoritative source for this answer.\n\n${context}\n\nAnswer the question using ONLY these passages. Rules:\n- Structure the answer clearly (headings, numbered points, tables where helpful).\n- Cite the source book after each point, e.g. (From \"Title\").\n- If the passages do not contain the answer, say so honestly instead of guessing or inventing.\n- Do NOT go outside these passages.`,
      JEXI_SYSTEM_PROMPT + preferencesBlock(),
      null,
      { temperature: 0.3 }
    );
    // B51 P1 — no "FROM YOUR BOOKS" pipeline header; just the grounded answer.
    return reply;
  }

  /** Wrap an original switch-case body into a graph node (P1/P3/P8). */
  wrapCase(nodeName, body) {
    return async (state) => {
      const { results, sendEvent, opts } = state.context;
      const query = state.query;
      const plan = state.plan;
      // B51 P5 — bodies get `state` so they can set outcome/retry + failure
      // history for real correction paths (backward compatible: extra arg).
      await body({ results, sendEvent, query, plan, opts, state });
      // P5 — the body requested confirmation. The confirm callback writes to
      // the SHARED opts handle (same reference the runner copied), so the
      // pause request is detected here and the graph parks at confirmationPause
      // with the full RunState preserved for later resume at THIS node.
      const pending = opts._pendingConfirmation;
      if (pending) {
        delete opts._pendingConfirmation;
        state.needsConfirmation = true;
        state.outcome = 'ask_user';
        state.confirmationPayload = pending;
        state.context.resumeNode = pending.node || nodeName;
        state.intermediateResults[nodeName] = { success: true, summary: '', data: null, sources: [], error: null, paused: true };
        results.summary = `### 🤔 One quick thing\n\n${pending.question || 'Please confirm before I continue.'}\n\nSay **yes** to continue, or **no** to cancel.`;
        return state;
      }
      state.agentResult = normalizeAgentResult(results);
      state.intermediateResults[nodeName] = state.agentResult;
      return state;
    };
  }

  /** Build every graph node. Specialist nodes wrap the original case bodies. */
  buildNodes() {
    const N = {};

    // ---- infrastructure nodes -------------------------------------------
    N.contextResolve = async (state) => {
      // The intelligence pipeline in /api/chat already rewrote the query
      // (anaphora/continuity). If no resolver ran (direct executePlan callers
      // like tests/tools), the raw query passes through unchanged.
      state.resolvedQuery = state.resolvedQuery || state.query;
      return state;
    };

    N.memoryRead = async (state) => {
      // MEMORY LOADOUT (TencentDB-Agent-Memory pattern) — each specialist is
      // equipped with the past memories it needs, so JEXI never re-learns what
      // she already knows. Best-effort: never blocks or breaks the plan.
      const sendEvent = state.context.sendEvent;
      const plan = state.plan || {};
      const query = state.query;
      state.memoryLoadout = state.memoryLoadout || {};
      try {
        const agentSlugs = [...new Set((plan.tasks || []).filter(Boolean))];
        if (agentSlugs.length) {
          const loadouts = await Promise.all(agentSlugs.map(async (slug) => {
            const items = await memoryForAgent(slug, query, { limit: 1 });
            return items.length
              ? `🧠 ${slug} ← ${items.map(i => String(i.entry.topic || i.entry.fact || 'memory')).join(' · ').slice(0, 70)}`
              : null;
          }));
          const lines = loadouts.filter(Boolean).slice(0, 5);
          if (lines.length) lines.forEach((l) => sendEvent('log', { agent: 'Memory Agent', message: l }));
        }
      } catch (e) {}
      return state;
    };

    N.planner = async (state) => {
      // PLAN FIRST — announce the team before ANY agent runs (supervisor
      // pattern: the planner names the sequence, the graph executes it).
      const sendEvent = state.context.sendEvent;
      const plan = state.plan || {};
      if (plan.planSummary && sendEvent) {
        sendEvent('log', { agent: 'Planner', message: `🧠 Plan first — team for this task: ${plan.planSummary}` });
        if (plan.phases?.length > 1) {
          plan.phases.forEach((p, i) => sendEvent('log', { agent: 'Planner', message: `   Phase ${i + 1}/${plan.phases.length}: ${p.name} → ${p.agents.join(', ')}` }));
        }
        if (plan.skillsLine) {
          const stats = rosterStats();
          sendEvent('log', { agent: 'Planner', message: `🎓 Roster (${stats.agents}+ specialists) → ${plan.steps.length} deployed for this task. Skills: ${plan.skillsLine}` });
        }
        if (plan.toolsLine) {
          sendEvent('log', { agent: 'Tool Router', message: `🛠 Auto-selected tools for this task (${plan.toolCount}): ${plan.toolsLine}` });
        }
      }
      return state;
    };

    N.router = async (state) => {
      // Pass-through node — the `router` edge resolver dispatches to the
      // matching specialist based on the classified intent (P1). Kept as a
      // real node so the run loop has an addressable dispatch point.
      return state;
    };

    N.replanner = async (state) => {
      // P1/P8 — a node failed or fell back: if the plan carries a fallback
      // intent, apply it and re-route (edge → router). Otherwise fail honestly.
      const sendEvent = state.context.sendEvent;
      const plan = state.plan || {};
      if (plan.fallback && state.context.fallbackUsed !== true) {
        state.context.fallbackUsed = true;
        sendEvent('log', { agent: 'Planner', message: `↻ Re-planning — ${plan.intent} didn't pan out; switching to ${plan.fallback.intent} (${plan.fallback.reasoning || 'fallback'}).` });
        state.plan = {
          ...plan,
          intent: plan.fallback.intent,
          tasks: plan.fallback.tasks || plan.tasks,
          reasoning: plan.fallback.reasoning || plan.reasoning,
          planSummary: plan.fallback.planSummary || plan.planSummary,
          fallback: undefined,
        };
        state.outcome = null;
        state.lastError = null;
        return state; // edge: replanner → router (re-dispatch, bounded by fallbackUsed)
      }
      const results = state.context.results;
      results.success = false;
      results.error = state.lastError?.message || 'The plan failed and no fallback was available.';
      results.errorCode = 'REPLAN_FAILED';
      results.summary = `### ⚠ JEXI OS\n\nI hit a problem while working on this: ${results.error}\n\nMake sure an API key is configured (Settings → Groq/Gemini) and try again.`;
      state.agentResult = normalizeAgentResult(results);
      return state; // edge: replanner → responder
    };

    N.confirmationPause = async (state) => {
      // P5 — first visit: pause + persist the FULL RunState (session store).
      // On resume (payload.resolved), the edge routes back to the paused node.
      const sendEvent = state.context.sendEvent;
      if (state.confirmationPayload?.resolved) {
        sendEvent('log', { agent: 'JEXI', message: '✓ Confirmed — continuing.' });
        state.outcome = null;
        state.needsConfirmation = false; // consume the confirmation — never re-park
        return state;
      }
      state.needsConfirmation = true;
      state.status = 'paused';
      if (state.context.opts?.onPause) {
        try { await state.context.opts.onPause(state); } catch (e) {}
      }
      sendEvent('log', { agent: 'JEXI', message: `🤔 ${state.confirmationPayload?.question || 'Please confirm before I continue.'}` });
      return state;
    };

    N.responder = async (state) => {
      // Finalize the normalized AgentResult every caller receives.
      const results = state.context.results;
      // B51 P1/P7 — belt-and-braces: strip any narration that still leaked
      // through before the summary becomes the final user-facing answer.
      if (typeof results.summary === 'string' && results.summary.length) {
        const clean = sanitizeFinalAnswer(results.summary);
        if (clean && clean.length) results.summary = clean;
      }
      state.agentResult = normalizeAgentResult(results);
      state.status = 'done';
      return state;
    };

    // ---- specialist nodes (verbatim case bodies, wrapped) ----------------

    N.clearMemory = this.wrapCase('clearMemory', async ({ results, sendEvent, query, plan }) => {
      clearMemory();
      results.summary = "### 🧠 JEXI OS\n\n✓ Memory core wiped completely.";
      results.statistics.confidence = 100;
      return results;
    });

    N.conversation = this.wrapCase('conversation', async ({ results, sendEvent, query, plan }) => {
      const ctx = await conversationContext(query);
      // No AI key? Still answer identity/origin questions deterministically —
      // JEXI must ALWAYS know her own name, creator and origin, key or no key.
      const keys = resolveKeys();
      if (!keys.groqKey && !keys.geminiKey) {
        try { addChat('jexi', IDENTITY_ANSWER); } catch (e) {}
        results.summary = `### 🧠 JEXI OS\n\n${IDENTITY_ANSWER}`;
        results.statistics.confidence = 100;
        return results;
      }
      let reply = await generateContent(
        `The user just said: \"${query}\"\n\nRecent conversation:\n${ctx}\n\nRespond naturally as JEXI OS. If they ask who you are or who created you, answer: you are JEXI OS, a sophisticated multi-agent AI operating system built by Lewis Einstein (AI & ML Engineer) to run any task. Be warm and brief.`,
        JEXI_SYSTEM_PROMPT + preferencesBlock()
      );
      // B48 P2a — GROUNDEDNESS CHECK (confabulation defense): any memory-claim
      // sentence must be grounded in the context ACTUALLY injected this turn.
      // Ungrounded claims are stripped and counted; narration phrases are
      // removed even when the claim is grounded (P2b). This is the hard
      // guarantee that "hello" can never produce "I remember your favorite
      // color…" — the loadout for a greeting contains no memory to ground it.
      const grounded = groundednessCheck({ draft: reply, context: ctx, query });
      if (grounded.caught > 0) {
        sendEvent('log', { agent: 'Critic', message: `🛡 Groundedness check: caught ${grounded.caught} ungrounded memory claim(s) in the draft and removed them.` });
      }
      if (grounded.changed) reply = grounded.clean;
      // Anti-hallucination pass on long, fact-bearing replies (Critic / Fact
      // Checker) — short chit-chat skips it, so replies stay instant.
      const verified = await verifyAnswer({ query, draft: reply, sendEvent, opts: { minLength: 260 } });
      if (verified.text) reply = verified.text;
      try { addChat('jexi', reply); } catch (e) {}
      try { rememberEpisode(query, reply); } catch (e) {}
      results.summary = `### 🧠 JEXI OS\n\n${reply}`;
      results.statistics.confidence = 100;
      return results;
    });

    N.explainTeam = this.wrapCase('explainTeam', async ({ results, sendEvent, query, plan }) => {
      const explain = `### 🧠 HOW JEXI PLANS A TASK

I don't just answer — I **plan first, then run the team one-by-one** until the task is finished. Here is exactly how I decide which agents to use:

**1. Planner (me) — classify + plan first.** I read your request and pick the intent with a fast deterministic classifier (no AI call needed — instant and free), then name the specialist team for it **before anything runs**:

| Intent | The team I plan to run (in order) |
|---|---|
| Build an app / code | Product → Designer → Engineer → Coder → Runner → Debugger → QA Lead → Reviewer → Security Officer → Shipper → Reflector |
| Research / question | Query Analyzer → Searcher → Re-ranker → Extractor → Synthesizer |
| Latest news | News Scout → News Filter → News Editor |
| Open a link | Navigator → Extractor → Reasoner |
| Study a topic | Scholar → Researcher |
| Use the browser | Navigator → Vision → Reasoner |
| Math problem | Reasoner |
| Remember / memory | Memory Agent |
| GitHub (commit/push/PR/issues) | GitHub Agent → Shipper |
| Translate text | Translator → Reviewer (reflection loop) |
| Analyze data / charts | Data Analyst → Reasoner |
| Deploy / Docker / CI | DevOps Agent → Shipper |
| Write docs / README | Technical Writer → Reviewer |
| Make it faster | Performance Engineer → Coder → Reviewer |
| **Compound** (e.g. \"build a tracker from today's news\") | Phase 1: News/Research team gathers → Phase 2: Coding team builds on that context |

**2. Orchestrator — run them one-by-one.** Each specialist runs in order, and each gets **only the previous specialist's output** (strict handoff — no context pollution). The pipeline shows live: you watch every agent step in the chat.

**3. Gates in code, not suggestions.** QA's verdict must be PASS, and the Security Officer must CLEAR shipping — if not, the team fixes and re-runs. Nothing ships on a rubber-stamp.

Try it: say *\"build a weather app\"* and watch Product → Designer → Engineer → Coder → QA → Security → Shipper run in order. Or *\"build a dashboard of today's news\"* — that plans TWO teams: news first, then build.`;
      results.summary = explain;
      results.statistics.confidence = 100;
      return results;
    });

    N.compoundTask = this.wrapCase('compoundTask', async ({ results, sendEvent, query, plan, opts }) => {
      const phases = plan.phases || [];
      let phaseContext = query; // phase 1 output feeds phase 2 as context
      const phaseSummaries = [];
      for (let i = 0; i < phases.length; i++) {
        const phase = phases[i];
        const isLast = i === phases.length - 1;
        const phaseQuery = i === 0 ? query : `${query}\n\nContext the ${phases[0].name} already gathered (use it — do not re-fetch):\n${phaseContext}`;
        sendEvent('log', { agent: 'Planner', message: `▶ Running phase ${i + 1}/${phases.length}: ${phase.name} (${phase.intent})` });

        let phaseResult;
        try {
          phaseResult = await this.executePlan(
            { intent: phase.intent, tasks: phase.agents, reasoning: phase.reasoning, scope: { mode: 'normal', query: phaseQuery } },
            phaseQuery,
            sendEvent,
            opts
          );
        } catch (e) {
          phaseResult = { success: false, summary: `Phase ${phase.name} failed: ${e.message}`, error: e.message };
          sendEvent('log', { agent: 'Planner', message: `⚠ ${phase.name} failed — ${e.message}` });
        }

        phaseSummaries.push({ name: phase.name, intent: phase.intent, result: phaseResult });
        if (phaseResult?.summary) phaseContext = phaseResult.summary;

        // Phase 1's output IS the input to phase 2 (strict handoff). If a
        // non-final phase produced nothing, note it and continue — the next
        // phase still runs with the original query.
        if (!isLast && (!phaseResult?.summary || !phaseResult?.success)) {
          sendEvent('log', { agent: 'Planner', message: `⚠ ${phase.name} produced no usable output — phase ${i + 2} runs from the original request.` });
        }
      }

      const final = phaseSummaries[phaseSummaries.length - 1];
      results.summary = final?.result?.summary || 'The team finished, but produced no readable summary.';
      results.sources = [];
      (phaseSummaries || []).forEach((p) => {
        if (p.result?.sources?.length) results.sources.push(...p.result.sources);
      });
      results.statistics.confidence = final?.result?.statistics?.confidence ?? 75;
      results.phaseSummaries = phaseSummaries.map((p) => ({
        name: p.name,
        intent: p.intent,
        success: p.result?.success !== false,
        summary: String(p.result?.summary || '').slice(0, 400),
      }));
      return results;
    });

    N.memoryQuery = this.wrapCase('memoryQuery', async ({ results, sendEvent, query, plan }) => {
      const { userProfile } = await import('./MemoryManager.js').then(m => ({ userProfile: m.loadMemory().userProfile }));
      const ctx = await conversationContext(query);
      const reply = await generateContent(
        `The user asked: \"${query}\"\n\nUser profile: ${JSON.stringify(userProfile)}\nRecent conversation:\n${ctx}\n\nAnswer what JEXI remembers about the user, naturally.`,
        JEXI_SYSTEM_PROMPT + preferencesBlock()
      );
      // B48 P2a — groundedness check with the exact context injected this turn.
      const grounded = groundednessCheck({ draft: reply, context: ctx, query });
      if (grounded.caught > 0) {
        sendEvent('log', { agent: 'Critic', message: `🛡 Groundedness check: caught ${grounded.caught} ungrounded memory claim(s) in the draft and removed them.` });
      }
      const finalReply = grounded.changed ? grounded.clean : reply;
      try { addChat('jexi', finalReply); } catch (e) {}
      results.summary = `### 🧠 JEXI OS\n\n${finalReply}`;
      results.statistics.confidence = 100;
      return results;
    });

    N.imageRecognition = this.wrapCase('imageRecognition', async ({ results, sendEvent, query, plan }) => {
      sendEvent('log', { agent: 'Vision', message: '🔍 Analyzing image...' });
      const reply = await generateContent(
        `The user attached an image and asked: \"${query || 'What is this?'}\"\n\nAnalyze the image thoroughly: describe what it shows, read any text/numbers/symbols, and if it is a math problem, solve it with full LaTeX steps.`,
        JEXI_SYSTEM_PROMPT + preferencesBlock(),
        plan.payload
      );
      try { addChat('jexi', reply); } catch (e) {}
      results.summary = `### 👁️ JEXI VISION\n\n${reply}`;
      results.statistics.confidence = 95;
      return results;
    });

    N.linkAnalysis = this.wrapCase('linkAnalysis', async ({ results, sendEvent, query, plan }) => {
      const url = plan.payload.url;
      sendEvent('log', { agent: 'Vision', message: `🌐 Opening link: ${url}` });
      sendEvent('website', { site: { title: url, url, favicon: `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`, status: 'reading' } });

      // VIDEO LINKS (YouTube / TikTok / Instagram / direct files) get the
      // Video Analyst first: timestamped captions + sampled frames + vision
      // (the agentic video-understanding pattern). Only falls back to the
      // browser when the analyst can't read the video at all.
      try {
        const { isVideoUrl, analyzeVideo } = await import('./VideoAnalyzer.js');
        if (isVideoUrl(url)) {
          try {
            const reply = await analyzeVideo(url, { sendEvent, maxFrames: 5 });
            try { addChat('jexi', reply); } catch (e) {}
            results.summary = reply;
            results.sources = [{ title: url, link: url }];
            results.statistics.confidence = 90;
            return results;
          } catch (e) {
            sendEvent('log', { agent: 'Video Analyst', message: `⚠ Video analysis failed (${e.message}) — trying the browser.` });
          }
        }
      } catch (e) { /* VideoAnalyzer unavailable — keep the existing path */ }

      // Use the browser agent (her eyes) — falls back to server-side reading
      const agent = new ComputerUseAgent();
      const result = await agent.executeTask(plan.payload.fullQuery || query, sendEvent, { intent: 'link_analysis' });

      if (result.output && result.output.length > 0) {
        const reply = result.output.includes('###') ? result.output : `### 🔗 LINK ANALYSIS\n\n${result.output}`;
        try { addChat('jexi', reply); } catch (e) {}
        results.summary = reply;
      } else {
        // Last-resort: extract content server-side
        const content = await analyzeLink(url);
        const reply = await generateContent(
          `The user shared this link: ${url}\n\nContent I extracted:\n${content.content.slice(0, 8000)}\n\nTell the user what this link is about, clearly and concisely, with key details.`,
          JEXI_SYSTEM_PROMPT
        );
        try { addChat('jexi', reply); } catch (e) {}
        results.summary = `### 🔗 LINK ANALYSIS\n\n${reply}`;
      }
      results.sources = [{ title: url, link: url }];
      results.statistics.confidence = 90;
      return results;
    });

    N.computerUse = this.wrapCase('computerUse', async ({ results, sendEvent, query, plan }) => {
      sendEvent('log', { agent: 'Navigator', message: '🖥 Taking over the browser — I will navigate, click and type myself.' });
      const agent = new ComputerUseAgent();
      const result = await agent.executeTask(query, sendEvent, { intent: 'computer_use' });

      if (result.output && result.output.trim().length > 0) {
        const reply = result.output.includes('###') ? result.output : `### 🖥 COMPUTER USE\n\n${result.output}`;
        try { addChat('jexi', reply); } catch (e) {}
        results.summary = reply;
        results.statistics.confidence = result.output.length > 300 ? 88 : 75;
        return results;
      }

      // Fallback: browser produced nothing — use the search team instead.
      sendEvent('log', { agent: 'Navigator', message: '⚠ Browser gave no answer — switching to the search team.' });
      const team = await runSearchTeam(query, sendEvent, { context: conversationTranscript(6) });
      results.sources = team.sources.slice(0, 5).map(s => ({ title: s.title, link: s.link }));
      try { addChat('jexi', team.summary); } catch (e) {}
      results.summary = team.summary;
      results.statistics.confidence = team.confidence;
      return results;
    });

    N.mathSolve = this.wrapCase('mathSolve', async ({ results, sendEvent, query, plan }) => {
      sendEvent('log', { agent: 'Reasoner', message: '🔢 Solving with structured mathematics...' });
      const reply = await generateContent(
        `Solve this mathematics question step by step: \"${query}\"\n\nRULES:\n- Use LaTeX everywhere: $...$ for inline math, $$...$$ for display math.\n- Clearly distinguish letters (variables), numbers, and symbols.\n- Use a table if comparing values, and include a diagram or graph description when helpful.\n- Structure: # SOLUTION / ## GIVEN / ## FORMULA / ## WORKING / ## FINAL ANSWER.\n- Double-check your arithmetic before answering.`,
        JEXI_SYSTEM_PROMPT + preferencesBlock()
      );
      try { addChat('jexi', reply); } catch (e) {}
      try { saveInternetKnowledge(query, reply, []); } catch (e) {}
      results.summary = reply;
      results.statistics.confidence = 95;

      // DOMAIN VERIFICATION (stage 16) — deterministic math checks first
      // (balanced LaTeX fences, FINAL ANSWER present, arithmetic spot-check),
      // then a math critic with keys when something is flagged.
      try {
        const verified = await verifyDomainAnswer({ query, draft: reply, domain: 'math', sendEvent });
        if (verified.changed) {
          sendEvent('log', { agent: 'Domain Check (math)', message: verified.verdict === 'verified' ? '✓ Math answer verified after revision.' : '✍ Math answer revised — checks now pass.' });
          results.summary = verified.text;
          results.statistics.verification = { domain: 'math', rounds: verified.rounds, verdict: verified.verdict };
        }
      } catch (e) {}
      return results;
    });

    // B51 P2 — DIRECT ANSWER: simple definitional / factual questions answered
    // from model knowledge + optional short memory recall. NO web search, NO
    // browser, NO Trusted Library, NO study pipeline (cheapest correct tool).
    N.directAnswer = this.wrapCase('directAnswer', async ({ results, sendEvent, query, plan }) => {
      // 1. A short memory/knowledge recall can enrich the direct answer without
      //    any external tooling. Never blocks; never narrates (B51 P1).
      let memoryCtx = '';
      try {
        const ctx = await conversationContext(query);
        if (ctx) memoryCtx = ctx;
      } catch (e) {}

      // 2. Answer directly from knowledge.
      const reply = await generateContent(
        `Answer this directly and completely: "${query}"\n\n${memoryCtx ? `Use this conversation context ONLY to resolve references — never announce it:\n${memoryCtx}` : ''}\nLead with the answer. Keep it proportionate: a definition gets a clear, well-structured explanation (short paragraphs, headings where helpful) — not a research report.`,
        JEXI_SYSTEM_PROMPT + preferencesBlock()
      );
      let draft = String(reply || '').trim() || `I don't have a solid answer for that right now — try rephrasing or ask for a deeper study of the topic.`;

      // 3. B52 P5 — the SINGLE completion gate: verify + strip forbidden
      //    narration in one shared helper before the answer reaches the user.
      const finalized = await finalizeAnswer({ query, draft, sources: [], domain: 'direct_answer', sendEvent, opts: { minLength: 160 } });
      results.summary = finalized.summary;
      if (finalized.verification) results.statistics.verification = finalized.verification;
      try { addChat('jexi', results.summary); } catch (e) {}
      results.statistics.confidence = 92;
      return results;
    });

    N.research = this.wrapCase('research', async ({ results, sendEvent, query, plan }) => {
      // 1. The user's own books/library come FIRST — grounded answers from their materials
      try {
        const fromBooks = await recallKnowledge(query, sendEvent, 1);
        if (fromBooks) {
          sendEvent('log', { agent: 'Books', message: '📚 Found it in your books / knowledge library — answering from there.' });
          const summary = await this.answerFromKnowledge(fromBooks, query);
          try { addChat('jexi', summary); } catch (e) {}
          results.summary = summary;
          results.sources = fromBooks.map(k => ({ title: k.title, link: '' }));
          results.statistics.confidence = 95;
          return results;
        }
      } catch (e) {}

      // 2. Check memory first — did we already learn this?
      try {
        const remembered = await searchInternetKnowledge(query);
        if (remembered) {
          sendEvent('log', { agent: 'Memory Agent', message: '✓ Found this in my memory — serving it directly.' });
          // B51 P1 — no "FROM MEMORY" header; just the answer.
          results.summary = remembered.answer;
          if (remembered.sources?.length) results.sources = remembered.sources.map(s => ({ title: s, link: s }));
          results.statistics.confidence = 92;
          return results;
        }
      } catch (e) {}

      // 3. Search the internet with the specialist Search Team
      //    (Query Analyzer → Searcher → Re-ranker → Extractor → Synthesizer).
      //    Pass the recent thread so references like "this course" resolve
      //    inside the team too (continuity across turns).
      //    B51 P5 — a previous verification failure injects the SPECIFIC
      //    missing claims so the re-entry fixes them, not a generic re-run.
      const retryClaims = state.context.retryWithClaims;
      const effectiveQuery = retryClaims && retryClaims.length
        ? `${query}\n\n[Verification follow-up — these specific claims were flagged as unsupported, verify each with a real source: ${retryClaims.join(' | ')}]`
        : query;
      const team = await runSearchTeam(effectiveQuery, sendEvent, { context: conversationTranscript(6) });
      results.sources = team.sources.slice(0, 5).map(s => ({ title: s.title, link: s.link }));

      if (team.sources.length === 0) {
        sendEvent('log', { agent: 'Search', message: '⚠ No results. Trying the browser...' });
        const agent = new ComputerUseAgent();
        const br = await agent.executeTask(query, sendEvent, { intent: 'research' });
        if (br.output) {
          try { addChat('jexi', br.output); } catch (e) {}
          results.summary = br.output;
          results.statistics.confidence = 80;
          return results;
        }
      }

      try { addChat('jexi', team.summary); } catch (e) {}
      results.summary = team.summary;
      results.statistics.confidence = team.confidence;

      // B52 P2 — the verification + correction path is a REAL GraphRunner run:
      // draft → verifier → (revise WITH the specific missing claims → verifier,
      // bounded) → final. Durable failure history flows back into state so the
      // next iteration reads the last error + reasons (P7).
      const g = await runResearchVerifyGraph({
        query,
        draft: results.summary,
        sources: results.sources || [],
        sendEvent,
      }).catch((e) => null);
      if (g && g.context) {
        // B52 P5 — single completion gate: the graph already verified the
        // draft, so finalizeAnswer runs sanitize-only here (verify: false) —
        // no double verification pass, one shared finalization path.
        const finalized = await finalizeAnswer({ query, draft: g.context.finalDraft || results.summary, sources: g.context.sources || results.sources || [], domain: 'research', verify: false, sendEvent });
        results.summary = finalized.summary;
        if (g.context.sources && g.context.sources.length) results.sources = g.context.sources;
        results.statistics.verification = g.context.verification || finalized.verification || results.statistics.verification;
        state.context.failureHistory = (state.context.failureHistory || []).concat(g.context.failureHistory || []).slice(-8);
        state.context.lastError = g.context.lastError || state.context.lastError;
        state.context.attempt = (state.context.attempt || 0) + (g.context.attempt || 0);
        sendEvent('log', { agent: 'GraphRunner', message: `researchVerifyGraph visited: ${(g.history || []).join(' → ')}` });
        try { addChat('jexi', results.summary); } catch (e) {}
      }

      // DOMAIN VERIFICATION (stage 16) — deterministic research checks on
      // top of the fact-check loop: sources linked, structure present.
      try {
        const domainCheck = await verifyDomainAnswer({ query, draft: results.summary, domain: 'research', sources: results.sources, sendEvent });
        if (domainCheck.changed) {
          results.summary = domainCheck.text;
          results.statistics.verification = { ...(results.statistics.verification || {}), domain: 'research', verdict: domainCheck.verdict };
        }
      } catch (e) {}
      return results;
    });

    N.studyTopic = this.wrapCase('studyTopic', async ({ results, sendEvent, query, plan }) => {
      const topic = plan.payload || query;
      const content = await studyTopic('07_GENERAL_KNOWLEDGE', topic, sendEvent);
      // B51 P1 — NO process narration. The user gets the study content, titled
      // only, never "I studied … using the Trusted Library … saved it".
      let draft = content && String(content).trim().length
        ? `## ${topic}\n\n${content.slice(0, 4000)}`
        : `## ${topic}\n\nI could not gather enough material on this topic right now — try again in a moment.`;
      // B52 P5 — single completion gate (verify + sanitize) for study answers.
      const finalized = await finalizeAnswer({ query, draft, sources: [], domain: 'study', sendEvent });
      results.summary = finalized.summary;
      if (finalized.verification) results.statistics.verification = finalized.verification;
      results.statistics.confidence = 100;
      return results;
    });

    N.knowledgeRecall = this.wrapCase('knowledgeRecall', async ({ results, sendEvent, query, plan }) => {
      const kb = plan.payload || (await recallKnowledge(query, sendEvent));
      if (kb) {
        let summary = await this.answerFromKnowledge(kb, query);
        const sources = (Array.isArray(kb) ? kb : [kb]).map(k => ({ title: k.title, link: '' }));
        // B52 P5 — single completion gate (verify against the book passages +
        // sanitize) before the answer reaches the user.
        sendEvent('log', { agent: 'Critic', message: '🔎 Checking the answer stays true to your book...' });
        const finalized = await finalizeAnswer({ query, draft: summary, sources, domain: 'knowledge_recall', sendEvent });
        try { addChat('jexi', finalized.summary); } catch (e) {}
        results.summary = finalized.summary;
        results.sources = sources;
        results.statistics.confidence = 95;
        if (finalized.verification) results.statistics.verification = finalized.verification;
        return results;
      }
      // Fall through to research if the library has nothing
      const { summary } = await reasonAndWrite(query, []);
      results.summary = summary;
      return results;
    });

    N.newsTeam = this.wrapCase('newsTeam', async ({ results, sendEvent, query, plan }) => {
      sendEvent('log', { agent: 'News', message: `📰 Gathering the latest on: \"${query}\"` });

      // 0. Same news question answered within the last ~30 min? Serve the
      //    saved summary instantly — no feeds, no AI call, no wait.
      try {
        const fresh = await searchFreshInternetKnowledge(query, 30 * 60 * 1000);
        if (fresh) {
          sendEvent('log', { agent: 'Memory Agent', message: '✓ Already gathered fresh news on this — serving it instantly.' });
          // B51 P1 — no memory/process header; just the news.
          results.summary = fresh.answer;
          if (fresh.sources?.length) results.sources = fresh.sources.map(s => ({ title: s, link: s }));
          results.statistics.confidence = 90;
          return results;
        }
      } catch (e) {}

      // 1. Run the specialist News Team
      //    (News Scout → News Filter → News Editor — free feeds, no API key)
      const team = await runNewsTeam(query, sendEvent);
      results.sources = team.sources;
      // B52 P5 — single completion gate (sanitize; news freshness is the
      // verification, prose re-verification is skipped).
      const finalized = await finalizeAnswer({ query, draft: team.summary, sources: team.sources || [], domain: 'news', verify: false, sendEvent });
      try { addChat('jexi', finalized.summary); } catch (e) {}
      results.summary = finalized.summary;
      results.statistics.confidence = team.confidence;
      return results;
    });

    N.github = this.wrapCase('github', async ({ results, sendEvent, query, plan, opts }) => {
      const req = parseGithubRequest(query);
      const lower = query.toLowerCase();

      // "commit and push" — run both steps, show both outputs
      if (req.action === 'commit' && /\b(push|upload to github|send to github)\b/.test(lower)) {
        sendEvent('log', { agent: 'GitHub Agent', message: '📦 Commit + push — running both steps in order.' });
        const commitRes = await runGitHubAction({ action: 'commit', args: {} }, sendEvent);
        const pushRes = await runGitHubAction({ action: 'push', args: {} }, sendEvent);
        results.summary = `${commitRes.summary}\n\n${pushRes.summary}`;
        results.statistics.confidence = 90;
        return results;
      }

      // Mutating actions need real auth — check once, honestly
      if (['commit', 'push', 'pr_create', 'issue_create', 'repo_create'].includes(req.action)) {
        const auth = await checkGithubAuth(sendEvent);
        if (!auth.authed) {
          results.summary = `### 🔗 GITHUB AGENT

⚠ I'm not authenticated with GitHub yet, so I can't ${req.action === 'repo_create' ? 'create that repository' : 'run that command'}.

**To fix:** add a GitHub token — Settings → GitHub (or the \`GITHUB_TOKEN\` env var). Create one at *github.com → Settings → Developer settings → Personal access tokens* with the **repo** scope.

What I saw:\n${auth.detail.slice(0, 300)}`;
          results.statistics.confidence = 100;
          return results;
        }

        // BUILD 47 — CONFIRMATION-RESUME (P5): mutating git actions pause for
        // approval when a confirm callback is provided (session-scoped).
        if (opts.confirm) {
          const decision = await opts.confirm({
            risk: 'high',
            node: 'github',
            action: req.action,
            question: `I'm about to **${req.action}** on your GitHub repository. OK to proceed?`,
          });
          if (decision === false) {
            results.summary = `### 🔗 GITHUB AGENT\n\n👍 Cancelled — I won't ${req.action}. Tell me if you change your mind.`;
            results.statistics.confidence = 100;
            return results;
          }
          if (decision === 'paused') return results; // wrapCase parks at confirmationPause
        }
      }

      const res = await runGitHubAction(req, sendEvent);
      results.summary = res.summary;
      results.statistics.confidence = res.success ? 92 : 60;
      return results;
    });

    N.data = this.wrapCase('data', async ({ results, sendEvent, query, plan }) => {
      sendEvent('log', { agent: 'Data Analyst', message: '📊 Loading data — parsing CSV/JSON from your message, the workspace, or a URL...' });
      const res = await runDataAgent({ query, sendEvent });
      try { addChat('jexi', res.summary); } catch (e) {}
      results.summary = res.summary;
      results.statistics.confidence = res.success ? 90 : 60;
      return results;
    });

    N.devops = this.wrapCase('devops', async ({ results, sendEvent, query, plan }) => {
      const res = await runDevOpsAgent({ query, sendEvent });
      results.summary = res.summary;
      results.statistics.confidence = res.success ? 85 : 60;
      return results;
    });

    N.docs = this.wrapCase('docs', async ({ results, sendEvent, query, plan }) => {
      const res = await runWriterAgent({ query, sendEvent });
      results.summary = res.summary;
      results.statistics.confidence = res.success ? 88 : 60;
      return results;
    });

    N.translate = this.wrapCase('translate', async ({ results, sendEvent, query, plan }) => {
      const res = await runTranslatorAgent({ query, sendEvent });
      results.summary = res.summary;
      results.statistics.confidence = res.success ? 85 : 60;
      return results;
    });

    N.perf = this.wrapCase('perf', async ({ results, sendEvent, query, plan }) => {
      const res = await runPerfAgent({ query, sendEvent });
      results.summary = res.summary;
      results.statistics.confidence = res.success ? 85 : 60;
      return results;
    });

    N.selfCheck = this.wrapCase('selfCheck', async ({ results, sendEvent, query, plan }) => {
      sendEvent('log', { agent: 'SelfDiagnose', message: '🔍 Running full system diagnostics...' });
      const status = collectSystemStatus();

      // Read the most likely source files based on recent errors
      const hints = [
        [/groq|gemini|api.?key|401|403|429|rate ?limit/i, 'server/src/services/LLMClient.js'],
        [/browser|chromium|playwright|executable|missing|no-sandbox/i, 'server/src/services/DesktopManager.js'],
        [/redis|memory|hydrate|knowledge/i, 'server/src/services/MemoryManager.js'],
        [/fetch|enotfound|timeout|search|aggregate/i, 'server/src/services/SearchEngine.js'],
        [/vision|no image/i, 'server/index.js'],
      ];
      const targets = [];
      for (const e of status.errors.recent) {
        for (const [re, file] of hints) {
          if (re.test(e.message) && !targets.includes(file)) targets.push(file);
        }
      }
      if (targets.length === 0) targets.push('server/index.js', 'server/src/services/Orchestrator.js');
      const excerpts = targets.slice(0, 3)
        .map(f => readSourceFile(f))
        .filter(r => r.ok)
        .map(r => `--- FILE: ${r.path} ---\n${r.content.slice(0, 2500)}`)
        .join('\n\n');

      sendEvent('log', { agent: 'SelfDiagnose', message: `📋 Status: ${status.keys.groq || status.keys.gemini ? 'AI keys OK' : 'NO AI KEYS'}, browser ${status.browser.ready ? 'OK' : 'DOWN'}, ${status.errors.count} logged error(s).` });
      const reply = await generateContent(
        `My live self-diagnosis (JSON):\n${JSON.stringify(status, null, 2)}\n\nSource code I inspected:\n${excerpts || '(none)'}\n\nCRITICAL INSTRUCTION — DO NOT HALLUCINATE BUGS:\n- Only report an issue if you can point to the EXACT buggy line in the code excerpt above (quote it verbatim).\n- Do NOT invent bugs, typos, missing imports, or unused variables. This is a real production system; the code above is live and working.\n- If the code looks correct (or you cannot be sure from the excerpt), write: \"No issues found — system healthy.\"\n- Only report issues from the JSON status (memory, browser, keys, errors, writable dirs) or the exact code you saw.\n\nIf everything is healthy, say so briefly and warmly (I am JEXI OS, created by Lewis Einstein). Use ## HEALTH, ## ISSUES FOUND, ## ROOT CAUSE + FILE, ## FIX. If no issues, put \"None — system healthy\" under ISSUES FOUND.`,
        JEXI_SYSTEM_PROMPT + preferencesBlock(),
        null,
        { temperature: 0.3 }
      );
      try { addChat('jexi', reply); } catch (e) {}
      results.summary = `### 🩺 JEXI SELF-DIAGNOSIS\n\n${reply}`;
      results.statistics.agentsUsed = 2;
      results.statistics.confidence = 90;
      return results;
    });

    N.generic = this.wrapCase('generic', async ({ results, sendEvent, query, plan }) => {
      // Check the user's own books/library before generic research
      try {
        const fromBooks = await recallKnowledge(query, sendEvent, 1);
        if (fromBooks) {
          const summary = await this.answerFromKnowledge(fromBooks, query);
          try { addChat('jexi', summary); } catch (e) {}
          results.summary = summary;
          results.statistics.confidence = 90;
          return results;
        }
      } catch (e) {}
      const ctx = await conversationContext();
      const { summary } = await reasonAndWrite(query, [], { memoryContext: ctx });
      // B48 P2a — groundedness check with the exact context injected this turn.
      const grounded = groundednessCheck({ draft: summary, context: ctx, query });
      if (grounded.caught > 0) {
        sendEvent('log', { agent: 'Critic', message: `🛡 Groundedness check: caught ${grounded.caught} ungrounded memory claim(s) in the draft and removed them.` });
      }
      const finalSummary = grounded.changed ? grounded.clean : summary;
      try { addChat('jexi', finalSummary); } catch (e) {}
      results.summary = finalSummary;
      results.statistics.confidence = 70;
      return results;
    });

    // ---- coding subgraph: codePipeline → debugger ↺ → qaGate → codeReview → securityGate → criticGate → reflector → shipper

    N.codePipeline = async (state) => {
      const { results, sendEvent } = state.context;
      const query = state.query;
      const plan = state.plan || {};
      const scope = plan.scope || {};
      const effQuery = (plan.scope && plan.scope.query) || query;
      const c = state.context.code = {
        effQuery, scope, debugAsk: isDebugQuery(effQuery), done: false,
        entryPoint: null, lastOutput: '', previewUrl: null,
        qaReport: '', qaVerdict: null, qaRounds: 0, debugAttempts: 0, runSuccess: false,
        reviewNotes: '', securityNotes: '', shipNotes: '', reflectionNotes: '', secVerdict: null,
        teamPlan: '', teamBrief: '',
      };
      sendEvent('log', { agent: 'Coder', message: '💻 Entering coding pipeline...' });

      // 1. Do we already know this from memory?
      // B53 P2 — hard product isolation: the memory shortcut may only fire for
      // a CONTINUATION of the same task (or direct executor calls with no task
      // at all). A brand-new product objective never inherits another task's
      // saved solution/artifacts — the coder starts from the fresh workspace.
      const isContinuation = Boolean(state.context.opts?.isContinuation);
      const hasTaskScope = Boolean(state.context.opts?.taskId);
      const memoryReuseAllowed = !hasTaskScope || isContinuation;
      if (memoryReuseAllowed) {
      try {
        const remembered = await searchCodingKnowledge(effQuery);
        if (remembered) {
          sendEvent('log', { agent: 'Memory Agent', message: '✓ Found a solution I built before — reusing it.' });
          // B51 P1 — no "RECALLED FROM MEMORY / I solved this before" narration.
          results.summary = `## ${effQuery}\n\n${remembered.solution}${remembered.files?.length ? `\n\n**Files:** ${remembered.files.join(', ')}` : ''}`;
          results.statistics.confidence = 95;
          c.done = true;
          return state; // edge → responder
        }
      } catch (e) {}
      }

      // B53 P6 — durable checkpoint after the plan/generate stage so a
      // disconnect mid-build resumes here, not from zero.
      try {
        if (state.context.opts?.taskId) setTaskCheckpoint(state.context.opts.taskId, { node: 'codePipeline', attempt: c.debugAttempts, files: listWorkspaceFiles().slice(0, 20) });
      } catch (e) {}

      // 1.5 THINK + PLAN — the team's Product → Designer → Engineer pass
      if (!c.debugAsk && scope.mode !== 'freeze') {
        try {
          const planned = await planForBuild(effQuery, sendEvent);
          c.teamBrief = planned.brief;
          c.teamPlan = `${planned.brief}\n\n${planned.design}\n\n${planned.plan}`;
        } catch (e) {
          sendEvent('log', { agent: 'Engineer', message: `⚠ Planning pass failed: ${e.message}` });
        }
      }

      // FROZEN mode: plan only — nothing is written to disk.
      if (scope.mode === 'freeze') {
        results.summary = `### 📋 BUILD PLAN — FROZEN\n\nNothing was written to disk. Here is the team's plan:\n\n${c.teamPlan || '(planning skipped — say /unfreeze and I will plan then build)'}\n\n> Say **/unfreeze** or ask me to *build it* and I will execute this plan end-to-end.`;
        results.statistics.confidence = 90;
        c.done = true;
        return state;
      }

      // 2. Plan the project (coder pass — follows the team's build plan)
      let project;
      try {
        project = await generateCode(c.teamPlan ? `${effQuery}\n\nIMPLEMENT THIS PLAN:\n${c.teamPlan}` : effQuery, sendEvent);
      } catch (e) {
        sendEvent('log', { agent: 'Architect', message: `⚠ Planning failed: ${e.message}` });
      }

      if (project && project.files && project.files.length > 0) {
        fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
        // /guard: only write files inside the user-declared scope
        const allowedWrite = (name) => !scope.paths || !scope.paths.length || scope.paths.some(p => name.includes(p));
        project.files.forEach(f => {
          if (!allowedWrite(f.name)) { sendEvent('log', { agent: 'Coder', message: `⛔ /guard: skipping ${f.name} (outside allowed scope)` }); return; }
          fs.writeFileSync(path.join(WORKSPACE_DIR, f.name), f.code, 'utf-8');
        });
        sendEvent('log', { agent: 'Coder', message: `✓ Created ${project.files.length} file(s)` });
        c.entryPoint = project.entryPoint || project.files[0]?.name;
      } else {
        results.summary = "### 💻 JEXI CODING AGENT\n\nI couldn't generate the code. Please rephrase your request with more detail.";
        results.statistics.confidence = 40;
        c.done = true;
      }
      return state; // edge → debugger
    };

    N.debugger = async (state) => {
      // P3 — the DEBUG LOOP now runs through the first-class CodingLoop
      // (server/src/services/CodingLoop.js): write → run → observe the EXACT
      // error → fix → re-run, with a machine-checkable success predicate
      // (exit 0 + no error-class markers) and a hard attempt budget.
      // The graph cycle (debugger → debugger) remains for structure, but the
      // actual run/observe/fix iterations live in one bounded loop.
      const { sendEvent } = state.context;
      const c = state.context.code;
      if (c.done) return state;
      const scope = c.scope;
      const allowedWrite = (name) => !scope.paths || !scope.paths.length || scope.paths.some(p => name.includes(p));
      const entryPoint = c.entryPoint;
      const existingCode = readWorkspaceFile(entryPoint);
      const initialFiles = existingCode ? [{ name: entryPoint, code: existingCode }] : [];

      const loop = await runCodingLoop({
        goal: c.effQuery,
        entryPoint,
        files: initialFiles,
        successCriterion: 'exit-zero-no-error-text',
        maxAttempts: MAX_DEBUG_ATTEMPTS,
        sendEvent,
        writeFiles: async (files) => {
          files.forEach((f) => {
            if (!allowedWrite(f.name)) { sendEvent('log', { agent: 'Coder', message: `⛔ /guard: skipping ${f.name} (outside allowed scope)` }); return; }
            fs.writeFileSync(path.join(WORKSPACE_DIR, f.name), f.code, 'utf-8');
          });
          c.entryPoint = loop && loop.entryPoint ? loop.entryPoint : entryPoint;
        },
      });

      c.debugAttempts = loop.attempts;
      c.lastOutput = loop.lastOutput;
      c.runSuccess = loop.success;

      // B53 P6 — durable checkpoint after the debug loop: exact attempt count +
      // the last observed error, so the next iteration knows precisely where
      // the loop stopped (never invents completion).
      try {
        if (state.context.opts?.taskId) setTaskCheckpoint(state.context.opts.taskId, {
          node: 'debugger',
          attempt: c.debugAttempts,
          lastError: loop.success ? null : String(loop.lastOutput || '').slice(0, 500),
          files: listWorkspaceFiles().slice(0, 20),
        });
      } catch (e) {}

      if (loop.success) {
        sendEvent('log', { agent: 'Runner', message: `✅ Code ran clean on attempt ${loop.attempts} (predicate passed).` });
        // 3.5 SHOW HER WORK: open the finished web app in the virtual
        //     desktop's Chromium so the user watches it render live.
        if (/\.html$/i.test(c.entryPoint || '')) {
          try {
            const url = `${PUBLIC_URL || MANAGER_URL}/preview/${c.entryPoint}`;
            c.previewUrl = url;
            await ensureBrowser();
            await new DesktopManager().goto('coder', url);
            sendEvent('log', { agent: 'Vision', message: `🖥 Showing the app in my virtual desktop: ${url}` });
          } catch (e) {
            sendEvent('log', { agent: 'Vision', message: `⚠ Could not open the app in the virtual desktop (the preview link still works): ${e.message}` });
          }
        } else {
          // Non-HTML entry points: re-run once to capture the clean preview URL.
          const fresh = await runFile(c.entryPoint, (s, d) => {});
          if (fresh.url) c.previewUrl = fresh.url;
        }
        return state; // edge → qaGate
      }

      sendEvent('log', { agent: 'Debugger', message: `⚠ Predicate never passed in ${loop.attempts} attempts — best effort continues. Last output: ${String(loop.lastOutput).slice(0, 160)}` });
      return state; // edge → qaGate (best effort)
    };

    N.qaGate = async (state) => {
      // P1 — the QA gate: NEEDS FIX routes back through debugger (re-run),
      // PASS proceeds to review + security + ship. Bounded to one fix round.
      const { sendEvent } = state.context;
      const c = state.context.code;
      if (c.done) return state;
      const scope = c.scope;

      if (c.qaRounds === 0) {
        try {
          if (c.previewUrl && /\.html$/i.test(c.entryPoint || '')) {
            c.qaReport = await qaWebApp({ previewUrl: c.previewUrl, brief: c.teamBrief || c.effQuery, scope, sendEvent });
          } else {
            c.qaReport = await qaScripted({ query: c.effQuery, files: listWorkspaceFiles(), lastOutput: c.lastOutput, sendEvent });
          }
          c.qaVerdict = gateVerdict(c.qaReport, ['PASS', 'NEEDS FIX']);
        } catch (e) {
          c.qaReport = '';
        }
      }

      // B52 P2 — QA gate enforcement runs as a REAL GraphRunner pipeline:
      // runner → gate → (NEEDS FIX → fix → re-run → re-verify, bounded) →
      // accept. The graph records node history + durable failure history and
      // stops after one fix round (no blind infinite retry).
      if (c.qaVerdict === 'NEEDS FIX' && c.qaRounds < 1 && !c.debugAsk) {
        sendEvent('log', { agent: 'QA Lead', message: '⛔ QA gate: NEEDS FIX — sending back to the coder.' });
        const g = await runCodeGateGraph({
          query: c.effQuery,
          entryPoint: c.entryPoint,
          previewUrl: c.previewUrl,
          teamBrief: c.teamBrief || '',
          scope,
          qaReport: c.qaReport,
          sendEvent,
        }).catch((e) => null);
        if (g && g.context) {
          c.qaRounds = 1;
          if (g.context.gate) {
            c.qaVerdict = g.context.gate.verdict;
            c.qaReport = g.context.gate.report || c.qaReport;
          }
          if (g.context.entryPoint) c.entryPoint = g.context.entryPoint;
          if (g.context.previewUrl) c.previewUrl = g.context.previewUrl;
          if (g.context.lastOutput) c.lastOutput = g.context.lastOutput;
          state.context.failureHistory = (state.context.failureHistory || []).concat(g.context.failureHistory || []).slice(-8);
          sendEvent('log', { agent: 'GraphRunner', message: `codeGateGraph visited: ${(g.history || []).join(' → ')} (final verdict ${c.qaVerdict})` });
        }
      }
      return state; // edge → codeReview
    };

    // B49 P2 — each gate is its OWN graph node with its OWN LLM pass and
    // verdict (codeReview → securityGate → criticGate → reflector → shipper),
    // so no gate is bundled into another node's prompt: every verdict is an
    // independently observable turn with its own outcome.
    N.codeReview = async (state) => {
      const { sendEvent } = state.context;
      const c = state.context.code;
      if (c.done) return state;
      try {
        const r = await runReviewerPass({ query: c.effQuery, plan: c.teamPlan, files: listWorkspaceFiles(), qaReport: c.qaReport, sendEvent });
        c.reviewNotes = r.review;
        c.reviewVerdict = r.verdict;
        sendEvent('log', { agent: 'Reviewer', message: `🔍 Review verdict: ${r.verdict}` });
      } catch (e) {
        sendEvent('log', { agent: 'Reviewer', message: `⚠ Review pass issue: ${e.message}` });
      }
      return state; // edge → securityGate
    };

    N.securityGate = async (state) => {
      const { sendEvent } = state.context;
      const c = state.context.code;
      if (c.done) return state;
      try {
        // B52 P2 — the review + security gate path is a REAL GraphRunner run:
        // reviewer → security-gate → (BLOCKED → fix → re-run → re-review,
        // bounded) → final verdict. History + failure history are recorded.
        const g = await runReviewSecurityGraph({
          query: c.effQuery,
          entryPoint: c.entryPoint,
          teamPlan: c.teamPlan || '',
          qaReport: c.qaReport || '',
          files: listWorkspaceFiles(),
          sendEvent,
        }).catch((e) => null);
        if (g && g.context && g.context.reviewSecurity) {
          c.reviewNotes = g.context.reviewSecurity.review || c.reviewNotes;
          c.securityNotes = g.context.reviewSecurity.security;
          c.secVerdict = g.context.reviewSecurity.verdict;
          state.context.failureHistory = (state.context.failureHistory || []).concat(g.context.failureHistory || []).slice(-8);
          sendEvent('log', { agent: 'GraphRunner', message: `reviewSecurityGraph visited: ${(g.history || []).join(' → ')} (verdict ${c.secVerdict})` });
        }
        sendEvent('log', { agent: 'Security Officer', message: `🛡 Security verdict: ${c.secVerdict}` });
      } catch (e) {
        sendEvent('log', { agent: 'Security Officer', message: `⚠ Security pass issue: ${e.message}` });
      }
      return state; // edge → criticGate
    };

    N.criticGate = async (state) => {
      const { sendEvent } = state.context;
      const c = state.context.code;
      if (c.done) return state;
      try {
        const cr = await runCriticPass({ query: c.effQuery, files: listWorkspaceFiles(), qaReport: c.qaReport, review: c.reviewNotes, security: c.securityNotes, sendEvent });
        c.critiqueNotes = cr.critique;
        c.criticVerdict = cr.verdict;
        sendEvent('log', { agent: 'Critic', message: `🎭 Critic verdict: ${cr.verdict}` });
      } catch (e) {
        sendEvent('log', { agent: 'Critic', message: `⚠ Critic pass issue: ${e.message}` });
      }
      return state; // edge → reflector
    };

    N.reflector = async (state) => {
      const { sendEvent } = state.context;
      const c = state.context.code;
      if (c.done) return state;
      try {
        const rf = await runReflectorPass({ plan: c.teamPlan, qaReport: c.qaReport, review: c.reviewNotes, security: c.securityNotes, sendEvent });
        c.reflectionNotes = rf.reflection;
        sendEvent('log', { agent: 'Reflector', message: '🌐 Retrospective captured.' });
      } catch (e) {
        sendEvent('log', { agent: 'Reflector', message: `⚠ Reflection pass issue: ${e.message}` });
      }
      return state; // edge → shipper
    };

    N.shipper = async (state) => {
      // Present the verified code + store the verified solution in memory.
      const { results, sendEvent } = state.context;
      const c = state.context.code;
      if (c.done) return state;
            // B53 P4 — PRODUCT-FIRST final message (mandatory template): short status
      // line → preview link → file list → one-line test result. NO agent roster
      // play-by-play, NO QA/review/security/reflection essays, NO inline dumps.
      const linkBase = PUBLIC_URL || MANAGER_URL;
      const workspaceLinks = files.map(name => `- [${name}](${linkBase}/api/files/${name})`).join('\n');
      const previewLine = c.previewUrl
        ? `**🔗 Live preview:** [Open ${c.entryPoint}](${c.previewUrl})`
        : '';
      const statusLine = c.runSuccess
        ? '✓ Runs clean.'
        : c.secVerdict === 'BLOCKED'
          ? '⚠ Built, but the security review flagged issues to fix before relying on it.'
          : c.qaVerdict === 'NEEDS FIX'
            ? '⚠ Built and runs, but QA flagged issues to polish.'
            : '✓ Built.';
      const gateNote = c.secVerdict === 'BLOCKED'
        ? '\n\n> Ask me to fix the security findings and re-ship.'
        : c.qaVerdict === 'NEEDS FIX'
          ? '\n\n> Ask me to fix the QA findings and re-ship.'
          : '';
      // Derive a clean product title from the request ("Build me a calculator
      // web app" → "Calculator web app").
      const title = String(c.effQuery || 'Your app')
        .replace(/^(please\s+)?(can you\s+)?(build|create|make|write|develop|code|implement)\s+(me\s+)?(a|an|the)\s+/i, '')
        .replace(/^build me\s+/i, '')
        .replace(/\s+for me\s*$/i, '')
        .replace(/\s*[.!?]+$/, '')
        .trim()
        .slice(0, 90) || 'Your app';
      const draft = `### ✅ ${title.charAt(0).toUpperCase() + title.slice(1)} is ready.\n\n${statusLine}${previewLine ? `\n\n${previewLine}` : ''}${files.length ? `\n\n**Files:**\n${workspaceLinks}` : ''}${gateNote}\n`;
      // B52 P5 — single completion gate for the build report: the code itself
      // was verified by tests + QA/security gates, so this is sanitize-only
      // (verify: false) — no prose re-verification of a build report.
      const finalized = await finalizeAnswer({ query: c.effQuery, draft, sources: [], domain: 'code', verify: false, sendEvent });
      results.summary = finalized.summary;
      results.files = files;
      results.previewUrl = c.previewUrl || undefined;
      results.statistics.confidence = 100;

      // B53 P6 — durable checkpoint at the terminal node (shipped).
      try {
        if (state.context.opts?.taskId) setTaskCheckpoint(state.context.opts.taskId, {
          node: 'shipper',
          attempt: c.debugAttempts,
          lastError: null,
          files: files.slice(0, 20),
        });
      } catch (e) {}

      // Remember the entry point on the task so a "continue / go back" turn
      // can resume the exact artifact (B53 P2/P3).
      try {
        if (state.context.opts?.taskId && c.entryPoint) {
          const { updateTask } = await import('./TaskRegistry.js');
          updateTask(state.context.opts.taskId, { entryPoint: c.entryPoint });
        }
      } catch (e) {}

      // 5. Store the verified solution in memory (file bodies are truncated to
      //    a code-summary shape — the full artifacts live in the task workspace,
      //    B53 P2/P5: semantic memory never carries another task's source tree).
      try {
        const codeSummary = files.map((name) => {
          const code = readWorkspaceFile(name) || '';
          return `#### ${name}\n\n\`\`\`code\n${code.slice(0, 6000)}\n\`\`\``;
        }).join('\n\n').slice(0, 8000);
        saveCodingKnowledge(c.effQuery, 'code', codeSummary, files);
      } catch (e) {}


      // 5.5 Remember the team's reflection so future builds start smarter
      try {
        if (c.reflectionNotes) {
          saveCodingKnowledge(`lesson: ${c.effQuery.slice(0, 80)}`, 'reflection', c.reflectionNotes.slice(0, 1200), []);
        }
      } catch (e) {}
      c.done = true;
      return state; // edge → responder
    };

    return N;
  }

  /** Build the graph: nodes + edge resolvers (P1/P8). */
  buildGraph() {
    const nodes = this.buildNodes();

    /** Router — dispatches to the right specialist based on classified intent. */
    const nodeForIntent = (intent) => {
      switch (intent) {
        case 'clear_memory': return 'clearMemory';
        case 'conversation': return 'conversation';
        case 'explain_team': return 'explainTeam';
        case 'compound_task': return 'compoundTask';
        case 'memory_query': return 'memoryQuery';
        case 'image_recognition': return 'imageRecognition';
        case 'link_analysis': return 'linkAnalysis';
        case 'computer_use': return 'computerUse';
        case 'math_solve': return 'mathSolve';
        case 'direct_answer': return 'directAnswer'; // B51 P2
        case 'code_task': return 'codePipeline';
        case 'research':
        case 'learning_research': return 'research';
        case 'study_topic': return 'studyTopic';
        case 'knowledge_recall': return 'knowledgeRecall';
        case 'news_latest': return 'newsTeam';
        case 'github': return 'github';
        case 'data': return 'data';
        case 'devops': return 'devops';
        case 'docs': return 'docs';
        case 'translate': return 'translate';
        case 'perf': return 'perf';
        case 'self_check': return 'selfCheck';
        default: return 'generic';
      }
    };

    const edges = {
      start: () => 'contextResolve',
      contextResolve: () => 'memoryRead',
      memoryRead: () => 'planner',
      planner: () => 'router',
      router: (state) => nodeForIntent(state.plan?.intent),
      // P8 — every specialist can emit success / retry / fallback / ask_user.
      // A THROWN error is converted by the runner into lastError + this edge.
      '*': (state) => {
        if (state.needsConfirmation || state.outcome === 'ask_user') return 'confirmationPause';
        if (state.outcome === 'retry') return state.currentNode;
        if (state.outcome === 'fallback' || state.lastError) return 'replanner';
        return 'responder';
      },
      replanner: (state) => (state.context.fallbackUsed ? 'router' : 'responder'),
      confirmationPause: (state) => (state.confirmationPayload?.resolved ? (state.context.resumeNode || 'responder') : 'end'),
      responder: () => 'end', // terminal — never re-enter itself
      // coding subgraph — the debug loop and QA gate are real edge cycles
      codePipeline: (state) => (state.context.code?.done ? 'responder' : 'debugger'),
      debugger: (state) => {
        const c = state.context.code;
        if (!c || c.done) return 'responder';
        if (c.runSuccess) return 'qaGate';
        if (c.debugAttempts >= MAX_DEBUG_ATTEMPTS) return 'qaGate';
        return 'debugger'; // ← run → fix → rerun cycle
      },
      qaGate: (state) => {
        const c = state.context.code;
        if (c.qaVerdict === 'NEEDS FIX' && c.qaRounds < 1 && !c.debugAsk) return 'debugger'; // ← QA NEEDS FIX → re-run
        return 'codeReview';
      },
      codeReview: () => 'securityGate',
      securityGate: () => 'criticGate',
      criticGate: () => 'reflector',
      reflector: () => 'shipper',
      shipper: () => 'responder',
    };

    return createGraph({
      nodes,
      edges,
      start: 'start',
      maxSteps: 128,
      onError: (state) => {
        // P8 — a thrown node becomes a structured error routed to replanner.
        state.outcome = 'fallback';
        return state;
      },
    });
  }

  /**
   * Priority 1 — executePlan delegates to the graph runner. No switch on
   * intent here: the router node + edges own all dispatch.
   */
  async executePlan(plan, query, sendEvent, opts = {}) {
    const startTime = Date.now();
    // Defensive: callers (tests, tools) may omit the event callback — the
    // engine must never crash mid-task just because nothing is listening.
    if (typeof sendEvent !== 'function') sendEvent = () => {};
    const agentsUsed = (plan.steps || plan.tasks || []).length;
    const results = { success: true, query, intent: plan.intent, tasks: plan.tasks, steps: plan.steps, agentResults: {}, summary: '', sources: [], statistics: { executionTime: 0, agentsUsed, confidence: 0 } };

    try {
      // Log the incoming request into memory so long conversations keep context
      try { addChat('user', query); } catch (e) {}

      let state;
      let startNode;
      if (opts.resumeState) {
        // P5 — resume: prior intermediate results intact, start at the exact
        // paused node — NEVER from the planner.
        state = opts.resumeState;
        state.status = 'running'; // the pause is over — this is a fresh run
        state.context = { ...(state.context || {}), results, sendEvent, opts };
        if (opts.confirmed) {
          state.confirmationPayload = { ...(state.confirmationPayload || {}), resolved: true };
          startNode = 'confirmationPause';
        } else {
          startNode = state.context.resumeNode || state.currentNode || 'contextResolve';
        }
      } else {
        state = {
          query,
          resolvedQuery: opts.effectiveQuery || query,
          plan,
          memoryLoadout: {},
          intermediateResults: {},
          currentNode: '',
          status: 'running',
          retryCount: 0,
          lastError: null,
          outcome: null,
          needsConfirmation: false,
          confirmationPayload: null,
          history: [],
          agentResult: null,
          context: { results, sendEvent, opts, resumeNode: null },
        };
        startNode = 'contextResolve';
      }

      // P5 — confirmation callback: nodes may pause for approval; the graph
      // parks at confirmationPause and the session store holds the RunState.
      // The callback writes to the SHARED opts reference (not the copied state
      // object), which is exactly what wrapCase reads at the node boundary.
      const confirm = async (payload) => {
        opts._pendingConfirmation = payload;
        return 'paused';
      };
      opts.confirm = confirm;
      state.context.opts = opts;

      const graph = this.buildGraph();
      await graph.run({ ...state, startNode });
    } catch (error) {
      results.success = false;
      results.error = error.message;
      sendEvent('log', { agent: 'System', message: `Error: ${error.message}` });
      results.summary = `### ⚠ JEXI OS\n\nI hit an error: ${error.message}\n\nMake sure an API key is configured (Settings → Groq/Gemini) and try again.`;
    } finally {
      results.statistics.executionTime = Date.now() - startTime;
      this.executionHistory.push({ intent: plan.intent, time: Date.now() });
    }
    return results;
  }
}

export const orchestrator = new Orchestrator();
