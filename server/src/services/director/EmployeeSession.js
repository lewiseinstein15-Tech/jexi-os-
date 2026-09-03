/**
 * B208 — EMPLOYEE SESSION: one employee executing one assignment, for real.
 *
 * A session is where identity meets infrastructure:
 *   - the BRIEF is the structured task contract (objective, context, role,
 *     task, requirements, constraints, resources, expected output, success
 *     criteria, verification requirements, dependencies, priority, time
 *     budget, relevant previous results) — every field the spec demands;
 *   - the WORK is a real model call through the ModelRouter (identity kept,
 *     provider swappable), with REAL tool execution (web search, memory
 *     recall) when the assignment calls for it;
 *   - the RESULT is a structured deliverable + findings + confidence +
 *     claims + artifacts — parsed, not trusted blindly (the Verifier and
 *     the Supervisor check it).
 *
 * Failure typing is explicit so the Supervisor can choose the right
 * recovery action instead of a blanket "task failed":
 *   PROVIDER_FAILED | TIMEOUT | BAD_OUTPUT | TOOL_FAILED
 */

import { message, normalizeArtifact } from './AgentMail.js';
import { runWithModel } from './ModelRouter.js';

const SECTION_RE = (name) => new RegExp(`^##\\s+${name}\\s*$`, 'im');

/** Build the structured work brief (the employee's instructions from the boss). */
export function assembleBrief({ task, subtask, employee, dependencies = [], memorySlice = '', planContext = '' }) {
  return {
    objective: task.objective || task.effectiveQuery,
    context: [
      planContext ? `Where this fits: ${planContext}` : '',
      task.contextBlock ? `Conversation context:\n${task.contextBlock}` : '',
      memorySlice ? `What we already know (team memory):\n${String(memorySlice).slice(0, 2500)}` : '',
      dependencies.length
        ? `Relevant previous results from coworkers:\n${dependencies.map((d) => `- ${d.fromName || d.from}: ${String(d.content || '').slice(0, 1500)}`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n\n'),
    role: `${employee.displayName} — ${employee.role}. ${employee.description} You work as one employee of JEXI OS; JEXI is your boss and coordinates the team.`,
    task: subtask.title,
    taskDetails: subtask.details || '',
    requirements: subtask.requirements || [],
    constraints: [
      ...(task.constraints || []),
      ...(subtask.constraints || []),
      'Operational summaries only in updates — never expose private chain-of-thought.',
      'Never fabricate: if you did not verify something, mark it unverified.',
    ],
    availableResources: employee.supportedTools,
    expectedOutput: subtask.expectedOutput || 'A complete, self-contained deliverable for this subtask.',
    successCriteria: subtask.successCriteria || task.successCriteria || [],
    verificationRequirements: subtask.verify === false ? 'None (support work; the lead verifies the whole).' : 'Your deliverable will be checked against the success criteria by a reviewer.',
    dependencies: dependencies.map((d) => ({ from: d.from, type: d.type, title: d.title })),
    priority: subtask.priority || 'normal',
    timeBudgetMs: subtask.timeBudgetMs || 180000,
    relevantPreviousResults: dependencies.map((d) => ({ from: d.from, content: String(d.content || '').slice(0, 2000) })),
    searchQueries: subtask.searchQueries || [],
  };
}

/** The employee's system prompt: identity first, infrastructure invisible. */
export function employeeSystemPrompt(employee, brief) {
  return `You are ${employee.displayName}, ${employee.role} at JEXI OS.
Personality: ${employee.personality}.
${employee.description}

You are one employee on a team run by JEXI (your boss). Do YOUR part of the
objective — complete, professional, and self-contained. Your coworkers handle
the other parts; the lead combines them.

Rules:
- Deliver real substance. No filler, no meta-commentary about being an AI.
- If you ran searches or tools, ground your findings in what they returned
  and say so plainly ("Source: ...").
- If you did NOT verify something, label it "(unverified)".
- Keep any progress notes operational ("Compared 3 sources") — never expose private chain-of-thought in any section.

Answer in EXACTLY this structure (markdown):

## REPORT
2-6 operational lines: what you did and how you did it.

## DELIVERABLE
The actual work product — complete and directly usable. If it is a file,
deliver it as a fenced code block with the filename in the info string
(\`\`\`js app.js). This section is what the team ships.

## CONFIDENCE
high | medium | low — one short line why.

## CLAIMS
- Each factual claim you make, each with its source or (unverified).
${brief.searchQueries?.length || employee.supportedTools.includes('web-search') ? '\nYou have the web-search tool available; search results will be provided to you.' : ''}`;
}

/** Parse the structured employee output into a machine-readable result. */
export function parseEmployeeOutput(text) {
  const out = String(text || '');
  const split = (name) => {
    const m = out.match(new RegExp(`##\\s+${name}\\s*\\n?([\\s\\S]*?)(?=\\n##\\s|$)`, 'i'));
    return m ? m[1].trim() : '';
  };
  const deliverable = split('DELIVERABLE');
  const report = split('REPORT');
  const confidenceLine = (split('CONFIDENCE').match(/(high|medium|low)/i) || [])[1]?.toLowerCase() || 'medium';
  const claims = split('CLAIMS').split('\n').map((l) => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean).slice(0, 30);
  // fenced blocks with a filename in the info string become artifacts
  const artifacts = [];
  const fence = /```([^\n]*)\n([\s\S]*?)```/g;
  let m;
  while ((m = fence.exec(deliverable))) {
    const info = m[1].trim();
    // info string like "js app.js" or "app.js" — the filename is the last token
    const name = info.split(/\s+/).pop() || '';
    if (/\.(js|ts|jsx|py|html|css|json|md|txt|sh|yml|yaml)$/i.test(name) || name.includes('/')) {
      artifacts.push(normalizeArtifact({ kind: 'file', name, content: m[2] }));
    }
  }
  const bad = !deliverable && !report;
  return { report, deliverable, confidence: confidenceLine, claims, artifacts, raw: out.slice(0, 60000), bad };
}

/**
 * Run one employee assignment.
 *
 * @param {object} p { task, subtask, employee, brief, mailbox, hooks, llm, tools, searchTool }
 *   llm:  async ({system, user, prefer, onToken}) => text   (injected; real adapter in production)
 *   tools: optional { search: async (q) => string }          (injected; real executeTool in production)
 */
export async function runEmployeeSession(p) {
  const { task, subtask, employee, brief, mailbox, hooks = {}, llm, tools = null } = p;
  const emit = (a, b) => {
    // tolerant to both call shapes: emit('TYPE', {...}) and emit({type, ...})
    const evt = typeof a === 'string' ? { type: a, ...(b || {}) } : { ...(a || {}) };
    try { hooks.onEvent?.(evt); } catch { /* never break */ }
  };

  const t0 = Date.now();

  // 1) REAL TOOL PHASE — searches the employee was staffed to run.
  let toolContext = '';
  const wantsSearch = (brief.searchQueries || []).length > 0 && employee.supportedTools.includes('web-search');
  if (wantsSearch) {
    for (const q of brief.searchQueries.slice(0, 3)) {
      emit('TOOL_STARTED', { agentId: employee.agentId, agentName: employee.displayName, summary: `Searching: ${q}` });
      try {
        const resultText = await tools.search(q);
        toolContext += `\n\n[web-search results for "${q}"]\n${String(resultText || '').slice(0, 12000)}`;
        emit('TOOL_COMPLETED', { agentId: employee.agentId, agentName: employee.displayName, summary: `Search returned sources for "${q}".` });
        mailbox.post(message({
          from: employee.agentId, to: 'jexi', taskId: task.id, subtaskId: subtask.id,
          type: 'FINDING', content: `Ran a search for "${q}" — ${countSources(resultText)} sources to work through.`, title: q,
        }));
      } catch (e) {
        emit('TOOL_FAILED', { agentId: employee.agentId, agentName: employee.displayName, summary: `Search failed for "${q}" — ${String(e.message || e).slice(0, 80)}`, severity: 'warn' });
        // tool failure is not fatal: the employee proceeds with less material
      }
    }
  }

  // 2) MODEL PHASE — the actual work, on the router ladder (identity preserved).
  const userPrompt = buildUserPrompt(brief, toolContext);
  let parsed;
  try {
    const raw = await withTimeout(
      runWithModel(
        employee,
        subtask.capability || 'reasoning',
        ({ prefer }) => llm({ system: employeeSystemPrompt(employee, brief), user: userPrompt, prefer, onToken: hooks.onToken }),
        { onEvent: emit },
      ),
      brief.timeBudgetMs,
    );
    parsed = parseEmployeeOutput(raw);
    if (parsed.bad) {
      const err = new Error('employee output unparseable or empty');
      err.code = 'BAD_OUTPUT';
      throw err;
    }
  } catch (e) {
    if (!e.code) { e.code = /timeout/i.test(String(e.message || '')) ? 'TIMEOUT' : isProviderErr(e) ? 'PROVIDER_FAILED' : 'BAD_OUTPUT'; }
    mailbox.post(message({
      from: employee.agentId, to: 'jexi', taskId: task.id, subtaskId: subtask.id,
      type: 'FAILURE', content: `${employee.displayName} could not complete "${subtask.title}": ${String(e.message || e).slice(0, 200)}`,
    }));
    throw e;
  }

  const ms = Date.now() - t0;

  // 3) RESULT — structured, artifact-carrying, recorded in the mailbox.
  const resultMessage = mailbox.post(message({
    from: employee.agentId, to: 'jexi', taskId: task.id, subtaskId: subtask.id,
    type: 'RESULT',
    title: subtask.title,
    content: parsed.deliverable || parsed.report,
    report: parsed.report,
    confidence: parsed.confidence,
    claims: parsed.claims,
    artifacts: parsed.artifacts,
    ms,
  }));
  emit('TASK_COMPLETED', {
    agentId: employee.agentId, agentName: employee.displayName,
    summary: `${employee.displayName} delivered: ${subtask.title}`,
    data: { subtaskId: subtask.id, ms, confidence: parsed.confidence, artifacts: parsed.artifacts.length },
  });
  return { message: resultMessage, parsed, ms };
}

function buildUserPrompt(brief, toolContext) {
  const lines = [];
  lines.push(`# OBJECTIVE\n${brief.objective}`);
  if (brief.context) lines.push(`# CONTEXT\n${brief.context}`);
  lines.push(`# YOUR ASSIGNMENT\n${brief.task}${brief.taskDetails ? `\n\n${brief.taskDetails}` : ''}`);
  if (brief.requirements?.length) lines.push(`# REQUIREMENTS\n${brief.requirements.map((r) => `- ${r}`).join('\n')}`);
  if (brief.constraints?.length) lines.push(`# CONSTRAINTS\n${brief.constraints.map((c) => `- ${c}`).join('\n')}`);
  if (brief.successCriteria?.length) lines.push(`# SUCCESS CRITERIA (your work is checked against these)\n${brief.successCriteria.map((c) => `- ${c}`).join('\n')}`);
  if (brief.expectedOutput) lines.push(`# EXPECTED OUTPUT\n${brief.expectedOutput}`);
  if (toolContext) lines.push(`# SEARCH RESULTS (your tool output — ground your findings in these)\n${toolContext}`);
  lines.push(`# PRIORITY\n${brief.priority} · time budget ${Math.round(brief.timeBudgetMs / 1000)}s`);
  return lines.join('\n\n');
}

function countSources(text) {
  const t = String(text || '');
  return (t.match(/https?:\/\//g) || []).length || 'several';
}

function isProviderErr(e) {
  const msg = String(e?.message || e || '').toLowerCase();
  return /rate|quota|429|503|timeout|econn|fetch failed|network|all ai providers failed|api key/.test(msg);
}

function withTimeout(promise, ms) {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  let timer;
  return Promise.race([
    promise,
    new Promise((_, rej) => { timer = setTimeout(() => { const e = new Error(`assignment exceeded its ${Math.round(ms / 1000)}s time budget`); e.code = 'TIMEOUT'; rej(e); }, ms); }),
  ]).finally(() => clearTimeout(timer));
}
