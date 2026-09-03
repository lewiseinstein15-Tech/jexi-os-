/**
 * B208 — VERIFIER: work is not "done" because an employee said so.
 *
 * WORK → VERIFY → ACCEPT/REJECT → CONTINUE/RECOVER is enforced by the
 * Director calling this module for every substantive task. The check is a
 * rubric evaluation of the deliverable against the task's OWN success
 * criteria (written during interpretation) — plus basic acceptance gates
 * that run without any model at all.
 *
 * The verifier employee (Vera by default) is the identity that performs the
 * check; the model is, as always, swappable infrastructure.
 */

import { message } from './AgentMail.js';
import { parseModelJson } from './JsonRepair.js'; // B209

/** Model-free acceptance gates — cheap, deterministic, always on. */
export function acceptanceGates(deliverable, task) {
  const problems = [];
  const text = String(deliverable || '');
  if (!text.trim()) problems.push('The deliverable is empty.');
  if (/^(as an ai|i cannot|i'm sorry|sorry, but)/i.test(text.trim())) problems.push('The deliverable is a refusal, not work.');
  if (/(here is|here's) (a|the) (draft|attempt|version)[\s\S]{0,40}instead/i.test(text)) problems.push('The deliverable explicitly says it is not what was asked.');
  const minLen = Math.min(200, String(task.objective || '').length);
  if (text.trim().length < Math.max(40, minLen / 4)) problems.push('The deliverable is suspiciously short for the objective.');
  return problems;
}

/**
 * Verify a deliverable against the task's success criteria.
 *
 * @param {object} p { task, deliverable, criteria, verifierEmployee, llm, mailbox, hooks }
 *   llm: async ({system, user, prefer}) => JSON string (injected adapter parses it)
 * @returns { verdict:'pass'|'fail'|'degraded', score, problems, rationale }
 */
export async function verifyDeliverable(p) {
  const { task, deliverable, criteria = [], verifierEmployee, llm, mailbox, hooks = {} } = p;
  const emit = (type, data) => { try { hooks.onEvent?.({ type, ...data }); } catch { /* never break */ } };

  emit('VERIFICATION_STARTED', {
    agentId: verifierEmployee.agentId, agentName: verifierEmployee.displayName,
    summary: `${verifierEmployee.displayName} is checking the deliverable against ${criteria.length} success criteria.`,
  });

  // Gate 1 — deterministic acceptance problems (no model needed)
  const gateProblems = acceptanceGates(deliverable, task);

  // Gate 1.5 (B210) — EXECUTION HONESTY: a deliverable that claims commands
  // ran (timings, exit codes, "tests passed") without ANY real COMMAND_*/
  // TEST_* event in the task record is fabricating results. The event record
  // is the only source of truth for what actually executed.
  {
    const claimsExecution = /executed?\b|execution time|ran in \d|exit code? \d|tests? (all )?passed|\b\d+(\.\d+)?\s?ms\b/i.test(String(deliverable || ''));
    const hasRealExecution = (task?.events || []).some((e) => e.type === 'COMMAND_COMPLETED' || e.type === 'COMMAND_FAILED' || e.type === 'TEST_COMPLETED' || e.type === 'TEST_FAILED');
    if (claimsExecution && !hasRealExecution) {
      gateProblems.push('the deliverable claims execution results (timings/exit codes/test results) but NO command actually ran in this task — report only what really executed');
    }
  }

  // Gate 2 — rubric evaluation (model; verifier identity, routed preference)
  let rubric = { pass: gateProblems.length === 0, score: gateProblems.length ? 0.2 : 0.75, problems: gateProblems, rationale: 'deterministic gates only' };
  if (criteria.length) {
    try {
      const system = `You are ${verifierEmployee.displayName}, ${verifierEmployee.role} at JEXI OS. ${verifierEmployee.personality}.
You verify coworkers' work against explicit success criteria. You are strict but fair: a criterion is met only if the deliverable actually satisfies it. Never accept empty, evasive, or off-topic work.

Answer ONLY with JSON: {"pass": boolean, "score": 0.0-1.0, "problems": ["..."], "rationale": "one short operational line"}`;
      const user = `# OBJECTIVE\n${task.objective}\n\n# SUCCESS CRITERIA\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n# DELIVERABLE TO VERIFY\n${String(deliverable || '').slice(0, 30000)}\n\nIs this deliverable acceptable? JSON only.`;
      const raw = await llm({ system, user, prefer: 'gemini' });
      const parsed = extractJson(raw);
      if (parsed && typeof parsed.pass === 'boolean') {
        rubric = {
          pass: parsed.pass && gateProblems.length === 0,
          score: clamp01(parsed.score),
          problems: [...gateProblems, ...(Array.isArray(parsed.problems) ? parsed.problems.map(String).slice(0, 8) : [])],
          rationale: String(parsed.rationale || '').slice(0, 300) || 'rubric evaluation',
        };
      }
    } catch (e) {
      // verifier model failure degrades the CHECK, never the work silently:
      rubric.rationale = `rubric check unavailable (${String(e.message || e).slice(0, 80)}) — deterministic gates only`;
      if (gateProblems.length) rubric.pass = false;
      rubric.degraded = true;
    }
  }

  const verdict = rubric.pass ? (rubric.degraded ? 'degraded' : 'pass') : 'fail';
  emit(rubric.pass ? 'VERIFICATION_PASSED' : 'VERIFICATION_FAILED', {
    agentId: verifierEmployee.agentId, agentName: verifierEmployee.displayName,
    summary: rubric.pass
      ? `Verification passed (score ${rubric.score.toFixed(2)}).`
      : `Verification ${verdict}: ${rubric.problems.slice(0, 3).join('; ') || 'criteria not met'}`,
    severity: rubric.pass ? 'info' : 'warn',
  });
  mailbox.post(message({
    from: verifierEmployee.agentId, to: 'jexi', taskId: task.id,
    type: 'VERIFICATION', verdict, content: rubric.rationale, problems: rubric.problems, score: rubric.score,
  }));
  return { verdict, score: rubric.score, problems: rubric.problems, rationale: rubric.rationale };
}

function extractJson(text) {
  // B209 — same repair parser as the interpreter: a sloppy-but-complete
  // rubric must not read as "no verdict"
  return parseModelJson(text);
}

function clamp01(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0.5;
}
