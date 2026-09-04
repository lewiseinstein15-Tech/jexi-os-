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
import { Supervisor } from './Supervisor.js'; // B209 — live mid-work supervision
import { checkToolPermission } from './Permissions.js'; // B209 — enforced tool gates
import { runEmployeeCommand, isTestCommand, validateCommand } from './CommandRunner.js'; // B210 — real command execution for employees
import { runBrowserRound, browserToolInstructions } from './ComputerOps.js'; // B211 B3 — real browser driving for computer-ops employees
import { sanitizeWorkProduct } from '../ModelCoworkers.js'; // B209/B210 — model ids never enter work product, but CODE FENCES are never corrupted
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT_DIR = path.join(HERE, '..', '..', '..', 'jexi-workspace', 'director');

/** B210 — command rounds per assignment (request → run → react; bounded). */
const MAX_COMMAND_ROUNDS = 2;

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
${brief.searchQueries?.length || employee.supportedTools.includes('web-search') ? '\nYou have the web-search tool available; search results will be provided to you.' : ''}${employee.supportedTools.includes('run-command') ? '\n\nYou can EXECUTE COMMANDS in your task workspace: write files as fenced artifact blocks (they land in the workspace), then put each command alone in a fenced block with `run` as the info string:\n\n```run\nnode analysis.js\n```\n\nAllowed binaries: node, node --test, python3, ls, cat, head, tail, wc, grep, echo, diff. Scripts run as CommonJS (use require, not import). NO shell features (no pipes, no &&, no redirects) — one plain command per block. The REAL output (exit code + stdout/stderr) comes back to you, and you then deliver the final structured answer grounded in the actual results.\nCRITICAL HONESTY RULE: if the assignment needs executed output, you MUST run it with a run block. NEVER claim a command ran, invent its output, timings, or environment details — if you did not receive it in COMMAND RESULTS, it did not happen: say so instead.' : ''}${employee.supportedTools.includes('browser-act') ? browserToolInstructions() : ''}`;
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
  // B209 — the NEEDS channel (optional): "## NEEDS\nblocking: true\nquestion: ..."
  const needsBlock = split('NEEDS');
  let needs = null;
  if (needsBlock) {
    const blocking = /blocking:\s*true/i.test(needsBlock);
    const q = (needsBlock.match(/question:\s*([\s\S]*)/i) || [])[1] || needsBlock;
    needs = { blocking, question: q.trim().slice(0, 500) };
  }
  const bad = !deliverable && !report;
  return { report, deliverable, confidence: confidenceLine, claims, artifacts, needs, raw: out.slice(0, 60000), bad };
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
  if (wantsSearch && !checkToolPermission(employee, 'web-search').allowed) {
    // B209 — the permission gate is enforced BEFORE the tool runs
    const gate = checkToolPermission(employee, 'web-search');
    emit('PERMISSION_DENIED', { agentId: employee.agentId, agentName: employee.displayName, summary: `Search blocked: ${gate.reason}.`, severity: 'warn' });
  }
  if (wantsSearch && checkToolPermission(employee, 'web-search').allowed) {
    for (const q of brief.searchQueries.slice(0, 3)) {
      emit('TOOL_STARTED', { agentId: employee.agentId, agentName: employee.displayName, summary: `Searching: ${q}` });
      emit('SEARCH_STARTED', { agentId: employee.agentId, agentName: employee.displayName, summary: `Search: ${q}` });
      try {
        const resultText = await tools.search(q);
        toolContext += `\n\n[web-search results for "${q}"]\n${String(resultText || '').slice(0, 12000)}`;
        emit('TOOL_COMPLETED', { agentId: employee.agentId, agentName: employee.displayName, summary: `Search returned sources for "${q}".` });
        emit('SEARCH_COMPLETED', { agentId: employee.agentId, agentName: employee.displayName, summary: `Search finished: ${q}.` });
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

  // 2) MODEL PHASE — the actual work, SUPERVISED LIVE (B209): JEXI watches
  // the token stream; if a deterministic watcher or the checkpoint review
  // decides the approach is off-track, the generation is abandoned, the
  // employee gets a RECOVERY message, and the assignment restarts with the
  // redirect instruction (bounded: one redirect per assignment).
  const userPrompt = buildUserPrompt(brief, toolContext);
  let parsed;
  let commandRounds = 0; // B210 — command-loop state (visible to the RESULT message)
  let totalCommandsExecuted = 0;
  let browserRounds = 0; // B211 B3 — browser-loop state (observe→act→observe→verify)
  let totalBrowserActions = 0;
  const MAX_BROWSER_ROUNDS = 3;
  const persistedArtifactNames = new Set(); // B210 — artifacts persisted in-loop aren't re-persisted later
  const persistedArtifactBytes = new Map(); // B212 — name → bytes: a later same-name artifact with DIFFERENT content is a fix-in-place
  const persistParsedArtifacts = (p) => {
    for (const artifact of (p && p.artifacts) || []) {
      const bytes = Buffer.byteLength(String(artifact?.content || ''));
      if (persistedArtifactNames.has(artifact.name)) {
        // B212 — fix-in-place: the employee rewrote a file she wrote in an
        // earlier round of THIS session (e.g. after a real failing test run).
        // The file MUST land on disk; identical content is a no-op.
        if (persistedArtifactBytes.get(artifact.name) === bytes) continue;
        const gate = checkToolPermission(employee, 'file-write');
        if (!gate.allowed) {
          emit('PERMISSION_DENIED', { agentId: employee.agentId, agentName: employee.displayName, summary: `File update skipped: ${gate.reason}.`, severity: 'warn' });
          continue;
        }
        try {
          const written = persistArtifact(task.workspaceId || task.id, artifact);
          persistedArtifactBytes.set(artifact.name, written.bytes);
          emit('FILE_UPDATED', {
            agentId: employee.agentId, agentName: employee.displayName,
            summary: `${employee.displayName} updated ${written.name} (${written.bytes} bytes) — fix-in-place.`,
            data: { file: written.name, bytes: written.bytes },
          });
        } catch (e) {
          emit('TOOL_FAILED', { agentId: employee.agentId, agentName: employee.displayName, summary: `Artifact update failed (${String(e.message || e).slice(0, 80)}) — the earlier version stays.`, severity: 'warn' });
        }
        continue;
      }
      const gate = checkToolPermission(employee, 'file-write');
      if (!gate.allowed) {
        emit('PERMISSION_DENIED', { agentId: employee.agentId, agentName: employee.displayName, summary: `File write skipped: ${gate.reason}.`, severity: 'warn' });
        continue;
      }
      try {
        const written = persistArtifact(task.workspaceId || task.id, artifact);
        persistedArtifactNames.add(artifact.name);
        persistedArtifactBytes.set(artifact.name, written.bytes);
        emit('FILE_CREATED', { agentId: employee.agentId, agentName: employee.displayName, summary: `${employee.displayName} wrote ${written.name} (${written.bytes} bytes).`, data: { file: written.name, bytes: written.bytes } });
      } catch (e) {
        emit('TOOL_FAILED', { agentId: employee.agentId, agentName: employee.displayName, summary: `Artifact write failed (${String(e.message || e).slice(0, 80)}) — it stays in the task record.`, severity: 'warn' });
      }
    }
  };
  try {
    let commandContext = '';
    let browserContext = ''; // B211 B3 — real page state fed back to computer-ops employees
    // B210 — the COMMAND LOOP: an employee with EXECUTE permission may put
    // ```run blocks in her output. Each round: her artifacts land in the task
    // workspace FIRST (so the scripts exist), the commands REALLY execute
    // there (allowlisted, no shell, scrubbed env, bounded), and the actual
    // output comes back to her for the next round. Bounded: 2 rounds.
    // B211 B3 — the BROWSER LOOP rides the same rounds: ```browser blocks
    // from a computer-ops employee (browser-act tool + COMPUTER permission)
    // really execute against the virtual desktop and the REAL observed page
    // state comes back. Bounded: 3 rounds, 4 actions per round.
    for (let round = 0; round <= MAX_COMMAND_ROUNDS + MAX_BROWSER_ROUNDS; round++) {
      const raw = await withTimeout(
        generateWithSupervision({
          employee, subtask, brief, task, mailbox, hooks, emit, llm,
          userPrompt: [userPrompt, commandContext, browserContext].filter(Boolean).join('\n\n'),
          review: hooks.review || null,
          liveReview: hooks.liveReview !== false,
        }),
        brief.timeBudgetMs,
      );
      // B209 — model/provider identifiers NEVER enter work product (masked to
      // coworker names by the same B162 masking the whole app uses)
      const clean = sanitizeWorkProduct(String(raw || ''));
      parsed = parseEmployeeOutput(clean);
      if (parsed.bad) {
        const err = new Error('employee output unparseable or empty');
        err.code = 'BAD_OUTPUT';
        throw err;
      }
      const requests = extractCommandRequests(clean);
      const browserLines = extractBrowserRequests(clean); // B211 B3
      if (!requests.length && !browserLines.length) break; // done — no tool requests
      // ---- B210 command phase (unchanged semantics, budget per-tool) ----
      if (requests.length) {
        const gate = checkToolPermission(employee, 'run-command');
        if (!gate.allowed) {
          emit('PERMISSION_DENIED', { agentId: employee.agentId, agentName: employee.displayName, summary: `Command skipped: ${gate.reason}.`, severity: 'warn' });
          break;
        }
        if (commandRounds >= MAX_COMMAND_ROUNDS) {
          // B210 semantics preserved: a command-requesting employee with no
          // browser work pending stops here (bounded tool loop). Browser
          // requests may still continue below (their own budget).
          if (!browserLines.length) break;
          commandContext += `\n\n# COMMAND BUDGET USED\nNo more command rounds (${MAX_COMMAND_ROUNDS} max) — deliver from the results you already have.`;
        } else {
        commandRounds++;
        // scripts land BEFORE commands run (the employee's files must exist)
        persistParsedArtifacts(parsed);
      const results = [];
      for (const cmd of requests.slice(0, 4)) {
        const asTest = isTestCommand(cmd);
        const cmdLabel = cmd.length > 70 ? `${cmd.slice(0, 67)}…` : cmd;
        emit(asTest ? 'TEST_STARTED' : 'COMMAND_STARTED', {
          agentId: employee.agentId, agentName: employee.displayName,
          summary: `${employee.displayName} runs \`${cmdLabel}\`${asTest ? ' (tests)' : ''}.`,
          data: { command: cmd, round: commandRounds },
        });
        totalCommandsExecuted++;
        const r = await runEmployeeCommand({ taskId: task.id, workspaceId: task.workspaceId || null, command: cmd });
        const evtType = asTest
          ? (r.ok ? 'TEST_COMPLETED' : 'TEST_FAILED')
          : (r.ok ? 'COMMAND_COMPLETED' : 'COMMAND_FAILED');
        const verdict = r.blocked ? `blocked (${r.reason})`
          : r.timedOut ? `timed out after ${r.ms}ms`
          : r.ok ? `exit 0 in ${r.ms}ms` : `exit ${r.exitCode} in ${r.ms}ms`;
        emit(evtType, {
          agentId: employee.agentId, agentName: employee.displayName,
          summary: `\`${cmdLabel}\` → ${verdict}.${asTest ? (r.ok ? ' Tests passed.' : ' Tests FAILED.') : ''}`,
          severity: r.ok ? 'info' : 'warn',
          data: { command: cmd, exitCode: r.exitCode, ms: r.ms, bytes: r.output.length, round: commandRounds },
        });
        results.push(`$ ${cmd}\n[exit ${r.exitCode}${r.timedOut ? ' · timed out' : ''}${r.blocked ? ` · ${r.reason}` : ''}]\n${r.output || '(no output)'}`);
      }
      commandContext += `\n\n# COMMAND RESULTS (real execution in your task workspace — round ${commandRounds})\n${results.join('\n\n')}\n\nDeliver your final structured output now (REPORT / DELIVERABLE / CONFIDENCE), using the real results above. You may run one more round of commands if genuinely needed.`;
        }
      }

      // ---- B211 B3 browser phase: real computer use, honest when unavailable ----
      if (browserLines.length) {
        const bgate = checkToolPermission(employee, 'browser-act');
        if (!bgate.allowed) {
          emit('PERMISSION_DENIED', { agentId: employee.agentId, agentName: employee.displayName, summary: `Browser action skipped: ${bgate.reason}.`, severity: 'warn' });
          break;
        }
        if (browserRounds >= MAX_BROWSER_ROUNDS) {
          if (!requests.length) break; // nothing else pending — the tool loop is done
          browserContext += `\n\n# BROWSER BUDGET USED\nNo more browser rounds (${MAX_BROWSER_ROUNDS} max) — deliver from what you actually observed.`;
        } else {
          browserRounds++;
          totalBrowserActions += browserLines.length;
          const br = await runBrowserRound({
            lines: browserLines, emit,
            identity: { agentId: employee.agentId, agentName: employee.displayName },
          });
          if (br.blocked) {
            browserContext += `\n\n# BROWSER UNAVAILABLE (real capability check)\n${br.reason}\nNever claim you browsed, opened, or read anything — report honestly that the browser is unavailable in this environment.`;
          } else {
            const acts = br.results.map((r) => `- ${r.summary}${r.ok ? '' : ` — FAILED: ${r.detail || ''}`}`).join('\n');
            const obs = br.observation || {};
            const elList = (obs.elements || []).map((e) => `  #${e.id} <${e.tag}${e.type ? ` type=${e.type}` : ''}> ${String(e.text || e.placeholder || '').slice(0, 60)}`).join('\n');
            browserContext += `\n\n# BROWSER RESULTS (real virtual-desktop state — round ${browserRounds})\nActions:\n${acts}\n\nObserved page:${obs.title ? ` title "${obs.title}"` : ''} ${obs.elementCount ?? '?'} interactive element(s), ${obs.textChars ?? '?'} chars of text.\nElements:\n${elList || '  (none listed)'}\nPage text (first part):\n${obs.textSnippet || '(empty)'}\n\nDecide your next step from what the page ACTUALLY shows. You may act again (browser block) or deliver your final structured output (REPORT / DELIVERABLE / CONFIDENCE) grounded in the real state above.`;
          }
        }
      }
    }
  } catch (e) {
    if (e?.code === 'REDIRECT') {
      // a redirect that could not be honored (budget exhausted mid-redirect)
      const err = new Error('assignment redirected but the retry did not complete');
      err.code = 'BAD_OUTPUT';
      mailbox.post(message({
        from: employee.agentId, to: 'jexi', taskId: task.id, subtaskId: subtask.id,
        type: 'FAILURE', content: `${employee.displayName} was redirected mid-work but the retry did not complete: ${String(e.message || e).slice(0, 160)}`,
      }));
      throw err;
    }
    if (!e.code) { e.code = /timeout/i.test(String(e.message || '')) ? 'TIMEOUT' : isProviderErr(e) ? 'PROVIDER_FAILED' : 'BAD_OUTPUT'; }
    mailbox.post(message({
      from: employee.agentId, to: 'jexi', taskId: task.id, subtaskId: subtask.id,
      type: 'FAILURE', content: `${employee.displayName} could not complete "${subtask.title}": ${String(e.message || e).slice(0, 200)}`,
    }));
    throw e;
  }

  // B209 — the NEEDS channel: an employee may flag what she's missing.
  //   blocking: true  → the work cannot proceed without an answer
  //   blocking: false → an assumption she made that the boss should know
  if (parsed.needs && parsed.needs.question) {
    mailbox.post(message({
      from: employee.agentId, to: 'jexi', taskId: task.id, subtaskId: subtask.id,
      type: 'QUESTION', content: parsed.needs.question, blocking: Boolean(parsed.needs.blocking),
      title: parsed.needs.blocking ? 'Blocking question' : 'Flagged assumption',
    }));
  }

  // B209 — artifacts actually land on disk (permission-gated, path-safe),
  // each one a FILE_CREATED canonical event. (B210: ones already persisted
  // during a command round are skipped here.)
  for (const artifact of (parsed.artifacts || []).filter((a) => !persistedArtifactNames.has(a.name))) {
    const gate = checkToolPermission(employee, 'file-write');
    if (!gate.allowed) {
      emit('PERMISSION_DENIED', { agentId: employee.agentId, agentName: employee.displayName, summary: `File write skipped: ${gate.reason}.`, severity: 'warn' });
      continue;
    }
    try {
      const written = persistArtifact(task.workspaceId || task.id, artifact);
      if (written) emit('FILE_CREATED', { agentId: employee.agentId, agentName: employee.displayName, summary: `${employee.displayName} wrote ${written.name} (${written.bytes} bytes).`, data: { file: written.name, bytes: written.bytes } });
    } catch (e) {
      emit('TOOL_FAILED', { agentId: employee.agentId, agentName: employee.displayName, summary: `Artifact write failed (${String(e.message || e).slice(0, 80)}) — it stays in the task record.`, severity: 'warn' });
    }
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
    needs: parsed.needs || null, // B209 — the NEEDS channel rides the result
    ms,
    data: { commandsExecuted: totalCommandsExecuted, browserActions: totalBrowserActions }, // B210 backstop reads commandsExecuted; B211 B3 adds browserActions
  }));
  emit('TASK_COMPLETED', {
    agentId: employee.agentId, agentName: employee.displayName,
    summary: `${employee.displayName} delivered: ${subtask.title}`,
    data: { subtaskId: subtask.id, ms, confidence: parsed.confidence, artifacts: parsed.artifacts.length, commandsExecuted: commandRounds > 0 ? totalCommandsExecuted : 0, browserActions: browserRounds > 0 ? totalBrowserActions : 0 },
  });
  return { message: resultMessage, parsed, ms };
}

/**
 * B209 — SUPERVISED GENERATION: the employee's model call runs against a
 * live Supervisor. A redirect decision aborts the output, tells the
 * employee over AgentMail, and restarts ONCE with the instruction.
 */
async function generateWithSupervision({ employee, subtask, brief, task, mailbox, hooks, emit, llm, userPrompt, review, liveReview }) {
  let redirectInstruction = null;
  for (let attempt = 0; attempt <= 1; attempt++) {
    const finalPrompt = redirectInstruction
      ? `${userPrompt}\n\n# REDIRECTION FROM JEXI (your boss)\nPrevious approach stopped because it was off-track. ${redirectInstruction}\n\nStart the assignment fresh with this correction applied.`
      : userPrompt;
    const supervisor = new Supervisor({
      objective: brief.objective,
      criteria: brief.successCriteria,
      employeeName: employee.displayName,
      review,
      liveReview: attempt === 0 && liveReview, // after a redirect: watchers only, no second review
      onEvent: (e) => emit(e.type || 'SUPERVISION_FLAG', { agentId: employee.agentId, agentName: employee.displayName, summary: e.summary, severity: e.severity, data: e.instruction ? { instruction: e.instruction } : undefined }),
    });
    let redirectReject;
    const gate = new Promise((_, rej) => { redirectReject = rej; });
    supervisor.onDecision = (d) => {
      try {
        mailbox.post(message({
          from: 'jexi', to: employee.agentId, taskId: task.id, subtaskId: subtask.id,
          type: 'RECOVERY', content: `Stop the current approach — ${d.reason}. ${d.instruction}`,
        }));
      } catch { /* mail never breaks supervision */ }
      const err = new Error(`redirected: ${d.reason}`);
      err.code = 'REDIRECT';
      err.instruction = d.instruction;
      redirectReject(err);
    };
    const work = runWithModel(
      employee,
      subtask.capability || 'reasoning',
      ({ prefer }) => llm({
        system: employeeSystemPrompt(employee, brief),
        user: finalPrompt,
        prefer,
        onToken: (t) => { supervisor.observe(t); if (hooks.onToken) { try { hooks.onToken(t); } catch { /* never break */ } } },
      }),
      { onEvent: emit },
    );
    work.catch(() => {}); // the race loser must never surface as unhandled
    try {
      const raw = await Promise.race([work, gate]);
      supervisor.finish();
      return raw;
    } catch (e) {
      supervisor.finish();
      if (e?.code === 'REDIRECT' && attempt === 0) {
        redirectInstruction = e.instruction || e.message;
        continue; // the ONE bounded redirect-retry
      }
      throw e;
    }
  }
  throw Object.assign(new Error('supervision exhausted'), { code: 'BAD_OUTPUT' });
}

/**
 * B210 — extract command requests: fenced blocks whose info string is `run`.
 *   ```run
 *   node analysis.js
 *   ```
 * Each block is ONE command (single line, no shell semantics).
 */
export function extractCommandRequests(text) {
  const out = String(text || '');
  const re = new RegExp('```' + 'run' + '[ \\t]*\\n([\\s\\S]*?)```', 'g');
  const requests = [];
  let m;
  while ((m = re.exec(out))) {
    const cmd = m[1].split('\n').map((l) => l.trim()).filter(Boolean).join(' ');
    if (cmd) requests.push(cmd);
  }
  return requests;
}

/** B211 B3 — extract ```browser action lines from employee output (one per block). */
export function extractBrowserRequests(text) {
  const out = String(text || '');
  const re = new RegExp('```' + 'browser' + '[ \\t]*\\n([\\s\\S]*?)```', 'g');
  const lines = [];
  let m;
  while ((m = re.exec(out))) {
    for (const l of m[1].split('\n')) {
      const t = l.trim();
      if (t) lines.push(t);
    }
  }
  return lines;
}

/** B209 — persist an artifact to the per-task directory (path-safe, bounded). */
function persistArtifact(taskId, artifact) {
  // B211 B4 — SAFE relative subpaths survive (a full-stack build writes
  // public/index.html next to server.js). Each component is sanitized, no
  // traversal, depth <= 3; anything dubious flattens to one sanitized name.
  let safeName = String(artifact?.name || 'artifact.md').replace(/\\/g, '/').trim();
  const parts = safeName.split('/').filter(Boolean)
    .map((seg) => seg.replace(/[^\w.-]+/g, '_').replace(/^\.+/, '_').slice(0, 60))
    .filter(Boolean);
  safeName = (parts.length > 1 && parts.length <= 3)
    ? parts.join('/')
    : (parts[parts.length - 1] || 'artifact.md').slice(0, 80);
  if (!/^[\w][\w.-]*(\/[\w][\w.-]*)*$/.test(safeName)) safeName = `artifact_${Date.now()}.md`;
  const dir = path.join(ARTIFACT_DIR, String(taskId || 'task').replace(/[^\w-]/g, '_'));
  fs.mkdirSync(path.dirname(path.join(dir, safeName)), { recursive: true });
  const file = path.join(dir, safeName);
  const content = String(artifact?.content || '');
  fs.writeFileSync(file, content);
  return { name: safeName, bytes: Buffer.byteLength(content) };
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
