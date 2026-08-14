import fs from 'fs';
import path from 'path';
import { createGraph } from './GraphRunner.js';
import { generateCode, applyFix } from './Architect.js';
import { planForBuild, qaWebApp, qaScripted, runReviewerPass, runSecurityPass, runCriticPass, runShipperPass, runReflectorPass, fixFromQA, isDebugQuery, gateVerdict } from './SkillChain.js';
import { runFile } from './Runner.js';
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
import { rosterStats } from './AgentRoster.js';
import {
  addChat, getChatHistory, clearMemory, updateUserProfile, loadMemory, topUserFacts,
  searchInternetKnowledge, searchFreshInternetKnowledge, searchCodingKnowledge,
  saveInternetKnowledge, saveCodingKnowledge, saveKnowledgeFile,
  getRollingSummary, getRecentEpisodes, rememberEpisode,
  semanticRecall, memoryForAgent, conversationTranscript,
} from './MemoryManager.js';
import { WORKSPACE_DIR, MANAGER_URL, PUBLIC_URL, MAX_DEBUG_ATTEMPTS } from '../config.js';

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
      const learned = await semanticRecall(query, { limit: 1 });
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
      return `### 📚 JEXI OS — FROM YOUR BOOKS\n\nI found this in **${top.title}** (direct quote — no AI key needed):\n\n> ${top.content.slice(0, 2500)}`;
    }

    const reply = await generateContent(
      `The user asked: \"${query}\"\n\nThe passages below come from the user's OWN books and knowledge library — they are the authoritative source for this answer.\n\n${context}\n\nAnswer the question using ONLY these passages. Rules:\n- Structure the answer clearly (headings, numbered points, tables where helpful).\n- Cite the source book after each point, e.g. (From \"Title\").\n- If the passages do not contain the answer, say so honestly instead of guessing or inventing.\n- Do NOT go outside these passages.`,
      JEXI_SYSTEM_PROMPT + preferencesBlock(),
      null,
      { temperature: 0.3 }
    );
    return `### 📚 JEXI OS — FROM YOUR BOOKS\n\n${reply}`;
  }

  /** Wrap an original switch-case body into a graph node (P1/P3/P8). */
  wrapCase(nodeName, body) {
    return async (state) => {
      const { results, sendEvent, opts } = state.context;
      const query = state.query;
      const plan = state.plan;
      await body({ results, sendEvent, query, plan, opts });
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
          results.summary = `### 🧠 JEXI OS — FROM MEMORY\n\n${remembered.answer}`;
          if (remembered.sources?.length) results.sources = remembered.sources.map(s => ({ title: s, link: s }));
          results.statistics.confidence = 92;
          return results;
        }
      } catch (e) {}

      // 3. Search the internet with the specialist Search Team
      //    (Query Analyzer → Searcher → Re-ranker → Extractor → Synthesizer).
      //    Pass the recent thread so references like "this course" resolve
      //    inside the team too (continuity across turns).
      const team = await runSearchTeam(query, sendEvent, { context: conversationTranscript(6) });
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

      // VERIFICATION LOOP (reflection engineering): a cheap Critic re-reads
      // the grounded answer against the sources and fixes invented/unsupported
      // claims before it reaches the user. Bounded to MAX 2 rounds.
      sendEvent('log', { agent: 'Critic', message: '🔎 Verifying the answer against its sources (fact-check pass)...' });
      const verified = await verifyAnswer({ query, draft: results.summary, sources: results.sources });
      if (verified.changed) {
        sendEvent('log', { agent: 'Critic', message: verified.verdict === 'verified' ? '✓ Answer verified clean after revision.' : '✍ Fixed unsupported claims — revised answer ready.' });
        results.summary = verified.text;
        try { addChat('jexi', results.summary); } catch (e) {}
        results.statistics.verification = { rounds: verified.rounds, verdict: verified.verdict };
      } else {
        sendEvent('log', { agent: 'Critic', message: '✓ Answer verified clean.' });
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
      results.summary = `### 📚 JEXI SCHOLAR\n\nI studied **${topic}** using the Trusted Library (Wikipedia, Project Gutenberg, arXiv, Open Library) and saved it to my knowledge library.\n\n${content.slice(0, 4000)}`;
      results.statistics.confidence = 100;
      return results;
    });

    N.knowledgeRecall = this.wrapCase('knowledgeRecall', async ({ results, sendEvent, query, plan }) => {
      const kb = plan.payload || (await recallKnowledge(query, sendEvent));
      if (kb) {
        let summary = await this.answerFromKnowledge(kb, query);
        const sources = (Array.isArray(kb) ? kb : [kb]).map(k => ({ title: k.title, link: '' }));
        // VERIFICATION LOOP — keep book answers grounded in the actual passages.
        sendEvent('log', { agent: 'Critic', message: '🔎 Checking the answer stays true to your book...' });
        const verified = await verifyAnswer({ query, draft: summary, sources });
        if (verified.changed) summary = verified.text;
        try { addChat('jexi', summary); } catch (e) {}
        results.summary = summary;
        results.sources = sources;
        results.statistics.confidence = 95;
        if (verified.changed) results.statistics.verification = { rounds: verified.rounds, verdict: verified.verdict };
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
          results.summary = `### 🧠 JEXI OS — FROM MEMORY (news I just gathered)\n\n${fresh.answer}`;
          if (fresh.sources?.length) results.sources = fresh.sources.map(s => ({ title: s, link: s }));
          results.statistics.confidence = 90;
          return results;
        }
      } catch (e) {}

      // 1. Run the specialist News Team
      //    (News Scout → News Filter → News Editor — free feeds, no API key)
      const team = await runNewsTeam(query, sendEvent);
      results.sources = team.sources;
      try { addChat('jexi', team.summary); } catch (e) {}
      results.summary = team.summary;
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
      try {
        const remembered = await searchCodingKnowledge(effQuery);
        if (remembered) {
          sendEvent('log', { agent: 'Memory Agent', message: '✓ Found a solution I built before — reusing it.' });
          results.summary = `### 🧠 JEXI OS — RECALLED FROM MEMORY\n\nI solved this before, so I'm giving you the verified solution.\n\n${remembered.solution}\n\n${remembered.files?.length ? `**Files:** ${remembered.files.join(', ')}` : ''}`;
          results.statistics.confidence = 95;
          c.done = true;
          return state; // edge → responder
        }
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
      // P1 — the DEBUG LOOP as a real graph cycle: debugger → debugger until
      // the code runs clean or the attempt budget is exhausted.
      const { sendEvent } = state.context;
      const c = state.context.code;
      if (c.done) return state;
      const scope = c.scope;
      const allowedWrite = (name) => !scope.paths || !scope.paths.length || scope.paths.some(p => name.includes(p));
      c.debugAttempts += 1;
      const entryPoint = c.entryPoint;
      sendEvent('log', { agent: 'Runner', message: `▶ Attempt ${c.debugAttempts}/${MAX_DEBUG_ATTEMPTS}: Running ${entryPoint}...` });
      const runResult = await runFile(entryPoint, (stream, data) => sendEvent('log', { agent: 'Terminal', message: String(data).slice(0, 200) }));
      c.lastOutput = runResult.output || '';

      const looksLikeError = /traceback|exception|syntaxerror|errno|no such file|modulenotfound|nameerror|importerror|attributeerror|typeerror|referenceerror|cannot find module|is not defined|command not found|failed/i.test(c.lastOutput);

      if (runResult.success && !looksLikeError) {
        sendEvent('log', { agent: 'Runner', message: '✅ Code ran successfully with no errors!' });
        if (runResult.url) c.previewUrl = runResult.url;
        c.runSuccess = true;
        // 3.5 SHOW HER WORK: open the finished web app in the virtual
        //     desktop's Chromium so the user watches it render live.
        if (c.previewUrl && /\.html$/i.test(entryPoint || '')) {
          try {
            await ensureBrowser();
            await new DesktopManager().goto('coder', c.previewUrl);
            sendEvent('log', { agent: 'Vision', message: `🖥 Showing the app in my virtual desktop: ${c.previewUrl}` });
          } catch (e) {
            sendEvent('log', { agent: 'Vision', message: `⚠ Could not open the app in the virtual desktop (the preview link still works): ${e.message}` });
          }
        }
        return state; // edge → qaGate
      }

      if (c.debugAttempts >= MAX_DEBUG_ATTEMPTS) {
        sendEvent('log', { agent: 'Debugger', message: `⚠ Max attempts reached (${MAX_DEBUG_ATTEMPTS}). Showing best effort.` });
        return state; // edge → qaGate (best effort)
      }

      sendEvent('log', { agent: 'Debugger', message: `⚠ Error on attempt ${c.debugAttempts}. Reading error and fixing...` });
      const errorContext = c.lastOutput.slice(-2000);
      const existingCode = readWorkspaceFile(entryPoint);

      try {
        const fixed = await applyFix(c.effQuery, errorContext, existingCode, c.debugAttempts + 1, sendEvent);
        if (fixed && fixed.files && fixed.files.length > 0) {
          fixed.files.forEach(f => {
            if (!allowedWrite(f.name)) { sendEvent('log', { agent: 'Coder', message: `⛔ /guard: skipping ${f.name} (outside allowed scope)` }); return; }
            fs.writeFileSync(path.join(WORKSPACE_DIR, f.name), f.code, 'utf-8');
          });
          c.entryPoint = fixed.entryPoint || entryPoint;
          sendEvent('log', { agent: 'Debugger', message: '✍ Rewrote code with fixes. Re-running...' });
        }
      } catch (e) {
        sendEvent('log', { agent: 'Debugger', message: `✗ Fix failed: ${e.message}` });
      }
      return state; // edge → debugger (the cycle)
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

      // QA gate enforcement: NEEDS FIX → the debug loop re-runs once and QA re-verifies.
      if (c.qaVerdict === 'NEEDS FIX' && c.qaRounds < 1 && !c.debugAsk) {
        sendEvent('log', { agent: 'QA Lead', message: '⛔ QA gate: NEEDS FIX — sending back to the coder.' });
        try {
          const fixedOnce = await fixFromQA({ query: c.effQuery, qaReport: c.qaReport, entryPoint: c.entryPoint, sendEvent });
          if (fixedOnce) {
            c.entryPoint = fixedOnce.entryPoint || c.entryPoint;
            c.qaRounds = 1;
            return state; // edge → debugger (re-run), then back here for re-verification
          }
        } catch (e) {}
      }

      // Second visit after the fix round — re-verify once.
      if (c.qaRounds >= 1 && c.previewUrl && /\.html$/i.test(c.entryPoint || '')) {
        try {
          c.qaReport = await qaWebApp({ previewUrl: c.previewUrl, brief: c.teamBrief || c.effQuery, scope, sendEvent });
          c.qaVerdict = gateVerdict(c.qaReport, ['PASS', 'NEEDS FIX']);
        } catch (e) {}
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
        const s = await runSecurityPass({ files: listWorkspaceFiles(), qaReport: c.qaReport, review: c.reviewNotes, sendEvent });
        c.securityNotes = s.security;
        c.secVerdict = s.verdict;

        // SECURITY GATE enforcement: BLOCKED → one enforced fix round
        // (coder rewrites, runner re-tests, Security Officer re-reviews),
        // then the verdict is final for this run.
        if (c.secVerdict === 'BLOCKED') {
          sendEvent('log', { agent: 'Security Officer', message: '⛔ SECURITY GATE BLOCKED — sending findings to the coder for a fix round.' });
          try {
            const secFix = await fixFromQA({ query: c.effQuery, qaReport: c.securityNotes, entryPoint: c.entryPoint, sendEvent });
            if (secFix) {
              sendEvent('log', { agent: 'Runner', message: '↻ Re-running after security fix...' });
              const rerun = await runFile(secFix.entryPoint, (s, d) => sendEvent('log', { agent: 'Terminal', message: String(d).slice(0, 160) }));
              if (rerun.url) c.previewUrl = rerun.url;
              const s2 = await runSecurityPass({ files: listWorkspaceFiles(), qaReport: c.qaReport, review: c.reviewNotes, sendEvent });
              c.securityNotes = s2.security;
              c.secVerdict = s2.verdict;
              sendEvent('log', { agent: 'Security Officer', message: c.secVerdict === 'BLOCKED' ? '⛔ Still BLOCKED after the fix round — issues need human attention.' : '✅ SECURITY GATE CLEARED after fix round.' });
            }
          } catch (e) {
            sendEvent('log', { agent: 'Security Officer', message: `⚠ Security fix round issue: ${e.message}` });
          }
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
      const files = listWorkspaceFiles();
      const fileSections = files.map(name => {
        const code = readWorkspaceFile(name);
        const lang = name.endsWith('.py') ? 'python' : name.endsWith('.js') ? 'javascript' : name.endsWith('.html') ? 'html' : name.endsWith('.css') ? 'css' : 'bash';
        return `#### 📄 ${name}\n\n\`\`\`${lang}\n${code.slice(0, 12000)}\n\`\`\``;
      }).join('\n\n');

      const linkBase = PUBLIC_URL || MANAGER_URL;
      const workspaceLinks = files.map(name => `- [${name}](${linkBase}/api/files/${name})`).join('\n');
      const finalOutput = c.lastOutput && c.lastOutput.trim() ? `\`\`\`bash\n${c.lastOutput.trim().slice(0, 1500)}\n\`\`\`` : '';

      const previewLine = c.previewUrl
        ? `\n\n**🔗 LIVE PREVIEW:** [Open ${c.entryPoint}](${c.previewUrl})\n*(hosted for free — works in any browser, share the link with anyone)*`
        : '';

      const teamLine = c.teamPlan
        ? '\n\n**🏢 Team:** Product → Designer → Engineer → Coder → QA Lead → Reviewer → Security Officer → Shipper → Reflector'
        : '\n\n**🏢 Team:** Coder → QA Lead → Reviewer → Security Officer → Shipper → Reflector';
      const qaSection = c.qaReport ? `\n\n**🧪 QA REPORT**\n${c.qaReport}` : '';
      const reviewSection = c.reviewNotes ? `\n\n**🔍 REVIEW NOTES**\n${c.reviewNotes}` : '';
      const securitySection = c.securityNotes ? `\n\n**🛡 SECURITY REVIEW**\n${c.securityNotes}` : '';
      const shipSection = c.shipNotes ? `\n\n**📦 SHIPPED**\n${c.shipNotes}` : '';
      const reflectSection = c.reflectionNotes ? `\n\n**♻ REFLECTION**\n${c.reflectionNotes}` : '';
      const planSection = c.teamPlan ? `\n\n**🛠 BUILD PLAN** (Product + Designer + Engineer)\n${c.teamPlan.split('\n').slice(0, 42).join('\n')}` : '';
      const gateNote = c.secVerdict === 'BLOCKED'
        ? '\n\n> ⛔ **Security gate BLOCKED shipping.** The app ran and is usable, but the Security Officer found issues that must be fixed before you rely on it. Ask me to fix the findings and re-ship.'
        : c.qaVerdict === 'NEEDS FIX'
          ? '\n\n> ⚠ **QA verdict: NEEDS FIX.** The app runs, but QA found issues — ask me to fix them.'
          : '';
      results.summary = `### 💻 JEXI TEAM — PLANNED, BUILT, TESTED & SHIPPED\n\n✅ The full agent team worked together: planned, wrote, ran, QA-tested, security-checked and reviewed your app.${teamLine}${previewLine}${qaSection}${reviewSection}${securitySection}${shipSection}${reflectSection}${gateNote}${planSection}\n\n${fileSections}\n\n**Test Output:**\n${finalOutput || '✓ Ran successfully.'}\n\n**Download the files:**\n${workspaceLinks}`;
      results.files = files;
      results.previewUrl = c.previewUrl || undefined;
      results.statistics.confidence = 100;

      // 5. Store the verified solution in memory
      try {
        const codeSummary = fileSections.replace(/```[\s\S]*?```/g, '```code```').slice(0, 8000);
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
