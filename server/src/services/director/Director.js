/**
 * B208 — THE DIRECTOR: JEXI as the boss of a team of AI employees.
 *
 * USER → JEXI → EMPLOYEES → JEXI → USER
 *
 * This is the real orchestration loop (every stage emits canonical events;
 * nothing here is scripted theater):
 *
 *   UNDERSTAND  interpret the raw message (intent, ambiguity, assumptions)
 *   REFINE      reconstruct a proper internal objective + success criteria
 *   PLAN        decompose into subtasks with capabilities & dependencies
 *   STAFF       capability-driven employee selection (lead + supporters)
 *   DELEGATE    structured briefs over the AgentMail protocol
 *   EXECUTE     real employee sessions (routed models, real tools)
 *   SUPERVISE   budgets, failure typing, recovery ladder
 *   VERIFY      rubric verification against the task's own criteria
 *   RECOVER     retry / switch model / rebrief / reassign / replan / escalate
 *   REPORT      JEXI's own personality, format matched to the task
 *
 * Degradation is honest: if the interpreter can't run (no keys, provider
 * down), the Director DECLINES and the legacy pipeline takes the turn —
 * it never pretends to have understood.
 */

import { DirectorTask, teamEvent } from './TaskState.js';
import { TaskMailbox, message, mailToActivityLine } from './AgentMail.js';
import { rankEmployees, selectEmployee, getEmployee } from './Employees.js';
import { telemetry } from './Telemetry.js';
import { runEmployeeSession, assembleBrief } from './EmployeeSession.js';
import { verifyDeliverable, acceptanceGates } from './Verifier.js';
import { isProviderError } from './ModelRouter.js';

const MAX_SUBTASKS = 5;
const MAX_PARALLEL = 3;
const MAX_CORRECTION_ROUNDS = 2;

/** Recovery ladder (Supervisor). Order matters: cheapest & safest first. */
function recoveryAction(err, attempt, opts = {}) {
  const code = err?.code || (isProviderError(err) ? 'PROVIDER_FAILED' : 'BAD_OUTPUT');
  if (code === 'PROVIDER_FAILED' || code === 'TIMEOUT') {
    if (attempt < 1) return 'RETRY';               // one straight retry
    if (attempt < 2) return 'REASSIGN';            // different employee, same brief
    return 'ESCALATE';
  }
  // BAD_OUTPUT / TOOL_FAILED / anything else
  if (attempt < 1) return 'REBRIEF';               // sharper instructions, same employee
  if (attempt < 2 && !opts.noReassign) return 'REASSIGN';
  return 'ESCALATE';
}

export class Director {
  /**
   * @param {object} adapters — injectable seams (tests pass fakes):
   *   llm.interpret({prompt}) → refinement JSON (parsed)
   *   llm.employee({system, user, prefer, onToken}) → text
   *   llm.verify({system, user, prefer}) → JSON text
   *   llm.report({system, user, onToken}) → text
   *   tools.search(query) → results text
   *   departments.build(ctx) → { summary, ok }   (legacy heavy-build pipeline)
   */
  constructor(adapters = {}) {
    this.llm = adapters.llm;
    this.tools = adapters.tools;
    this.departments = adapters.departments || {};
  }

  /**
   * Run one full turn as the boss. Returns a turn result, or {decline} to
   * hand the turn to the legacy pipeline (honest degradation).
   */
  async runTurn(ctx) {
    const {
      raw, effectiveQuery, contextBlock = '', convId = 'default',
      sendEvent = () => {}, image = null, memoryContext = '', activeTaskId = null,
    } = ctx;

    if (!this.llm) return { decline: 'no llm adapter' };

    const task = new DirectorTask({ conversationId: convId, rawQuery: raw, effectiveQuery, contextBlock });
    const mailbox = new TaskMailbox(task.id);
    const nameFor = (id) => (id === 'jexi' ? 'JEXI' : getEmployee(id)?.displayName || id);

    // ── event plumbing: canonical team events + legacy panel/log mirrors ──
    const emit = (fields) => {
      const evt = teamEvent(task, fields);
      task.addEvent(evt);
      try { sendEvent('team', { event: evt }); } catch { /* client may be gone; work continues */ }
      if (evt.type !== 'OBJECTIVE_INTERPRETED') {
        try { sendEvent('log', { agent: evt.agentName, message: evt.summary }); } catch { /* same */ }
      }
      return evt;
    };
    const narrate = (text) => { if (text) { try { sendEvent('narration', { text }); } catch { /* same */ } } };
    // B208 — the final report types out live, like every JEXI answer
    const hooks_report_onToken = (t) => { try { sendEvent('stream', { text: t, by: 'JEXI' }); } catch { /* same */ } };

    task.setState('INTERPRETING');
    emit({ type: 'OBJECTIVE_RECEIVED', summary: 'Understanding your request…' });

    // ── 1) UNDERSTAND + REFINE ─────────────────────────────────────────────
    let refinement;
    try {
      refinement = await this.llm.interpret({ raw, effectiveQuery, contextBlock, memoryContext, activeTaskId, image });
    } catch (e) {
      task.setState('FAILED', `interpretation unavailable: ${e.message}`);
      return { decline: `interpretation failed: ${String(e.message || e).slice(0, 120)}` };
    }
    const ok = validateRefinement(refinement);
    if (!ok.valid) {
      task.setState('FAILED', 'interpretation invalid');
      return { decline: `invalid interpretation: ${ok.reason}` };
    }

    task.objective = refinement.refinedObjective;
    task.refinement = refinement;
    task.assumptions = refinement.assumptions || [];
    task.constraints = refinement.constraints || [];
    task.successCriteria = refinement.successCriteria || [];
    task._persist();

    emit({
      type: 'OBJECTIVE_INTERPRETED', title: refinement.understood,
      summary: `Objective refined: ${String(refinement.refinedObjective).slice(0, 200)}`,
      data: { ambiguity: refinement.ambiguity, taskType: refinement.taskType, complexity: refinement.complexity },
    });
    narrate(refinement.userLine);

    // Genuinely unresolvable AND risky → ask instead of guessing.
    if (refinement.ambiguity === 'high' && refinement.risky && refinement.clarifyingQuestion) {
      task.setState('BLOCKED', 'needs clarification');
      emit({ type: 'TASK_BLOCKED', summary: 'This needs one answer from you before I risk doing the wrong thing.', severity: 'warn' });
      return {
        success: true,
        summary: `${refinement.clarifyingQuestion}\n\n*I'd rather ask than guess on something like this — give me the go-ahead and I'll run it.*`,
        statistics: { directed: true, blocked: true, taskId: task.id },
      };
    }

    // ── 2) PLAN ─────────────────────────────────────────────────────────────
    task.setState('PLANNING');
    const plan = normalizePlan(refinement, task);
    task.plan = plan;
    task.leadEmployeeId = null;
    emit({
      type: 'PLAN_CREATED',
      summary: plan.subtasks.length === 1
        ? `Plan: one focused assignment (${plan.subtasks[0].title}).`
        : `Plan: ${plan.subtasks.length} assignments — ${plan.subtasks.map((s) => s.title).join(' → ')}.`,
      data: { subtasks: plan.subtasks.map((s) => ({ id: s.id, title: s.title, capability: s.capability, dependsOn: s.dependsOn })) },
    });

    // ── 3) STAFF (capability-driven selection) ─────────────────────────────
    task.setState('ASSIGNING');
    const staffed = [];
    const usedEmployees = new Set();
    for (const subtask of plan.subtasks) {
      if (subtask.department) {
        const lead = getEmployee('forge') || selectEmployee(['code']); // engineering owns the build department
        staffed.push({ subtask, employee: lead, role: 'lead' });
        usedEmployees.add(lead.agentId);
        emit({ type: 'EMPLOYEE_SELECTED', agentId: lead.agentId, agentName: lead.displayName, summary: `${lead.displayName} takes the build — she's the responsible engineer for this one.`, data: { subtaskId: subtask.id, department: subtask.department } });
        continue;
      }
      const employee = selectEmployee(subtask.requirements?.length ? subtask.requirements : [subtask.capability], { exclude: usedEmployees, fallback: 'echo' });
      usedEmployees.add(employee.agentId);
      const role = subtask.id === plan.leadSubtaskId ? 'lead' : 'support';
      staffed.push({ subtask, employee, role });
      emit({
        type: 'EMPLOYEE_SELECTED', agentId: employee.agentId, agentName: employee.displayName,
        summary: subtask.id === plan.leadSubtaskId
          ? `${employee.displayName} leads this — ${subtask.title}.`
          : `Assigning ${employee.displayName} to ${subtask.title}.`,
        data: { subtaskId: subtask.id, role, matched: subtask.requirements },
      });
    }
    task.assignments = staffed.map(({ subtask, employee, role }) => ({ subtaskId: subtask.id, employeeId: employee.agentId, role, status: 'assigned', attempts: 0 }));
    const leadStaff = staffed.find((s) => s.subtask.id === plan.leadSubtaskId) || staffed[staffed.length - 1];
    task.leadEmployeeId = leadStaff.employee.agentId;
    task._persist();

    for (const { subtask, employee } of staffed) {
      mailbox.post(message({
        from: 'jexi', to: employee.agentId, taskId: task.id, subtaskId: subtask.id,
        type: 'TASK_ASSIGNMENT', title: subtask.title, content: subtask.details || subtask.title, priority: subtask.priority || 'normal',
      }));
      emit({ type: 'TASK_ASSIGNED', agentId: employee.agentId, agentName: employee.displayName, summary: `Assignment delivered: ${subtask.title}.`, data: { subtaskId: subtask.id } });
    }
    narrate(composeAssignmentLine(refinement, staffed, plan));

    // ── 4) EXECUTE + SUPERVISE (dependency waves, recovery ladder) ─────────
    task.setState('RUNNING');
    const results = new Map(); // subtaskId → RESULT message
    const waves = dependencyWaves(plan.subtasks);
    for (const wave of waves) {
      const running = wave.slice(0, MAX_PARALLEL).map(async (subtask) => {
        const staffing = staffed.find((s) => s.subtask.id === subtask.id);
        const resultMsg = await this.runAssignmentWithRecovery({
          task, subtask, staffing, staffed, results, mailbox, emit, narrate, nameFor,
        });
        if (resultMsg) results.set(subtask.id, resultMsg);
      });
      await Promise.all(running);
    }

    const failed = plan.subtasks.filter((s) => !results.get(s.id));
    const leadResult = results.get(plan.leadSubtaskId) || [...results.values()][results.size - 1] || null;

    if (!leadResult && failed.length) {
      task.setState('FAILED', 'lead assignment failed');
      emit({ type: 'TASK_FAILED', summary: `The run failed: ${failed.map((f) => f.title).join(', ')}. I'm not going to pretend otherwise.`, severity: 'error' });
      return {
        success: false,
        summary: `I couldn't get this one done. ${failed.map((f) => `**${f.title}**`).join(' and ')} failed after recovery attempts — here's what happened and what I'd try next:\n\n- ${task.recoveries.slice(-3).map((r) => `${r.action} after ${r.reason}`).join('\n- ') || 'the model lanes were unavailable'}\n\nWant me to retry the whole thing, or approach it differently?`,
        statistics: { directed: true, success: false, taskId: task.id, recoveries: task.recoveries.length },
      };
    }

    // ── 5) VERIFY (accept/reject; correction loop with the lead) ───────────
    let verification = null;
    if (refinement.needsVerification && leadResult) {
      task.setState('VERIFYING');
      const verifier = selectEmployee(['verification'], { fallback: 'vera' });
      emit({ type: 'EMPLOYEE_SELECTED', agentId: verifier.agentId, agentName: verifier.displayName, summary: `${verifier.displayName} will check the result before it reaches you.` });
      let deliverable = String(leadResult.content || '');
      let round = 0;
      while (round < MAX_CORRECTION_ROUNDS) {
        verification = await verifyDeliverable({
          task, deliverable, criteria: task.successCriteria, verifierEmployee: verifier,
          llm: (a) => this.llm.verify(a), mailbox, hooks: { onEvent: (e) => emit({ ...e, agentId: e.agentId || verifier.agentId, agentName: e.agentName || verifier.displayName }) },
        });
        if (verification.verdict !== 'fail') break;
        round += 1;
        if (round >= MAX_CORRECTION_ROUNDS) break;
        task.setState('RECOVERING', 'verification correction');
        emit({ type: 'RECOVERY_STARTED', agentId: leadStaff.employee.agentId, agentName: leadStaff.employee.displayName, summary: `${leadStaff.employee.displayName}'s work didn't pass verification — sending it back with the problems.`, severity: 'warn' });
        mailbox.post(message({
          from: 'jexi', to: leadStaff.employee.agentId, taskId: task.id, subtaskId: plan.leadSubtaskId,
          type: 'CORRECTION', content: verification.problems.join('\n'), title: 'Verification problems to fix',
        }));
        const corrected = await this.runEmployeeWork({ task, subtask: plan.subtasks.find((s) => s.id === plan.leadSubtaskId), employee: leadStaff.employee, mailbox, emit, extraInstructions: `Your previous attempt failed verification. Fix these specific problems:\n${verification.problems.map((p) => `- ${p}`).join('\n')}\n\nPrevious deliverable:\n${deliverable.slice(0, 6000)}` });
        if (corrected) deliverable = String(corrected.content || deliverable);
        task.setState('VERIFYING', 're-checking');
      }
      task.verification = { ...verification, rounds: round };
      telemetry.record('employee', verifier.agentId, { ok: verification.verdict !== 'fail', verify: verification.verdict === 'pass' });
      if (verification.verdict === 'fail') {
        task.setState('COMPLETED', 'accepted with warning');
        narrate("I'm not fully satisfied with verification — bringing it to you with the problems listed, not pretending it's clean.");
        leadResult.content = deliverable;
      } else {
        task.setState('COMPLETED');
        narrate(verification.verdict === 'degraded'
          ? 'Done — verification ran on reduced checks; I flagged what I could confirm.'
          : `Results verified — ${verifier.displayName} signed off on it.`);
      }
    } else {
      task.setState('COMPLETED');
    }

    // ── 6) REPORT (JEXI's voice; format fits the task) ─────────────────────
    const teamRecap = staffed.filter((s) => results.get(s.subtask.id)).map(({ subtask, employee }) => ({
      name: employee.displayName, role: employee.role, work: subtask.title,
      confidence: results.get(subtask.id)?.confidence || null, ms: results.get(subtask.id)?.ms || null,
    }));
    const finalSummary = await this.composeReport({ task, refinement, leadResult, results, verification, teamRecap, emit, onToken: hooks_report_onToken });

    task.result = { summary: finalSummary.slice(0, 4000), verification: task.verification, team: teamRecap };
    task._persist();
    emit({ type: 'TASK_COMPLETED', summary: 'Done — result delivered.', data: { team: teamRecap.map((t) => t.name) } });

    for (const { employee } of staffed) {
      telemetry.record('employee', employee.agentId, { ok: Boolean(results.get(staffed.find((s) => s.employee === employee)?.subtask.id)) });
    }

    return {
      success: true,
      summary: finalSummary,
      statistics: {
        directed: true, taskId: task.id,
        employees: teamRecap.map((t) => t.name),
        lead: nameFor(task.leadEmployeeId),
        verification: task.verification ? task.verification.verdict : 'skipped',
        recoveries: task.recoveries.length,
        subtasks: plan.subtasks.length,
      },
    };
  }

  /** One assignment with the full recovery ladder around the session. */
  async runAssignmentWithRecovery({ task, subtask, staffing, staffed, results, mailbox, emit, narrate, nameFor }) {
    let attempt = 0;
    let current = staffing;
    while (attempt < 3) {
      const t0 = Date.now();
      try {
        const deps = (subtask.dependsOn || []).map((id) => results.get(id)).filter(Boolean).map((r) => ({ ...r, fromName: nameFor(r.from) }));
        const result = await this.runEmployeeWork({ task, subtask, employee: current.employee, mailbox, emit, deps });
        telemetry.record('employee', current.employee.agentId, { ok: true, ms: Date.now() - t0 });
        return result;
      } catch (err) {
        const action = recoveryAction(err, attempt, { noReassign: staffed.length === 1 });
        task.recordRecovery({ subtaskId: subtask.id, employeeId: current.employee.agentId, action, reason: String(err.message || err).slice(0, 160), ok: false });
        emit({ type: 'RECOVERY_STARTED', agentId: current.employee.agentId, agentName: current.employee.displayName, summary: recoveryLine(current.employee, action, err), severity: 'warn' });
        attempt += 1;
        if (action === 'RETRY') continue;
        if (action === 'REBRIEF') continue; // next attempt passes sharper instructions
        if (action === 'REASSIGN') {
          const next = rankEmployees(subtask.requirements || [subtask.capability], { exclude: new Set([current.employee.agentId]) })[0]?.employee;
          if (next) {
            mailbox.post(message({ from: 'jexi', to: current.employee.agentId, taskId: task.id, subtaskId: subtask.id, type: 'HANDOFF', content: 'Reassigning this to a coworker better placed to finish it.' }));
            current = { subtask, employee: next, role: staffing.role };
            emit({ type: 'EMPLOYEE_HANDOFF', agentId: next.agentId, agentName: next.displayName, summary: `${current.employee.displayName} is taking over "${subtask.title}".` });
            continue;
          }
        }
        if (action === 'ESCALATE') {
          emit({ type: 'ERROR_DETECTED', agentId: current.employee.agentId, agentName: current.employee.displayName, summary: `I couldn't get "${subtask.title}" through even after recovery. Escalating honestly.`, severity: 'error' });
          return null;
        }
      }
    }
    return null;
  }

  /** The actual employee session (shared by first runs and correction rounds). */
  async runEmployeeWork({ task, subtask, employee, mailbox, emit, deps = [], extraInstructions = '' }) {
    // DEPARTMENT delegation: heavy industrial pipelines run under an employee's responsibility.
    if (subtask.department && this.departments[subtask.department]) {
      emit({ type: 'TASK_STARTED', agentId: employee.agentId, agentName: employee.displayName, summary: `${employee.displayName} is running the ${subtask.department} department for this.` });
      const dep = await this.departments[subtask.department]({ task, subtask, employee });
      const msg = mailbox.post(message({
        from: employee.agentId, to: 'jexi', taskId: task.id, subtaskId: subtask.id, type: 'RESULT',
        title: subtask.title, content: String(dep?.summary || ''), confidence: dep?.ok === false ? 'low' : 'medium',
        artifacts: [], report: 'ran the engineering department',
      }));
      return msg;
    }
    const brief = assembleBrief({
      task, subtask, employee, dependencies: deps,
      memorySlice: subtask.memorySlice || '',
      planContext: task.plan?.subtasks?.length > 1 ? `part ${subtask.id} of ${task.plan.subtasks.length}` : '',
    });
    if (extraInstructions) brief.taskDetails = `${brief.taskDetails || ''}\n\n${extraInstructions}`.trim();
    emit({ type: 'TASK_STARTED', agentId: employee.agentId, agentName: employee.displayName, summary: `${employee.displayName} started: ${subtask.title}.` });
    const { message: msg } = await runEmployeeSession({ task, subtask, employee, brief, mailbox, hooks: { onEvent: emit, onToken: null }, llm: (a) => this.llm.employee(a), tools: this.tools });
    for (const artifact of msg.artifacts || []) task.addArtifact(artifact);
    return msg;
  }

  /** JEXI's final answer — her voice, the format the task calls for, honest about what ran. */
  async composeReport({ task, refinement, leadResult, results, verification, teamRecap, emit, onToken }) {
    try {
      const system = `You are JEXI — the boss of a small team of AI employees, reporting to Lewis, your user.
Voice: intelligent, confident, composed; occasionally playful, professional when it matters. NEVER open with "Sure!", "Of course!", "Absolutely!" or any stock chatbot opener — vary your openers naturally, like a person would.
You are reporting on real work your employees just finished. Credit them by name for what they ACTUALLY did (the execution record is provided — never invent work). If verification found problems, say so plainly. If anything failed or was skipped, say so plainly.
Format the answer to fit the work (${refinement.formatHint || 'work-report'}): a research finding reads like a brief; code delivery shows the code/result; a big team effort gets a team-delivery recap. Never dump process internals — the useful result is the star. End with next-step offer only when it's genuinely useful.
Your answer IS the final user-facing message. Deliverable content should be presented usefully (it may be included verbatim where appropriate).`;
      const user = [
        `# ORIGINAL REQUEST (from the user, verbatim)\n"${task.rawQuery.slice(0, 500)}"`,
        `# REFINED OBJECTIVE\n${task.objective}`,
        task.assumptions.length ? `# ASSUMPTIONS MADE\n${task.assumptions.map((a) => `- ${a}`).join('\n')}` : '',
        task.successCriteria.length ? `# SUCCESS CRITERIA\n${task.successCriteria.map((c) => `- ${c}`).join('\n')}` : '',
        `# EXECUTION RECORD (what actually ran)`,
        teamRecap.map((t) => `- ${t.name} (${t.role}) — ${t.work}${t.confidence ? ` [confidence: ${t.confidence}]` : ''}`).join('\n'),
        task.recoveries.length ? `# RECOVERY EVENTS (real)\n${task.recoveries.map((r) => `- ${r.action}: ${r.reason}`).join('\n')}` : '',
        verification ? `# VERIFICATION\nverdict: ${verification.verdict} · score ${verification.score}${verification.problems?.length ? `\nproblems: ${verification.problems.join('; ')}` : ''}` : '# VERIFICATION\nskipped (not needed for this task type)',
        `# LEAD DELIVERABLE (the substance — present this usefully)`,
        String(leadResult?.content || '').slice(0, 20000),
        leadResult?.claims?.length ? `# CLAIMS TO KEEP HONEST\n${leadResult.claims.map((c) => `- ${c}`).join('\n')}` : '',
      ].filter(Boolean).join('\n\n');
      const text = await this.llm.report({ system, user, ...(onToken ? { onToken } : {}) });
      if (text && text.trim()) return text.trim();
    } catch (e) {
      emit({ type: 'ERROR_DETECTED', summary: `Report writer unavailable — delivering the lead employee's work directly.`, severity: 'warn' });
    }
    // Honest fallback: the verified deliverable itself, clearly framed.
    const head = `${pickOpener()} ${nameLine(teamRecap, verification)}`;
    return `${head}\n\n${String(leadResult?.content || 'The work completed but no deliverable was captured.').slice(0, 15000)}`;
  }
}

/* ── plan normalization: trust the LLM's shape, enforce the contract ── */
function validateRefinement(r) {
  if (!r || typeof r !== 'object') return { valid: false, reason: 'not an object' };
  if (!r.refinedObjective || typeof r.refinedObjective !== 'string') return { valid: false, reason: 'missing refinedObjective' };
  if (!r.taskType || typeof r.taskType !== 'string') return { valid: false, reason: 'missing taskType' };
  if (!Array.isArray(r.subtasks) || !r.subtasks.length) return { valid: false, reason: 'missing subtasks' };
  return { valid: true };
}

function normalizePlan(refinement, task) {
  let subtasks = (refinement.subtasks || []).slice(0, MAX_SUBTASKS).map((s, i) => ({
    id: `st${i + 1}`,
    title: String(s.title || `Part ${i + 1}`).slice(0, 160),
    details: String(s.details || '').slice(0, 2000),
    capability: String(s.capability || 'reasoning').toLowerCase(),
    requirements: Array.isArray(s.requirements) ? s.requirements.map(String).slice(0, 6) : [String(s.capability || 'reasoning')],
    dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.map((d) => Number(d)).filter(Number.isInteger) : [],
    searchQueries: Array.isArray(s.searchQueries) ? s.searchQueries.map(String).slice(0, 3) : [],
    expectedOutput: String(s.expectedOutput || '').slice(0, 500),
    priority: ['low', 'normal', 'high'].includes(s.priority) ? s.priority : 'normal',
    verify: s.verify !== false,
    department: typeof s.department === 'string' ? s.department : null,
  }));
  // single-subtask tasks are trivially consistent
  if (subtasks.length === 1) subtasks[0].dependsOn = [];
  // dependency indices must point backwards (no cycles, no self-reference)
  subtasks.forEach((s, i) => { s.dependsOn = [...new Set(s.dependsOn)].filter((d) => d < i); });
  const leadSubtaskId = subtasks[subtasks.length - 1].id; // the consolidating subtask
  return { subtasks, leadSubtaskId, parallel: subtasks.length > 1 };
}

/** Group subtasks into executable waves (topological order by dependency index). */
function dependencyWaves(subtasks) {
  const done = new Set();
  const waves = [];
  let remaining = [...subtasks];
  while (remaining.length) {
    const wave = remaining.filter((s) => (s.dependsOn || []).every((d) => done.has(`st${d + 1}`) || done.has(d)));
    if (!wave.length) { waves.push(remaining); break; } // safety: malformed deps → run the rest
    waves.push(wave);
    wave.forEach((w) => done.add(w.id));
    remaining = remaining.filter((s) => !wave.includes(s));
  }
  return waves;
}

function recoveryLine(employee, action, err) {
  const why = String(err?.message || err).slice(0, 90);
  switch (action) {
    case 'RETRY': return `${employee.displayName} hit a snag (${why}) — one retry before anything drastic.`;
    case 'REBRIEF': return `${employee.displayName}'s output wasn't usable — I'm re-instructing more precisely instead of accepting bad work.`;
    case 'REASSIGN': return `This isn't ${employee.displayName}'s strength (${why}) — handing it to a coworker.`;
    default: return `Recovery exhausted for ${employee.displayName} — ${why}.`;
  }
}

function composeAssignmentLine(refinement, staffed, plan) {
  const leads = staffed.filter((s) => s.subtask.id === plan.leadSubtaskId).map((s) => s.employee.displayName);
  const supports = staffed.filter((s) => s.subtask.id !== plan.leadSubtaskId).map((s) => s.employee.displayName);
  if (supports.length) return `${leads[0]} leads this one${supports.length ? `, with ${supports.join(' and ')} supporting` : ''}. I'll check the result before it comes back to you.`;
  return `${leads[0] || 'The team'} is on it. I'll check the result before it comes back to you.`;
}

function pickOpener() {
  const openers = ['Done.', 'That one ran clean.', 'Finished.', "Here's where it landed.", 'All set.'];
  return openers[Math.floor(Math.random() * openers.length)];
}

function nameLine(teamRecap, verification) {
  const names = [...new Set(teamRecap.map((t) => t.name))];
  const v = verification ? (verification.verdict === 'pass' ? ' Verified before sending.' : '') : '';
  return names.length > 1 ? `Team delivery: ${names.join(', ')}.${v}` : `${names[0] || 'The team'} delivered.${v}`;
}
