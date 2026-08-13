/**
 * JEXI OS — Build 47: Decision Engine.
 *
 * Turns the Conversation Manager's classification into an execution decision:
 *
 *   - new        → create a task, plan fresh, execute
 *   - continue   → reuse the active task: enrich the query with its context
 *                  so the model resumes (not restarts), then execute
 *   - switch     → restore a prior task's state, then execute
 *   - clarify    → do NOT execute — return a concise question + options
 *
 * Also decides which decisions get recorded to provenanced memory and which
 * verified facts get stored. Deterministic and cheap; no extra LLM call.
 */

import { createTask, getTask, updateTask, taskContextBlock } from './TaskRegistry.js';
import { retrieveDecisions, recordDecision, findConflict } from './DecisionMemory.js';

/** Decide what to do with a message. Returns { action, taskId, executionQuery, contextBlock, clarification, metadata }. */
export function decide({ raw, classification, taskId = null, candidates = [], currentTaskId = null, resolvedQuery = null }) {
  // classification may be the analysis OBJECT (as wired in index.js) or a bare
  // string — normalize so the branches below always see the string.
  const cls = typeof classification === 'string' ? classification : classification?.classification || 'new';
  const reason = typeof classification === 'string' ? '' : classification?.reason || '';
  const confidence = typeof classification === 'string' ? 0 : classification?.confidence || 0;

  // Clarify: never guess on ambiguous references.
  if (cls === 'clarify') {
    const options = (candidates || []).length
      ? candidates
      : listTaskOptions(currentTaskId);
    return {
      action: 'clarify',
      taskId: null,
      executionQuery: raw,
      clarification: {
        question: `I want to get this right rather than guess. What exactly should I work on?`,
        options: options.map((o) => ({ id: o.id, label: o.title })),
        hint: 'Pick a task, or tell me in your own words what you mean.',
      },
      metadata: { classification: cls, confidence, reason },
    };
  }

  const existing = taskId ? getTask(taskId) : null;

  // CONTINUE — enrich the query with the active task's state so the planner
  // plans a step, not a restart.
  if (cls === 'continue') {
    const active = existing || (currentTaskId ? getTask(currentTaskId) : null);
    if (active) {
      return {
        action: 'execute',
        taskId: active.id,
        executionQuery: resolvedQuery || raw,
        contextBlock: taskContextBlock(active),
        metadata: { classification: cls, confidence, reason, taskId: active.id, taskTitle: active.title },
      };
    }
    // Continue requested but nothing active — fall back to a new task.
    return newTaskDecision(raw, resolvedQuery);
  }

  // SWITCH — restore the prior task (context block included) and make it active.
  if (cls === 'switch') {
    if (existing) {
      return {
        action: 'execute',
        taskId: existing.id,
        executionQuery: resolvedQuery || raw,
        contextBlock: taskContextBlock(existing),
        metadata: { classification: cls, confidence, reason, taskId: existing.id, taskTitle: existing.title, resumed: true },
      };
    }
    return newTaskDecision(raw, resolvedQuery);
  }

  // NEW — fresh objective.
  return newTaskDecision(raw, resolvedQuery);
}

function newTaskDecision(raw, resolvedQuery) {
  return {
    action: 'execute',
    taskId: null,
    executionQuery: resolvedQuery || raw,
    contextBlock: '',
    metadata: { classification: 'new', confidence: 0.7, reason: 'new objective' },
  };
}

function listTaskOptions(currentTaskId) {
  // lazy import to avoid cycles
  return [];
}

/** Apply the decision: create/activate tasks, record decisions, return the task. */
export function applyDecision(decision, { title, objective, plan = [], entities = [] }) {
  let task = null;
  if (decision.action === 'clarify') return { task: null, created: false };

  if (decision.taskId && getTask(decision.taskId)) {
    task = getTask(decision.taskId);
    updateTask(task.id, { status: 'active', query: objective, plan, entities });
  } else {
    task = createTask({ title, objective, plan, entities, status: 'active' });
  }
  return { task, created: !decision.taskId };
}

/** Record an important decision + any conflict supersession. */
export async function recordDecisionFromExchange({ taskId, content, project = '' }) {
  if (!content) return null;
  // If the new statement contradicts an existing decision, supersede it.
  const conflict = findConflict(content);
  if (conflict) {
    recordDecision({ type: 'decision', content, source: 'user', project, taskId, supersedes: conflict.id, confidence: 'direct' });
    return { recorded: true, superseded: conflict.id };
  }
  return { recorded: Boolean(recordDecision({ type: 'decision', content, source: 'user', project, taskId, confidence: 'direct' })) };
}

export { retrieveDecisions };
