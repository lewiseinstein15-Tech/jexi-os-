/**
 * JEXI OS — Build 47: Conversation Manager.
 *
 * Decides what the latest user message MEANS in the conversation:
 *
 *   continue  → same task as the current one ("make it faster", "add auth")
 *   switch    → an existing older task ("go back to the server")
 *   new       → a genuinely new objective (topic switch or first message)
 *   clarify   → the reference is ambiguous — ask instead of guessing
 *
 * Deterministic by design (no LLM call in the hot path): it combines
 * continuation language, anaphoric references, task-registry resolution, and
 * topic-change heuristics. A cheap LLM rewrite (the existing
 * resolveConversationalQuery) still runs later for wording continuity.
 */

import { resolveTaskRef, getTask, taskContextBlock, taskStats, listTasks } from './TaskRegistry.js';
import { hasConversationalReference } from './MemoryManager.js';

/** Words/phrases that mean "keep doing what we're doing". */
const CONTINUE_WORDS = /\b(continue|resume|go on|keep (going|working|it)|carry on|proceed|pick (it )?up|and then|also (make|add|fix|change|build|create|write|show|explain)|make it|fix it|change that|do the same|next step|follow ?up|more (on|about|like)|ok(ay)?\b|yeah\b|yes\b|the same)\b/i;

/** Words that signal a switch back to an earlier subject. */
const SWITCH_WORDS = /\b(back to|go back|return to|let's? (go|return) back|switch (to|back)|the (first|other|previous|original) (task|one|thing)|what were we|before we|earlier\b|previous\b)\b/i;

/** Interruptions that redirect without referencing a task. */
const REDIRECT_WORDS = /\b(forget|ignore|drop|skip|pause|stop|wait|before that|on second thought)\b/i;

const NEW_TOPIC_WORDS = /\b(what is|what's|define|explain|calculate|solve|derive|evaluate|write (a|an)|build (a|an)|create (a|an)|make (a|an)|research|compare|analyze|how (do|does|can|is|to)|tell me about|why is|when did|who is)\b/i;

const QUESTION_WORDS = /\b(what|why|how|when|where|who|which|is|are|does|can|should|could)\b/i;

/** Bare "just keep going" fragments (no new subject named). */
const PURE_CONTINUE_RE = /^(continue|resume|go on|keep (going|working|it up)|proceed|carry on|pick (it |things )?up|yes|yeah|ok(ay)?|more|go ahead|next|and|then|please|sure|alright|great|perfect|do it|make it|finish (it|this|that)|complete (it|this|that))\b/i; // P4-OK

/** B53 P2 — a FRESH product objective: build/create/make/write/develop +
 * deliverable noun. These must NEVER silently continue the active task — a
 * different product gets its own taskId and its own workspace. */
const NEW_PRODUCT_RE = /\b(build|create|make|write|develop|code|implement)\b[^.!?\n]{0,100}\b(app(lication)?|website|web ?app|web ?page|game|quiz|calculator|tracker|planner|dashboard|tool|bot|extension|plugin|landing page|portfolio|template|scraper|script|notes?|todo|habit|budget|timer|stopwatch|converter|generator|monitor|panel|form|screen|component)\b/i;

/** B53 P3 — MODIFICATION language on the active product: "add dark mode",
 * "change the button color", "make the header sticky", "now also …". With an
 * active product task these are CONTINUE (same taskId, apply the edit), never
 * research on the word "change" and never a brand-new task. */
const MODIFY_RE = /^(?:can you |please |now |let'?s |also )?(add|change|update|fix|modify|improve|remove|restyle|redesign|restructure|tweak|polish|restyle|style|make the|make it|make my|make this|now also|also make)\b/i;

/** True when the message references the active task's own product framing
 * (its title or its specific deliverable noun), so NEW_PRODUCT_RE doesn't
 * misfire on "build the calculator app" style continuations. */
function refersToActiveTask(query, taskId) {
  if (!taskId) return false;
  const t = getTask(taskId);
  if (!t) return false;
  const ql = String(query || '').toLowerCase();
  const title = String(t.title || '').toLowerCase().trim();
  const obj = String(t.objective || '').toLowerCase().trim();
  const chunk = title.length >= 8 ? title.slice(0, Math.min(24, title.length)) : title;
  if (chunk.length >= 5 && ql.includes(chunk)) return true;
  const product = (obj.match(/\b(calculator|tracker|planner|dashboard|portfolio|timer|stopwatch|converter|generator|todo|habit|budget|notes|monitor|game|quiz|bot|extension|plugin|template|scraper)\b/) || [null])[0];
  if (product && new RegExp(`\\b${product}\\b`).test(ql)) return true;
  return false;
}

/**
 * Analyze a message against conversation + task state.
 * Returns { classification, taskId, confidence, reason, candidates, topic, contextBlock }.
 *
 * Order matters: explicit/named references first, then switch language, then
 * standalone questions (a topic switch is NEVER a continuation), then
 * continuation words, then corrections, then bare anaphora.
 */
export async function analyzeMessage(query, { currentTaskId = null, image = false } = {}) {
  const raw = String(query || '').trim();
  if (!raw) return { classification: 'new', taskId: null, confidence: 1, reason: 'empty' };

  // Images always attach to the current conversation.
  if (image) {
    const id = currentTaskId && getTask(currentTaskId) ? currentTaskId : null;
    return { classification: id ? 'continue' : 'new', taskId: id, confidence: 0.8, reason: 'image attaches to current context' };
  }

  // B48 P3 — a bare greeting/thanks is a FRESH TURN, never a continuation.
  // No task context may be injected, no prior memory may be forced. The
  // "hello → fabricated prior-conversation reply" failure mode starts exactly
  // here at the classification level: if a greeting were classified as
  // 'continue', the decision engine would inject the active task's context
  // block and the model would be tempted to "remember" things it never said.
  const GREETING_RE = /^(?:hi+|hii+|hey+|hello+|yo+|hiya+|howdy+|good (?:morning|afternoon|evening)|what'?s up|sup|how (?:are|r) you|thanks|thank you|thx|ty|bye+|goodbye|see (?:ya|you)|later|haha|lol)\b[\s.,!?]*$/i;
  if (GREETING_RE.test(raw)) {
    return { classification: 'new', taskId: null, confidence: 1, reason: 'greeting — fresh turn, no continuation context' };
  }

  // Short fragments ("continue", "make it faster", "add auth") are continuations
  // ONLY when they carry no topic signal — a question or switch word means the
  // short-cut must not swallow it ("What is the derivative of x³?" is new).
  const topicSignals = QUESTION_WORDS.test(raw) || SWITCH_WORDS.test(raw) || NEW_TOPIC_WORDS.test(raw) || looksLikeStandaloneQuestion(raw);
  if (raw.length < 30 && !topicSignals) {
    if (currentTaskId && getTask(currentTaskId)) {
      return { classification: 'continue', taskId: currentTaskId, confidence: 0.85, reason: 'short continuation fragment with active task' };
    }
    // No active task — resolve the ACTUAL message ("the server" may be a
    // named or ambiguous reference), never blanket-resume the most recent.
    const ref = resolveTaskRef(raw);
    if (ref.confidence >= 0.55 && ref.taskId) {
      const t = getTask(ref.taskId);
      return { classification: 'switch', taskId: t.id, confidence: 0.8, reason: ref.reason, topic: t.title, contextBlock: taskContextBlock(t) };
    }
    // B54 P2 — an ambiguous reference never stalls the conversation: default
    // to the most-recently-active candidate (LangGraph "thread = most recent"
    // pattern). Only a total lack of usable state would justify a question,
    // and that case is handled as a plain new turn instead.
    if (ref.confidence >= 0.4 && ref.candidates?.length) {
      const pick = bestCandidate(ref.candidates);
      if (pick) {
        const t = getTask(pick.id);
        return { classification: 'switch', taskId: t.id, confidence: 0.6, reason: `${ref.reason} — defaulted to the most recent match (${t.title})`, topic: t.title, contextBlock: taskContextBlock(t) };
      }
    }
    if (PURE_CONTINUE_RE.test(raw)) {
      const st = taskStats();
      if (st.total > 0) {
        const c = resolveTaskRef('continue');
        if (c.taskId) {
          const t = getTask(c.taskId);
          return { classification: 'switch', taskId: t.id, confidence: 0.8, reason: c.reason, topic: t.title, contextBlock: taskContextBlock(t) };
        }
      }
    }
    return { classification: 'new', taskId: null, confidence: 0.6, reason: 'short message, no task to continue' };
  }

  // 1) Explicit task-id / strong named reference ("task 2", "the dashboard").
  const ref = resolveTaskRef(raw);
  // B53 P2 — a FRESH build request ("build an app that tracks my calendar
  // events") must never be hijacked by a LOOSE generic-noun match ("app",
  // "website" appear in both messages) against the old product task. Only a
  // strong reference (verbatim title / entity, conf >= 0.85) or an explicit
  // mention of the active task's own product counts as a continuation.
  const refIsStrong = ref.confidence >= 0.85;
  const refNamesActiveProduct = ref.taskId ? refersToActiveTask(raw, ref.taskId) : false;
  const freshBuild = NEW_PRODUCT_RE.test(raw);
  const looseGenericRef = freshBuild && !refIsStrong && !refNamesActiveProduct && ref.confidence >= 0.55;
  if (ref.confidence >= 0.55 && ref.taskId && !looseGenericRef) {
    const t = getTask(ref.taskId);
    const isCurrent = t?.id === currentTaskId;
    return {
      classification: isCurrent ? 'continue' : 'switch',
      taskId: t.id,
      confidence: ref.confidence,
      reason: ref.reason,
      topic: t?.title || '',
      contextBlock: isCurrent ? '' : taskContextBlock(t),
    };
  }

  // 2) B54 P2 — ambiguous reference → DEFAULT, never clarify. The candidates
  //    are known tasks; the most-recently-active one is the right thread to
  //    continue (LangGraph picks the most recent thread the same way). The
  //    decision is logged so the user can correct it in one turn if wrong.
  if (ref.confidence >= 0.4 && ref.candidates?.length) {
    const pick = bestCandidate(ref.candidates);
    if (pick) {
      const t = getTask(pick.id);
      const isCurrent = t.id === currentTaskId;
      return {
        classification: isCurrent ? 'continue' : 'switch',
        taskId: t.id,
        confidence: 0.6,
        reason: `${ref.reason} — defaulted to the most recent match (${t.title})`,
        topic: t.title,
        contextBlock: isCurrent ? '' : taskContextBlock(t),
      };
    }
  }

  // 2.5) B53 P3 — MODIFICATION of the active product task. Runs after explicit
  //      refs ("add X to the calculator" resolves above) but before any
  //      question/new-topic logic, so "change the button color" with a live
  //      product NEVER becomes a research pass or a fresh task.
  if (MODIFY_RE.test(raw) && currentTaskId && getTask(currentTaskId)) {
    const t = getTask(currentTaskId);
    return { classification: 'continue', taskId: t.id, confidence: 0.85, reason: 'modification of the active product task', topic: t.title, contextBlock: '' };
  }

  // 2.6) B53 P2 — a FRESH product objective ("build an app that tracks my
  //      calendar events" after a calculator) is a NEW task with its OWN
  //      workspace — the previous product's files must not bleed into it.
  if (NEW_PRODUCT_RE.test(raw) && !refersToActiveTask(raw, currentTaskId)) {
    return { classification: 'new', taskId: null, confidence: 0.8, reason: 'new product objective — isolated from the previous task' };
  }

  // 3) Questions / new-topic language. Named refs were handled above; a
  //    standalone question (math, engineering, factual) is a TOPIC SWITCH even
  //    mid-task ("Actually, solve this equation…"); anything else is a
  //    follow-up about the current task ("explain what you changed").
  if (QUESTION_WORDS.test(raw) || NEW_TOPIC_WORDS.test(raw) || looksLikeStandaloneQuestion(raw)) {
    if (currentTaskId && looksLikeStandaloneQuestion(raw)) {
      return { classification: 'new', taskId: null, confidence: 0.7, reason: 'topic switch — standalone question' };
    }
    if (currentTaskId && getTask(currentTaskId)) {
      return { classification: 'continue', taskId: currentTaskId, confidence: 0.6, reason: 'question about current context' };
    }
    return { classification: 'new', taskId: null, confidence: 0.7, reason: 'fresh question' };
  }

  // 4) Continuation language ("and then", "also add", "make it") → the active
  //    task, or the referenced task when the ref resolved to another one.
  if (CONTINUE_WORDS.test(raw) && hasConversationalReference(raw)) {
    const target = ref.taskId && ref.confidence >= 0.55 ? ref.taskId : currentTaskId;
    if (target && getTask(target)) {
      const t = getTask(target);
      const isCurrent = t.id === currentTaskId;
      return {
        classification: isCurrent ? 'continue' : 'switch',
        taskId: t.id,
        confidence: isCurrent ? 0.8 : 0.7,
        reason: `${ref.reason || 'continuation language'}${isCurrent ? '' : ' — switching to prior task'}`,
        topic: t.title,
        contextBlock: isCurrent ? '' : taskContextBlock(t),
      };
    }
  }

  // 5) Redirects / corrections ("forget that", "pause", "on second thought")
  //    — keep the same task, adjust. High priority: a correction overrides the
  //    previous assumption ("no, I meant the frontend").
  if (REDIRECT_WORDS.test(raw)) {
    return { classification: 'continue', taskId: currentTaskId, confidence: 0.7, reason: 'correction/redirection of current context' };
  }

  // 6) Bare anaphoric reference ("it", "that", "this") → continue active task.
  if (hasConversationalReference(raw)) {
    return { classification: currentTaskId ? 'continue' : 'new', taskId: currentTaskId, confidence: 0.65, reason: 'anaphoric reference to conversation' };
  }

  // 7) Default: self-contained new instruction.
  return { classification: 'new', taskId: null, confidence: 0.6, reason: 'self-contained message' };
}

/** B54 P2 — pick the best candidate among ambiguous task matches: the one
 * with the most recent activity (the "current thread" by LangGraph semantics).
 * Falls back to the first candidate only if lastActivity is missing. */
function bestCandidate(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (!list.length) return null;
  const scored = list
    .map((c) => {
      const t = getTask(c && c.id);
      return { c, t, at: (t && t.lastActivity) || 0 };
    })
    .sort((a, b) => b.at - a.at);
  const top = scored[0];
  return top && top.t ? top.t : (list[0] ? getTask(list[0].id) : null);
}

/** Standalone question heuristics: math/engineering/factual — not the current project. */
function looksLikeStandaloneQuestion(q) {
  const s = String(q || '').toLowerCase();
  if (/(derivative|integral|solve|calculate|compute|evaluate|equation|matrix|beam|stress|load|force|velocity|acceleration|formula|what is the (value|sum|result)|how (much|many))/i.test(s)) return true;
  // "the derivative of x²", "2+2", "what's 15% of 200"
  if (/[\d]+\s*[+\-*/^]\s*[\d]/.test(s)) return true;
  return false;
}

/** Compact topic list for clarification prompts. */
export function listTopCandidates(limit = 4) {
  return listTasks().slice(0, limit).map((t) => ({ id: t.id, title: t.title, status: t.status }));
}

/**
 * Multi-task detection: split one message into independent sub-objectives.
 * "Fix the frontend and analyze the API" → ["Fix the frontend", "analyze the API"].
 * Returns [{ text }] — 1 element when the message is a single objective.
 *
 * A list INSIDE one objective ("build an app with auth and a database") is
 * NOT a multi-task message — only split when EVERY fragment after the first
 * reads as its own imperative (starts with an action verb).
 */
export function decomposeTasks(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const ACTION_VERB = /^(fix|build|create|make|write|analyze|check|research|debug|solve|review|update|add|remove|setup|set up|configure|test|explain|compare|design|implement|run|deploy|investigate|inspect|diagnose|explore|generate|improve|refactor|migrate|document|verify|calculate)\b/i;
  const parts = q
    .split(/\s+(?:and|then)\s+|\s*[,;]\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);
  if (parts.length < 2) return [{ text: q }];
  const allIndependent = parts.every((p, i) => i === 0 || ACTION_VERB.test(p));
  if (!allIndependent) return [{ text: q }];
  return parts.map((text) => ({ text }));
}
