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
const PURE_CONTINUE_RE = /^(continue|resume|go on|keep (going|working|it up)|proceed|carry on|pick (it |things )?up|yes|yeah|ok(ay)?|more|go ahead|next|and|then|please|sure|alright|great|perfect|do it|make it|finish (it|this|that)|complete (it|this|that))\b/i;

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
    if (ref.confidence >= 0.4 && ref.candidates?.length) {
      return { classification: 'clarify', taskId: null, confidence: 0.4, reason: ref.reason, candidates: ref.candidates };
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
  if (ref.confidence >= 0.55 && ref.taskId) {
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

  // 2) Ambiguous reference → clarification (never guess).
  if (ref.confidence >= 0.4 && ref.candidates?.length) {
    return {
      classification: 'clarify',
      taskId: null,
      confidence: 0.4,
      reason: ref.reason,
      candidates: ref.candidates,
    };
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
