/**
 * B211 — MISSION RUNNER: the bounded autonomous loop for persistent missions.
 *
 * A mission is NOT bound to one HTTP request. This runner executes it in the
 * background against the persisted WorkGraph, checkpointing on every mutation:
 *
 *   tick = apply steering → check budgets → claim ready work (deterministic)
 *        → execute items through the REAL Director machinery (staffing,
 *          employee sessions, recovery ladder, execution backstop — reused,
 *          not duplicated) → verify → ingest discovered work → repeat
 *
 * Honesty rules (B208-B211):
 *   - every event comes from real execution; nothing is scripted
 *   - budgets pause/fail honestly — a mission never "completes" by faking
 *   - restart recovery requeues in-flight items; DONE work is never redone
 *   - the chat layer is a VIEW: it streams mission events, it never drives
 *     them; a browser disconnect changes nothing server-side
 */

import { Director } from './Director.js';
import { DirectorTask, teamEvent } from './TaskState.js';
import { TaskMailbox } from './AgentMail.js';
import { selectEmployee, getEmployee } from './Employees.js';
import { verifyDeliverable } from './Verifier.js';
import { parseModelJson } from './JsonRepair.js';
import { Mission, loadMission, listMissions, activeMissionFor, loadMissionEvents } from './Mission.js';
import { WorkGraph, loadWorkGraph } from './WorkGraph.js';
import { analyzeObjective } from './ComplexityAnalyzer.js';
import { imagine, comparePredictedVsActual } from './ImaginationEngine.js';
import { recordLesson, retrieveLessons, formatLessonsBlock, lessonCount } from './Lessons.js';

const MAX_PARALLEL = 3;
const PLAN_MAX_ITEMS = 8;
const CHAT_STREAM_MS = 25000; // how long a chat turn streams a running mission

/* ── chat-intent patterns (order of evaluation matters) ───────────────── */
const MISSION_CANCEL_RE = /^(cancel|stop|abort|kill|drop)\b[^.?!]{0,40}\b(mission|it|this|everything|the work)?\b[\s.,!?]*$/i;
const MISSION_CONTINUE_RE = /^(continue|keep going|go on|carry on|resume|status|update|progress)(\s+(the|on|with|it|this|my)?\s*(mission|work|project))?[\s.,!?]*$/i;
const MISSION_CREATE_RE = /\b(start|begin|launch|create|open|run|make)\b[^.?!]{0,50}\bmission\b|\bmission\s*:|\bas a mission\b|\bnew mission\b|\b(keep working on|keep going on|don'?t stop until|work until)\b/i;
const MISSION_STEER_RE = /\b(change|make it|instead|also|add|remove|use|prefer|switch|update|rename|tweak|adjust|without|now)\b/i;

const DISCOVERED_INSTRUCTION = [
  '',
  '---',
  '# DISCOVERY (optional)',
  'While working, if you find genuinely necessary work that is NOT already in this assignment, end the deliverable with a subsection exactly like:',
  '### DISCOVERED',
  '- [required-for] Short title — one line why',
  'Tags: required-for (must happen for the mission to succeed) | next (good follow-up) | delegate (different specialty) | defer (later) | ignore (out of scope, say why).',
  'Only list real work you found — never pad this section.',
].join('\n');

/** Extract `### DISCOVERED` entries from a deliverable. */
export function extractDiscovered(content) {
  const out = String(content || '');
  const m = out.match(/###\s+DISCOVERED\s*\n?([\s\S]*?)(?=\n##\s|$)/i);
  if (!m) return [];
  const tagMap = {
    'required-for': 'EXECUTE_NOW', must: 'EXECUTE_NOW', blocking: 'EXECUTE_NOW',
    next: 'QUEUE', queue: 'QUEUE', later: 'QUEUE', then: 'QUEUE',
    delegate: 'DELEGATE',
    defer: 'DEFER', deferred: 'DEFER',
    ignore: 'IGNORE_WITH_REASON', 'out-of-scope': 'IGNORE_WITH_REASON',
  };
  const found = [];
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^\s*[-*]\s*\[([a-z-]+)\]\s*(.+)$/i);
    if (!mm) continue;
    const classification = tagMap[mm[1].toLowerCase()] || 'QUEUE';
    const body = mm[2].trim();
    // title/detail split: "Title — detail" (em-dash), "Title -- detail" or "Title: detail"
    let sepIdx = body.indexOf(' — ');
    if (sepIdx < 0) sepIdx = body.indexOf(' -- ');
    if (sepIdx < 0) sepIdx = body.indexOf(':');
    const title = (sepIdx > 0 ? body.slice(0, sepIdx) : body).replace(/[*_`]/g, '').trim().slice(0, 160);
    const detail = sepIdx > 0 ? body.slice(sepIdx).replace(/^[\s:—-]+/, '').trim() : '';
    if (title) found.push({ classification, title, detail: String(detail).slice(0, 500) });
  }
  return found.slice(0, 6);
}

export class MissionRunner {
  constructor() {
    this.llm = null;
    this.tools = null;
    this.departments = {};
    this._director = null;
    this._running = new Set();       // missionIds with a live loop
    this._subscribers = new Map();   // missionId → Set<fn(evt)>
    this.workerId = `runner-${process.pid}`;
    this.maxParallel = MAX_PARALLEL;
  }

  configure({ llm, tools, departments } = {}) {
    if (llm) this.llm = llm;
    if (tools) this.tools = tools;
    if (departments) this.departments = departments;
    this._director = null; // rebuild with new adapters
    return this;
  }

  /** The Director whose execution machinery (ladder, backstop, sessions) we reuse. */
  director() {
    if (!this._director) this._director = new Director({ llm: this.llm, tools: this.tools, departments: this.departments });
    return this._director;
  }

  /* ── live subscribers (chat bridge / future UI panels) ────────────── */

  subscribe(missionId, fn) {
    if (!this._subscribers.has(missionId)) this._subscribers.set(missionId, new Set());
    this._subscribers.get(missionId).add(fn);
    return () => { try { this._subscribers.get(missionId)?.delete(fn); } catch { /* already gone */ } };
  }

  _publish(mission, fields) {
    const evt = mission.appendEvent(fields);
    const subs = this._subscribers.get(mission.id);
    if (subs) for (const fn of subs) { try { fn(evt); } catch { /* a dead viewer never breaks the mission */ } }
    return evt;
  }

  /* ── lifecycle ────────────────────────────────────────────────────── */

  create({ conversationId, objective, rawRequest = '', contextBlock = '', memoryContext = '', budgets = {} }) {
    const mission = new Mission({ conversationId, objective, rawRequest, contextBlock, memoryContext, budgets });
    const graph = new WorkGraph(mission.id);
    graph._persist(); // the graph file exists from creation; every later write is atomic
    this._publish(mission, {
      type: 'MISSION_CREATED', title: 'Mission created',
      summary: `Mission opened: ${mission.objective.slice(0, 200)}`,
      data: { missionId: mission.id, budgets: mission.budgets },
    });
    this.kick(mission.id);
    return mission;
  }

  /** Start the background loop for a mission (idempotent). */
  kick(missionId) {
    if (this._running.has(missionId)) return;
    const mission = loadMission(missionId);
    if (!mission || mission.isTerminal) return;
    this._running.add(missionId);
    setImmediate(() => {
      this._loop(missionId)
        .catch(async (e) => {
          const m = loadMission(missionId);
          if (m && !m.isTerminal) {
            this._publish(m, { type: 'MISSION_FAILED', severity: 'error', summary: `Runner error: ${String(e && e.message || e).slice(0, 200)} — failing honestly, nothing faked.` });
            try { m.setState('FAILED', 'runner error'); } catch { /* already terminal */ }
          }
        })
        .finally(() => this._running.delete(missionId));
    });
  }

  /** Boot recovery: resume missions that were mid-flight when the process died. */
  resumeOnBoot() {
    let resumed = 0;
    for (const mission of listMissions(null, 200)) {
      if (!['PLANNING', 'EXECUTING', 'VERIFYING'].includes(mission.state)) continue;
      const graph = loadWorkGraph(mission.id);
      if (!graph) continue;
      const requeued = graph.recoverAfterRestart('backend restart');
      mission.usage.restarts += 1;
      mission._persist();
      this._publish(mission, {
        type: 'MISSION_RESTART_RECOVERY', severity: 'warn',
        summary: `Backend restarted mid-flight — ${requeued.length} in-flight item(s) requeued; completed work and artifacts are intact.`,
        data: { requeued },
      });
      this.kick(mission.id);
      resumed += 1;
    }
    return resumed;
  }

  /* ── the loop ─────────────────────────────────────────────────────── */

  async _loop(missionId) {
    let mission = loadMission(missionId);
    if (!mission || mission.isTerminal) return;
    const graph = loadWorkGraph(missionId) || new WorkGraph(missionId);

    if (mission.state === 'CREATED' || mission.state === 'PLANNING') {
      if (mission.state === 'CREATED') mission.setState('PLANNING');

      // B2: classify once — complexity/risk → execution depth (who decided is recorded)
      if (!mission.analysis) {
        const analysis = await analyzeObjective(mission.objective, { llm: (a) => this.llm.employee(a) });
        mission.analysis = analysis;
        mission._persist();
        this._publish(mission, {
          type: 'MISSION_ANALYZED',
          summary: `Mission classified ${analysis.complexity} / risk ${analysis.risk} (decided by ${analysis.decidedBy}) — depth: imagination ${analysis.executionDepth.imagination ? 'ON' : 'off'}, checkpoints ${analysis.executionDepth.checkpointMode}${analysis.executionDepth.requiresApproval ? ', APPROVAL GATE' : ''}.`,
          data: { complexity: analysis.complexity, risk: analysis.risk, decidedBy: analysis.decidedBy, reasons: analysis.reasons, executionDepth: analysis.executionDepth },
        });
        if (analysis.executionDepth.requiresApproval) {
          mission.needsQuestion = {
            question: `This mission reads as ${analysis.risk.toLowerCase()} risk (${(analysis.reasons || []).slice(0, 2).join('; ')}). Reply "approve" to run it as stated, or tell me what to change — nothing has run yet.`,
          };
          mission.awaitingAnswerFor = null;
          mission._persist();
          this._publish(mission, { type: 'MISSION_AWAITING_INPUT', severity: 'warn', summary: `Risk gate: ${mission.needsQuestion.question.slice(0, 200)}` });
          try { mission.setState('AWAITING_INPUT', 'risk approval gate'); } catch { /* racing a control; the record is already honest */ }
          return;
        }
      }

      // B2: bounded imagination pass for deep missions (honest skip when unavailable)
      if (mission.analysis?.executionDepth?.imagination && !mission.imagination) {
        const lessonsBlock = formatLessonsBlock(retrieveLessons(mission.objective, 3));
        const pass = await imagine({ objective: mission.objective, analysis: mission.analysis, lessonsBlock, llm: (a) => this.llm.employee(a) });
        mission.imagination = pass;
        mission._persist();
        if (pass.status === 'COMPLETED') {
          const sel = pass.branches.find((b) => b.id === pass.selectedId);
          this._publish(mission, {
            type: 'IMAGINATION_PASS',
            summary: `Imagined ${pass.branches.length} strategies (simulated, ${pass.cost.llmCalls} call(s)) — selected "${sel?.name}" (${pass.judgedBy}). A plan input, not a result.`,
            data: { branches: pass.branches.map((b) => ({ name: b.name, status: b.status, because: b.verdict || b.rejectedBecause })), selected: sel?.name || null, simulated: true },
          });
        } else {
          this._publish(mission, {
            type: 'IMAGINATION_PASS', severity: 'warn',
            summary: `Strategy simulation unavailable (${pass.reason}) — planning proceeds without it. Never faked.`,
            data: { status: pass.status, reason: pass.reason },
          });
        }
      }

      if (!graph.items.length) { // a crash after planning but before EXECUTING persisted leaves items → never re-plan (no duplicates)
        const planned = await this._plan(mission, graph);
        if (!planned) return; // _plan already failed the mission honestly
      }
      mission.setState('EXECUTING', 'plan ready');
      this._publish(mission, {
        type: 'MISSION_STARTED',
        summary: `Mission running — ${graph.items.length} work item(s), ${graph.readyWork().length} ready now.`,
        data: { items: graph.items.map((i) => ({ id: i.id, title: i.title, priority: i.priority, dependsOn: i.dependsOn })) },
      });
    }

    for (;;) {
      mission = loadMission(missionId) || mission; // controls (pause/cancel) land between ticks
      if (mission.isTerminal || mission.state === 'AWAITING_INPUT' || mission.state === 'PAUSED') break;

      await this._applySteering(mission, graph);

      if (mission.windowExhausted()) {
        this._publish(mission, { type: 'BUDGET_EXHAUSTED', severity: 'warn', summary: `Wall-clock budget (${Math.round(mission.budgets.wallClockMs / 60000)} min) used — pausing honestly. Completed work is saved; resume to open a new window.` });
        mission.setState('PAUSED', 'budget:wall-clock');
        break;
      }
      if (mission.failuresExhausted(mission.usage.failures)) {
        this._publish(mission, { type: 'BUDGET_EXHAUSTED', severity: 'error', summary: `Failure budget (${mission.budgets.maxFailures}) exhausted — failing honestly with the record intact.` });
        mission.setState('FAILED', 'budget:failures');
        await this._finalReport(mission, graph);
        break;
      }

      const ready = graph.readyWork();
      if (ready.length) {
        const batch = ready.slice(0, this.maxParallel);
        await Promise.all(batch.map((item) => this._executeItem(missionId, graph, item)));
        continue; // re-evaluate: an item may have set AWAITING_INPUT / new work may be ready
      }

      const stats = graph.stats();
      if ((stats.byStatus.RUNNING || 0) > 0) { await new Promise((r) => setTimeout(r, 400)); continue; }

      if (stats.open > 0 && stats.blockedByFailures > 0) {
        if (mission.usage.replans < 1) {
          mission.usage.replans += 1;
          mission._persist();
          this._publish(mission, { type: 'MISSION_REPLAN', severity: 'warn', summary: 'Work is blocked by failures — rebuilding the blocked part once instead of retrying the dead approach.' });
          const ok = await this._replan(mission, graph, 'blocked by failed work');
          if (!ok) {
            this._publish(mission, { type: 'MISSION_FAILED', severity: 'error', summary: 'Replan unavailable (no lane answered) — failing honestly.' });
            mission.setState('FAILED', 'replan unavailable');
            await this._finalReport(mission, graph);
            break;
          }
          continue;
        }
        this._publish(mission, { type: 'MISSION_FAILED', severity: 'error', summary: 'Work is blocked by failures and the replan budget is used — failing honestly with every item state recorded.' });
        mission.setState('FAILED', 'blocked by failed work');
        await this._finalReport(mission, graph);
        break;
      }
      if (stats.open > 0 && stats.open === stats.deferred) {
        const outcome = await this._finish(mission, graph); // only deferred work remains → wrap up with it listed
        if (outcome) continue; else break;
      }
      if (stats.open > 0) {
        this._publish(mission, { type: 'MISSION_FAILED', severity: 'error', summary: 'No ready work but open items remain (dependency deadlock) — failing honestly rather than spinning.' });
        mission.setState('FAILED', 'dependency deadlock');
        await this._finalReport(mission, graph);
        break;
      }
      const outcome = await this._finish(mission, graph); // all items terminal → verify + report
      if (outcome) continue; // a correction round added work — keep going
      break;
    }
  }

  /* ── planning ─────────────────────────────────────────────────────── */

  async _plan(mission, graph) {
    const system = `You are JEXI — the Director of a team of AI employees (research, engineering, verification, security, planning, memory, data, design). You are planning a PERSISTENT MISSION: multi-step work executed item by item over time, each item by ONE employee, with results stored, verified and resumable.

Plan rules:
- Decompose into 2-${PLAN_MAX_ITEMS} WORK ITEMS. Each item is independently executable by ONE employee and independently checkable.
- Order matters: give each item "dependsOn" (1-based indices of items that must finish first). No cycles.
- Capabilities vocabulary ONLY: code, research, search, synthesis, verification, security, planning, memory, data, design, reasoning, computer.
- Writing, running and testing code is ONE item for the code engineer (she can execute allowlisted commands herself). Never split "then run it" into a separate item.
- Browsing a real site, filling a form, or reading a live page is ONE computer item for the computer-ops employee (he can drive the real browser himself, honestly blocked if the environment has none).
- Items needing fresh web facts get searchQueries (1-3 precise queries).
- Include a final verification item ONLY when the criteria need cross-item checking (the Director verifies the whole mission at the end regardless).
- successCriteria are measurable statements the FINAL mission deliverable must satisfy.

Output ONLY JSON:
{"refinedObjective":"...","assumptions":["..."],"constraints":["..."],"successCriteria":["..."],"items":[{"title":"...","details":"precise professional instructions","capability":"code","requirements":["code"],"dependsOn":[],"searchQueries":[],"expectedOutput":"what done looks like","priority":"high|normal|low"}]}`;
    const user = [
      `# MISSION (the user's request, verbatim)\n"${mission.rawRequest || mission.objective}"`,
      mission.contextBlock ? `# CONVERSATION/TASK CONTEXT\n${mission.contextBlock.slice(0, 2000)}` : '',
      mission.memoryContext ? `# WHAT WE ALREADY KNOW (memory)\n${mission.memoryContext.slice(0, 1200)}` : '',
      (mission.preplanSteering || []).length
        ? `# USER STEERING (said on the approval gate — obey it in this plan)\n${mission.preplanSteering.map((s) => `- "${s}"`).join('\n')}`
        : '',
      mission.imagination?.status === 'COMPLETED'
        ? `# SIMULATED STRATEGY (imagined in the imagination pass — a PLAN INPUT, nothing has run)\nSelected approach "${(mission.imagination.branches.find((b) => b.id === mission.imagination.selectedId) || {}).name}": ${(mission.imagination.branches.find((b) => b.id === mission.imagination.selectedId) || {}).approach}\nPredicted outcome (to be checked against reality at the end): ${(mission.imagination.branches.find((b) => b.id === mission.imagination.selectedId) || {}).predictedOutcome}`
        : '',
      formatLessonsBlock(retrieveLessons(`${mission.objective} ${(mission.preplanSteering || []).join(' ')}`, 3)),
    ].filter(Boolean).join('\n\n');

    let parsed = null;
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      try {
        parsed = parseModelJson(await this.llm.employee({ system, user: attempt === 0 ? user : `${user}\n\n# IMPORTANT\nYour previous reply was not valid JSON. Reply with the JSON object ONLY.` }));
      } catch { parsed = null; }
    }
    if (!parsed || !Array.isArray(parsed.items) || !parsed.items.length) {
      this._publish(mission, { type: 'MISSION_FAILED', severity: 'error', summary: 'Planning unavailable — no model lane produced a valid plan. Failing honestly instead of inventing work.' });
      mission.setState('FAILED', 'planning unavailable');
      return false;
    }

    const items = parsed.items.slice(0, PLAN_MAX_ITEMS);
    // sanitize dependencies: in-range, no self-refs, acyclic (drop cycle-forming edges, note it)
    const deps = items.map((it, idx) => {
      const raw = Array.isArray(it.dependsOn) ? it.dependsOn : [];
      const clean = [...new Set(raw.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= items.length && d !== idx + 1))];
      return clean.sort((a, b) => a - b);
    });
    const dropped = [];
    // cycle guard: adding edge i→d is a cycle only if d ALREADY (transitively)
    // depends on i. Check reaches(d, i) — never reaches(i, d), which would
    // traverse the edge under test and drop every legitimate dependency.
    const reaches = (from, target, seen = new Set()) => {
      if (from === target) return true;
      if (seen.has(from)) return false;
      seen.add(from);
      return deps[from - 1].some((d) => reaches(d, target, seen));
    };
    for (let i = 0; i < items.length; i++) {
      for (const d of [...deps[i]]) {
        if (reaches(d, i + 1)) { deps[i] = deps[i].filter((x) => x !== d); dropped.push(`item ${i + 1} → ${d} (cycle)`); }
      }
    }

    mission.objective = String(parsed.refinedObjective || mission.objective).slice(0, 2000);
    mission.assumptions = (parsed.assumptions || []).slice(0, 8);
    mission.constraints = (parsed.constraints || []).slice(0, 8);
    mission.successCriteria = (parsed.successCriteria || []).slice(0, 10).map(String);
    if (!mission.successCriteria.length) mission.successCriteria = [mission.objective];
    mission.usage.itemsCreated += items.length;
    mission._persist();

    const created = items.map((it, idx) => graph.addItem({
      planIndex: idx + 1,
      title: it.title, details: it.details, capability: it.capability, requirements: it.requirements,
      expectedOutput: it.expectedOutput, priority: it.priority, dependsOn: deps[idx],
      searchQueries: Array.isArray(it.searchQueries) ? it.searchQueries.slice(0, 3) : [],
    }));
    for (let i = 0; i < created.length; i++) {
      for (const d of deps[i]) graph.addRelation('BLOCKS', created[d - 1].id, created[i].id, `plan dependency (st${d} → st${i + 1})`);
    }
    this._publish(mission, {
      type: 'MISSION_PLANNED', title: 'Mission planned',
      summary: `Plan: ${created.length} work item(s) — ${created.map((c) => c.title).join(' → ')}.`,
      data: { items: created.map((c, i) => ({ id: c.id, planIndex: c.planIndex, title: c.title, dependsOn: deps[i] })), droppedEdges: dropped },
    });
    return true;
  }

  /** One bounded replan round: replace the failed/blocked part with a different approach. */
  async _replan(mission, graph, reason) {
    const failedItems = graph.items.filter((i) => i.status === 'FAILED');
    const blocked = graph.items.filter((i) => i.status === 'PENDING' && graph.blockersOf(i.id).some((b) => b.status === 'FAILED'));
    const system = `You are JEXI — the Director. Part of a persistent mission failed. Produce a REPLACEMENT plan for the failed/blocked work only: a DIFFERENT approach, not a retry. Same JSON contract as mission planning: {"refinedObjective":"...","items":[{"title","details","capability","requirements","dependsOn","expectedOutput","priority"}]}. dependsOn refers to 1-based positions in YOUR new items list. Output ONLY JSON.`;
    const user = [
      `# MISSION OBJECTIVE\n${mission.objective}`,
      `# SUCCESS CRITERIA\n${mission.successCriteria.map((c) => `- ${c}`).join('\n')}`,
      `# WHY WE REPLAN\n${reason}`,
      `# FAILED WORK (real execution record)`,
      ...failedItems.map((i) => `- "${i.title}" failed: ${i.failureReason || 'recovery ladder exhausted'}`),
      `# WORK BLOCKED BY THOSE FAILURES`,
      ...blocked.map((i) => `- "${i.title}" (waiting on failed work)`),
      `# WORK ALREADY DONE (do not redo)`,
      ...graph.items.filter((i) => i.status === 'DONE').map((i) => `- ${i.title}`),
      formatLessonsBlock(retrieveLessons(`${mission.objective} ${reason} ${failedItems.map((i) => i.failureReason || '').join(' ')}`, 3)),
    ].filter(Boolean).join('\n');
    let parsed = null;
    try { parsed = parseModelJson(await this.llm.employee({ system, user })); } catch { parsed = null; }
    if (!parsed || !Array.isArray(parsed.items) || !parsed.items.length) return false;

    // retire the dead subtree honestly, then add the replacement
    const dead = [...failedItems.map((i) => i.id), ...blocked.map((i) => i.id)];
    const superseded = graph.invalidateDownstream(dead, null, `replan: ${reason}`);
    const created = [];
    for (const def of parsed.items.slice(0, PLAN_MAX_ITEMS)) {
      if (mission.usage.itemsCreated >= mission.budgets.maxItems) {
        this._publish(mission, { type: 'DISCOVERY_DEFERRED', severity: 'warn', summary: `Item budget (${mission.budgets.maxItems}) reached — replan item "${String(def.title || '').slice(0, 80)}" recorded but not added.` });
        break;
      }
      const item = graph.addItem({
        title: def.title, details: def.details, capability: def.capability, requirements: def.requirements,
        expectedOutput: def.expectedOutput, priority: def.priority || 'high', dependsOn: [], origin: 'PLAN',
      });
      mission.usage.itemsCreated += 1;
      created.push(item);
      this._publish(mission, { type: 'WORK_ITEM_CREATED', summary: `Replan added work: ${item.title}`, data: { itemId: item.id } });
    }
    if (created.length && superseded.length) graph.addRelation('SUPERSEDES', created[0].id, superseded[0], 'replan replacement');
    this._publish(mission, {
      type: 'MISSION_REPLANNED',
      summary: `Replan done: ${superseded.length} dead item(s) superseded, ${created.length} replacement item(s) added.`,
      data: { superseded, created: created.map((c) => c.id) },
    });
    return true;
  }

  /* ── steering + answers ───────────────────────────────────────────── */

  steer(missionId, message) {
    const mission = loadMission(missionId);
    if (!mission || mission.isTerminal) return { ok: false, error: 'mission not found or terminal' };
    mission.queueSteering(message);
    this._publish(mission, { type: 'STEERING_RECEIVED', summary: `Steering queued: "${String(message).slice(0, 140)}"` });
    if (mission.state === 'PAUSED') { try { mission.resume(); } catch { /* not pausable from this state */ } }
    this.kick(mission.id);
    return { ok: true };
  }

  answer(missionId, text) {
    const mission = loadMission(missionId);
    if (!mission || mission.state !== 'AWAITING_INPUT') return { ok: false, error: `mission is ${mission ? mission.state : 'missing'}` };
    const answerText = String(text || '').trim();
    if (!answerText) return { ok: false, error: 'empty answer — the mission stays blocked until a real answer arrives' };
    const graph = loadWorkGraph(mission.id);
    const itemId = mission.awaitingAnswerFor || mission.needsQuestion?.itemId || null;
    const planned = Boolean(graph && graph.items.length);
    if (graph && itemId) {
      const item = graph.get(itemId);
      if (item) {
        item.details = `${item.details}\n\n# USER ANSWER (this unblocks the work)\n"${answerText.slice(0, 800)}"`;
        item.updatedAt = new Date().toISOString();
        graph._persist();
      }
    }
    // B2: an answer on the MISSION-level gate (risk gate, before any plan) that
    // is not a plain approval is a CHANGE — keep it and feed it to the planner.
    const APPROVAL_RE = /^(yes|y|approve[d]?|ok|okay|go( ahead)?|confirmed?|proceed|run it|do it|lgfm?)\b/i;
    if (!itemId && !planned && answerText.trim() && !APPROVAL_RE.test(answerText.trim())) {
      mission.preplanSteering = [...(mission.preplanSteering || []), answerText.slice(0, 800)];
    }
    mission.needsQuestion = null;
    mission.awaitingAnswerFor = null;
    mission.setState(planned ? 'EXECUTING' : 'PLANNING', 'answer received');
    this._publish(mission, { type: 'MISSION_RESUMED', summary: planned ? 'Answer received — the blocked item continues with it.' : 'Answer received — planning proceeds with it.' });
    this.kick(mission.id);
    return { ok: true };
  }

  async _applySteering(mission, graph) {
    for (const { message } of mission.takeSteeringQueue()) {
      const open = graph.items.filter((i) => i.status === 'PENDING' || i.status === 'RUNNING');
      if (!open.length) {
        this._publish(mission, { type: 'STEERING_APPLIED', summary: 'No open work to steer — noted for any future plan round.' });
        continue;
      }
      const impact = await this._impact(mission, graph, open, message);
      if (!impact) {
        mission.queueSteering(message); // put it back; try again next tick
        this._publish(mission, { type: 'STEERING_DEFERRED', severity: 'warn', summary: 'Impact analysis unavailable (no lane answered) — steering stays queued, nothing guessed.' });
        break;
      }
      const affected = (impact.affectedItemIds || []).filter((id) => open.some((i) => i.id === id));
      const superseded = affected.length ? graph.invalidateDownstream(affected, null, `steering: ${String(message).slice(0, 120)}`) : [];
      if (superseded.length) {
        this._publish(mission, { type: 'WORK_SUPERSEDED', severity: 'warn', summary: `${superseded.length} open item(s) superseded by steering (done work is untouched).`, data: { ids: superseded } });
      }
      const created = [];
      for (const def of (impact.newItems || []).slice(0, 5)) {
        if (mission.usage.itemsCreated >= mission.budgets.maxItems) {
          this._publish(mission, { type: 'DISCOVERY_DEFERRED', severity: 'warn', summary: `Item budget (${mission.budgets.maxItems}) reached — steering item "${String(def.title || '').slice(0, 80)}" recorded but not added.` });
          break;
        }
        const item = graph.addItem({
          title: def.title, details: `${def.details || ''}\n\n# STEERING CONTEXT\nThis work was added mid-mission by the user: "${String(message).slice(0, 400)}"`,
          capability: def.capability || 'reasoning', requirements: def.requirements || [],
          expectedOutput: def.expectedOutput || '', priority: def.priority || 'high', origin: 'PLAN', dependsOn: [],
        });
        mission.usage.itemsCreated += 1;
        created.push(item);
        for (const depId of (def.dependsOnItemIds || []).slice(0, 4)) {
          const dep = graph.get(depId);
          if (dep && dep.id !== item.id) { try { graph.addRelation('BLOCKS', dep.id, item.id, 'steering dependency'); } catch { /* bad id from the model: skip */ } }
        }
        this._publish(mission, { type: 'WORK_ITEM_CREATED', summary: `Steering added work: ${item.title}`, data: { itemId: item.id } });
      }
      if (created.length && superseded.length) graph.addRelation('SUPERSEDES', created[0].id, superseded[0], 'steering replacement');
      this._publish(mission, {
        type: 'STEERING_APPLIED',
        summary: String(impact.rationale || `Steering applied: ${superseded.length} superseded, ${created.length} added.`).slice(0, 400),
        data: { superseded, created: created.map((c) => c.id), unaffected: open.length - affected.length },
      });
    }
  }

  async _impact(mission, graph, open, message) {
    const system = `You are JEXI — the Director. Mid-mission steering arrived from the user. Compute the impact on the OPEN work items ONLY (done work is never invalidated).

Rules:
- affectedItemIds: open item ids whose approach/scope genuinely changes because of this steering. Unrelated items stay untouched.
- newItems: replacement/additional work needed because of the steering (same shape as plan items). Empty if none.
- If the steering does not affect this mission at all, return empty lists and say so in the rationale.

Output ONLY JSON: {"affectedItemIds":["wi-..."],"newItems":[{"title":"...","details":"...","capability":"...","requirements":[],"expectedOutput":"...","priority":"high|normal|low","dependsOnItemIds":[]}],"rationale":"one short line"}`;
    const user = [
      `# MISSION OBJECTIVE\n${mission.objective}`,
      `# SUCCESS CRITERIA\n${mission.successCriteria.map((c) => `- ${c}`).join('\n')}`,
      `# OPEN WORK ITEMS`,
      ...open.map((i) => `- id=${i.id} title="${i.title}" status=${i.status}${i.deferred ? ' (deferred)' : ''}`),
      `# STEERING FROM THE USER\n"${String(message).slice(0, 1500)}"`,
    ].join('\n');
    try {
      const parsed = parseModelJson(await this.llm.employee({ system, user }));
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.affectedItemIds)) return parsed;
      return null;
    } catch { return null; }
  }

  /* ── execution (reuses the Director machinery — never a copy) ─────── */

  _resultsMap(graph) {
    const results = new Map();
    for (const item of graph.items) {
      if (item.status === 'DONE' && item.planIndex && item.result) {
        results.set(`st${item.planIndex}`, {
          id: `res-${item.id}`, from: item.result.employeeId || 'employee',
          content: item.result.content, confidence: item.result.confidence, ms: item.result.ms,
          needs: null, data: { commandsExecuted: item.result.commandsExecuted || 0 },
        });
      }
    }
    return results;
  }

  async _executeItem(missionId, graph, item) {
    let mission = loadMission(missionId);
    if (!mission || mission.isTerminal || mission.state === 'PAUSED') return;

    const claimed = graph.claim(item.id, this.workerId, 15 * 60 * 1000);
    if (!claimed) return; // someone else's lease or it became unready

    // staffing: the same capability+tool rules the Director uses for a turn
    const stText = `${item.title} ${item.details} ${item.expectedOutput || ''}`;
    const wantsExecution = /\b(run|runs|ran|execute|executes|executed|execution|test|tests|testing)\b/i.test(stText) && /\b(script|scripts|code|program|node|python|javascript|js)\b/i.test(stText);
    let employee;
    try {
      employee = selectEmployee(
        item.requirements?.length ? item.requirements : [item.capability],
        { fallback: 'echo', ...(wantsExecution ? { requireTool: 'run-command' } : {}) },
      );
    } catch (e) {
      graph.fail(item.id, `staffing failed: ${String(e && e.message || e).slice(0, 120)}`);
      mission.usage.failures += 1;
      mission._persist();
      this._publish(mission, { type: 'WORK_FAILED', severity: 'error', title: item.title, summary: `Could not staff "${item.title}" — recorded honestly.`, data: { itemId: item.id } });
      return;
    }

    // per-item DirectorTask record: the full B208-210 audit trail, replayable
    const task = new DirectorTask({
      conversationId: mission.conversationId,
      rawQuery: item.title,
      effectiveQuery: `${item.title}\n${item.details}`.slice(0, 8000),
      contextBlock: `Mission: ${mission.objective}`.slice(0, 2000),
    });
    // B211 B4 — one workspace per MISSION: later items build on earlier
    // items' files (the long-horizon contract). Records stay per-item.
    task.workspaceId = mission.id;
    task.objective = item.title;
    task.successCriteria = [item.expectedOutput || mission.successCriteria[0] || mission.objective].filter(Boolean).slice(0, 4);
    task.setState('INTERPRETING'); // instant: the mission already interpreted; the record keeps the legal path
    task.setState('PLANNING');
    const subtask = {
      id: `st${item.planIndex || 1}`, title: item.title,
      details: `${item.details}${DISCOVERED_INSTRUCTION}`,
      capability: item.capability, requirements: item.requirements || [],
      dependsOn: item.dependsOn || [], expectedOutput: item.expectedOutput || '', priority: item.priority,
      searchQueries: item.searchQueries || [],
    };
    task.plan = { subtasks: [subtask], leadSubtaskId: subtask.id, parallel: false };
    task.setState('ASSIGNING');
    task.leadEmployeeId = employee.agentId;
    task.assignments = [{ subtaskId: subtask.id, employeeId: employee.agentId, role: 'lead', status: 'assigned', attempts: 0 }];
    task.setState('RUNNING');
    const mailbox = new TaskMailbox(task.id);
    const nameFor = (id) => (id === 'jexi' ? 'JEXI' : getEmployee(id)?.displayName || id);

    const emit = (fields) => {
      const evt = teamEvent(task, fields);
      task.addEvent(evt);
      this._publish(mission, {
        type: evt.type, title: evt.title, summary: evt.summary, severity: evt.severity,
        data: { ...evt.data, itemId: item.id, taskRecordId: task.id, agentId: evt.agentId, agentName: evt.agentName },
      });
    };

    this._publish(mission, {
      type: 'WORK_STARTED', title: item.title,
      summary: `${employee.displayName} starts: ${item.title}.`,
      data: { itemId: item.id, employee: employee.displayName, taskRecordId: task.id },
    });

    const t0 = Date.now();
    let resultMsg = null;
    try {
      resultMsg = await this.director().runAssignmentWithRecovery({
        task, subtask, staffing: { subtask, employee, role: 'lead' },
        staffed: [{ subtask, employee, role: 'lead' }],
        results: this._resultsMap(graph), mailbox, emit, narrate: () => {}, nameFor,
      });
    } catch (e) {
      resultMsg = null;
      this._publish(mission, { type: 'WORK_FAILED', severity: 'error', title: item.title, summary: `Execution error on "${item.title}": ${String(e && e.message || e).slice(0, 160)}`, data: { itemId: item.id } });
    }

    mission = loadMission(missionId) || mission; // controls may have landed mid-run
    if (mission.isTerminal || mission.state === 'PAUSED') {
      // a control landed mid-flight. If the item genuinely finished, record it
      // (real work is never thrown away); otherwise requeue it honestly.
      if (resultMsg) {
        graph.complete(item.id, {
          content: resultMsg.content, artifacts: resultMsg.artifacts,
          employeeId: resultMsg.from, employeeName: nameFor(resultMsg.from),
          ms: Date.now() - t0, confidence: resultMsg.confidence,
          commandsExecuted: resultMsg.data?.commandsExecuted || 0,
        });
        this._publish(mission, {
          type: 'WORK_COMPLETED', title: item.title,
          summary: `${nameFor(resultMsg.from)} delivered: ${item.title} (finished just as the mission was ${mission.state.toLowerCase()} — recorded, never redone silently).`,
          data: { itemId: item.id, ms: Date.now() - t0 },
        });
      } else {
        graph.requeue(item.id, `mission became ${mission.state} mid-run`);
      }
      return;
    }

    if (resultMsg && resultMsg.needs && resultMsg.needs.blocking && resultMsg.needs.question) {
      graph.requeue(item.id, 'awaiting user answer');
      mission.needsQuestion = { itemId: item.id, question: String(resultMsg.needs.question).slice(0, 500), at: new Date().toISOString() };
      mission.awaitingAnswerFor = item.id;
      this._publish(mission, {
        type: 'MISSION_AWAITING_INPUT', severity: 'warn', title: item.title,
        summary: `The work paused — one answer needed: ${String(resultMsg.needs.question).slice(0, 200)}`,
        data: { itemId: item.id, question: resultMsg.needs.question },
      });
      try { mission.setState('AWAITING_INPUT', 'blocking NEEDS question'); } catch { /* racing a control; the record is already honest */ }
      return;
    }

    if (resultMsg) {
      graph.complete(item.id, {
        content: resultMsg.content, artifacts: resultMsg.artifacts,
        employeeId: resultMsg.from, employeeName: nameFor(resultMsg.from),
        ms: Date.now() - t0, confidence: resultMsg.confidence,
        commandsExecuted: resultMsg.data?.commandsExecuted || 0,
      });
      this._publish(mission, {
        type: 'WORK_COMPLETED', title: item.title,
        summary: `${nameFor(resultMsg.from)} delivered: ${item.title}${(resultMsg.artifacts || []).length ? ` (${resultMsg.artifacts.length} artifact(s), hashed)` : ''}.`,
        data: { itemId: item.id, ms: Date.now() - t0, confidence: resultMsg.confidence, artifacts: (resultMsg.artifacts || []).map((a) => a.name) },
      });
      // B2: an item that needed the recovery ladder but STILL delivered = a working strategy worth remembering
      const recoveries = task.recoveries || [];
      if (recoveries.length) {
        const lastAction = recoveries[recoveries.length - 1];
        recordLesson({
          kind: 'recovery', missionId: mission.id, objective: [mission.rawRequest, mission.objective].filter(Boolean).join(' | ').slice(0, 300), itemTitle: item.title,
          cause: `${lastAction.action}: ${String(lastAction.reason || '').slice(0, 160)}`,
          strategy: `recovery ladder round ${recoveries.length}`,
          lesson: `"${item.title}" (capability: ${item.capability}) hit "${String(lastAction.reason || '').slice(0, 120)}" but recovered via ${lastAction.action} and delivered — for similar work, expect this failure mode and keep one recovery round.`,
        });
        this._publish(mission, { type: 'LESSON_RECORDED', summary: `Operational lesson recorded: ${item.title} recovered via ${lastAction.action} — future plans will see it.` });
      }
      const found = extractDiscovered(resultMsg.content);
      if (found.length) this._ingestDiscovered(mission, graph, item, found);
    } else {
      // record the REAL last failure from the ladder's recovery log, not a generic label
      const lastRec = (task.recoveries || []).slice(-1)[0];
      const reason = lastRec ? `${lastRec.action}: ${lastRec.reason}`.slice(0, 500) : 'recovery ladder exhausted';
      graph.fail(item.id, reason);
      mission.usage.failures += 1;
      mission._persist();
      this._publish(mission, { type: 'WORK_FAILED', severity: 'error', title: item.title, summary: `"${item.title}" failed after the full recovery ladder — ${reason.slice(0, 140)} — recorded honestly, never faked.`, data: { itemId: item.id } });
      // B2: a real failure is operational knowledge — record it for future planning
      recordLesson({
        kind: 'failure', missionId: mission.id, objective: [mission.rawRequest, mission.objective].filter(Boolean).join(' | ').slice(0, 300), itemTitle: item.title,
        failure: reason, cause: String(lastRec?.reason || reason).slice(0, 200),
        strategy: `recovery ladder exhausted after ${((task.recoveries || []).length)} round(s)`,
        lesson: `"${item.title}" (capability: ${item.capability}) failed for: ${reason.slice(0, 160)} — plan a different approach for this kind of item, do not retry the same way.`,
      });
      this._publish(mission, { type: 'LESSON_RECORDED', severity: 'warn', summary: `Operational lesson recorded: how "${item.title}" failed — future plans will avoid repeating it.` });
    }
  }

  /* ── discovered work ──────────────────────────────────────────────── */

  _ingestDiscovered(mission, graph, fromItem, found) {
    if (!Array.isArray(mission.discoveries)) mission.discoveries = [];
    let created = 0;
    let deferredByBudget = false;
    for (const f of found) {
      const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const dupe = graph.items.some((i) => norm(i.title) === norm(f.title));
      if (dupe) {
        mission.discoveries.push({ at: new Date().toISOString(), fromItemId: fromItem.id, ...f, action: 'merged (already planned)' });
        this._publish(mission, { type: 'DISCOVERY_INGESTED', summary: `Discovered "${f.title}" — already in the plan, merged.`, data: { classification: f.classification, action: 'merged' } });
        continue;
      }
      if (['IGNORE_WITH_REASON'].includes(f.classification)) {
        mission.discoveries.push({ at: new Date().toISOString(), fromItemId: fromItem.id, ...f, action: 'ignored' });
        this._publish(mission, { type: 'DISCOVERY_INGESTED', summary: `Discovered "${f.title}" — out of scope, ignored with reason: ${f.detail || 'not stated'}.`, data: { classification: f.classification, action: 'ignored' } });
        continue;
      }
      if (mission.usage.discoveryRounds >= mission.budgets.maxDiscoveryRounds || mission.usage.itemsCreated >= mission.budgets.maxItems) {
        deferredByBudget = true;
        mission.discoveries.push({ at: new Date().toISOString(), fromItemId: fromItem.id, ...f, action: 'deferred (budget)' });
        continue;
      }
      const isDefer = f.classification === 'DEFER';
      const item = graph.addItem({
        title: f.title, details: f.detail || `Discovered during "${fromItem.title}": ${f.title}`,
        capability: f.classification === 'DELEGATE' ? 'reasoning' : fromItem.capability,
        requirements: [], expectedOutput: f.title, origin: 'DISCOVERED',
        classification: f.classification, priority: f.classification === 'EXECUTE_NOW' ? 'high' : 'normal',
        deferred: isDefer, dependsOn: [],
      });
      graph.addRelation('DISCOVERED_FROM', item.id, fromItem.id, `discovered while executing ${fromItem.id}`);
      mission.usage.itemsCreated += 1;
      if (!isDefer) mission.usage.discoveryRounds += 1;
      mission.discoveries.push({ at: new Date().toISOString(), fromItemId: fromItem.id, ...f, action: isDefer ? 'deferred' : 'queued' });
      created += 1;
      this._publish(mission, {
        type: 'DISCOVERY_INGESTED',
        summary: `Discovered work "${f.title}" → ${isDefer ? 'DEFER (listed, not executed)' : f.classification} — added to the graph with lineage.`,
        data: { itemId: item.id, classification: f.classification, fromItemId: fromItem.id },
      });
    }
    mission._persist();
    if (deferredByBudget) {
      this._publish(mission, { type: 'DISCOVERY_DEFERRED', severity: 'warn', summary: 'Discovery budget reached — further discovered work is recorded in the report but not executed.' });
    }
    return created;
  }

  /* ── finish: verify the OBJECTIVE, not just the actions ───────────── */

  /**
   * Verify the mission OBJECTIVE (not just that actions ran) and finish.
   * Returns true when a correction round added work (the loop continues);
   * false when the mission reached a terminal state.
   */
  async _finish(mission, graph) {
    if (mission.state !== 'VERIFYING') mission.setState('VERIFYING');
    const doneItems = graph.items.filter((i) => i.status === 'DONE').sort((a, b) => (a.planIndex || 0) - (b.planIndex || 0));
    if (!doneItems.length) {
      this._publish(mission, { type: 'MISSION_FAILED', severity: 'error', summary: 'No completed work to verify — failing honestly.' });
      mission.setState('FAILED', 'no completed work');
      await this._finalReport(mission, graph);
      return false;
    }
    const deliverable = doneItems.map((i) => `## ${i.title}\n${i.result?.content || ''}`).join('\n\n').slice(0, 28000);
    let verifier;
    try { verifier = selectEmployee(['verification'], { fallback: 'vera' }); } catch { verifier = getEmployee('vera'); }
    const duckTask = { id: mission.id, conversationId: mission.conversationId, objective: mission.objective, events: loadMissionEvents(mission.id) };
    const verification = await verifyDeliverable({
      task: duckTask, deliverable, criteria: mission.successCriteria,
      verifierEmployee: verifier, llm: (a) => this.llm.verify(a), mailbox: new TaskMailbox(mission.id),
      hooks: { onEvent: (e) => this._publish(mission, { type: e.type, summary: e.summary, severity: e.severity, data: { ...e.data, agentId: e.agentId, agentName: e.agentName } }) },
    });
    mission.verification = { verdict: verification.verdict, score: verification.score, problems: verification.problems || [], rationale: verification.rationale || '' };
    mission._persist();
    this._publish(mission, {
      type: 'MISSION_VERIFIED', severity: verification.verdict === 'fail' ? 'warn' : 'info',
      summary: `Verification: ${verification.verdict} (${verification.score}) — ${verification.rationale || ''}`.slice(0, 400),
      data: { verdict: verification.verdict, score: verification.score, problems: verification.problems },
    });

    // B2: close the imagination loop — PREDICTED vs ACTUAL, deviation + lesson (real numbers only)
    if (mission.imagination?.status === 'COMPLETED' && !mission.imagination.review) {
      const stats = graph.stats();
      const review = comparePredictedVsActual(mission.imagination, {
        verdict: verification.verdict, score: verification.score,
        itemsTotal: graph.items.length, itemsDone: doneItems.length,
        itemsFailed: stats.byStatus.FAILED || 0, replans: mission.usage.replans,
      });
      if (review) {
        mission.imagination.review = review;
        mission._persist();
        this._publish(mission, {
          type: 'IMAGINATION_REVIEW',
          severity: review.outcomeMatched ? 'info' : 'warn',
          summary: `Predicted vs actual — ${review.outcomeMatched ? 'prediction held' : 'prediction deviated'}: ${review.lesson.slice(0, 260)}`,
          data: { predicted: review.predicted, actual: review.actual, itemsDelta: review.itemsDelta },
        });
        recordLesson({
          kind: 'deviation', missionId: mission.id, objective: [mission.rawRequest, mission.objective].filter(Boolean).join(' | ').slice(0, 300),
          cause: `strategy "${review.strategy}" — itemsDelta ${review.itemsDelta ?? 'n/a'}, outcomeMatched ${review.outcomeMatched}`,
          strategy: review.strategy,
          lesson: review.lesson,
        });
      }
    }

    if (verification.verdict === 'fail' && mission.usage.replans < 1) {
      mission.usage.replans += 1;
      mission._persist();
      this._publish(mission, { type: 'MISSION_REPLAN', severity: 'warn', summary: 'Verification failed — one correction round with the problems before honest failure.' });
      const ok = await this._replan(mission, graph, `verification failed: ${(verification.problems || []).join('; ').slice(0, 400)}`);
      if (ok) { try { mission.setState('EXECUTING', 'correction round'); } catch { /* VERIFYING→EXECUTING is legal; safety only */ } return true; }
    }
    if (verification.verdict === 'fail') {
      mission.setState('FAILED', 'verification failed');
      await this._finalReport(mission, graph);
      return false;
    }
    mission.setState('COMPLETED');
    await this._finalReport(mission, graph);
    return false;
  }

  async _finalReport(mission, graph) {
    const stats = graph.stats();
    const icon = { DONE: '✅', FAILED: '❌', SKIPPED: '⏭️', SUPERSEDED: '🔁', PENDING: '⏳', RUNNING: '▶️' };
    const lines = [
      mission.state === 'COMPLETED' ? `**Mission complete** — ${mission.objective}` : `**Mission ${mission.state.toLowerCase()}** — ${mission.objective}`,
      '',
      '**Work items:**',
      ...graph.items.map((i) => `- ${icon[i.status] || '•'} ${i.title} — ${i.status.toLowerCase()}${i.result?.artifacts?.length ? ` · ${i.result.artifacts.length} artifact(s)` : ''}${i.failureReason ? ` · ${i.failureReason.slice(0, 80)}` : ''}`),
    ];
    const deferred = (mission.discoveries || []).filter((d) => d.action.startsWith('deferred'));
    const ignored = (mission.discoveries || []).filter((d) => d.action === 'ignored');
    if (deferred.length) lines.push('', '**Deferred (recorded, not executed):**', ...deferred.map((d) => `- ${d.title} — ${d.detail || ''}`));
    if (ignored.length) lines.push('', '**Ignored with reason:**', ...ignored.map((d) => `- ${d.title} — ${d.detail || 'no reason given'}`));
    if (mission.verification) lines.push('', `**Verification:** ${mission.verification.verdict} (${mission.verification.score})${mission.verification.problems?.length ? ` — problems: ${mission.verification.problems.join('; ').slice(0, 300)}` : ''}`);
    lines.push('', `**Budget:** ${stats.total} item(s) · ${mission.usage.failures} failure(s) · ${mission.usage.replans} replan(s) · window ${Math.round(mission.windowElapsedMs() / 1000)}s of ${Math.round(mission.budgets.wallClockMs / 60000)}m${mission.usage.restarts ? ` · ${mission.usage.restarts} restart(s) survived` : ''}`);
    const summary = lines.join('\n').slice(0, 8000);
    mission.result = { summary, stats, verification: mission.verification, finishedAt: new Date().toISOString() };
    mission._persist();
    this._publish(mission, {
      type: mission.state === 'COMPLETED' ? 'MISSION_COMPLETED' : 'MISSION_FAILED',
      severity: mission.state === 'COMPLETED' ? 'info' : 'error',
      summary: mission.state === 'COMPLETED' ? 'Mission complete — every item has a real record.' : `Mission ${mission.state.toLowerCase()} — the record shows exactly what did and did not happen.`,
      data: { stats },
    });
  }

  /* ── user controls (API) ──────────────────────────────────────────── */

  control(missionId, action, { itemId, reason, text } = {}) {
    const mission = loadMission(missionId);
    if (!mission) return { ok: false, error: 'mission not found' };
    const graph = loadWorkGraph(mission.id);
    switch (action) {
      case 'answer':
        // B212 — the API path for answering an AWAITING_INPUT mission
        // (risk gate or a blocking NEEDS) without going through chat.
        return this.answer(missionId, String(text || ''));
      case 'pause':
        if (mission.isTerminal) return { ok: false, error: `mission is ${mission.state}` };
        this._publish(mission, { type: 'MISSION_PAUSED', severity: 'warn', summary: `Paused — ${reason || 'by user'}. Completed work stays saved.` });
        mission.pause(reason || 'paused by user');
        return { ok: true, state: mission.state };
      case 'resume':
        if (mission.state !== 'PAUSED' && mission.state !== 'AWAITING_INPUT') return { ok: false, error: `mission is ${mission.state}` };
        this._publish(mission, { type: 'MISSION_RESUMED', summary: `Resumed${reason ? ` — ${reason}` : ''}. A fresh budget window is open.` });
        mission.resume();
        this.kick(mission.id);
        return { ok: true, state: mission.state };
      case 'cancel':
        if (mission.isTerminal) return { ok: false, error: `mission is ${mission.state}` };
        this._publish(mission, { type: 'MISSION_CANCELLED', severity: 'warn', summary: `Cancelled — ${reason || 'by user'}. Every item state is preserved.` });
        mission.cancel(reason || 'cancelled by user');
        return { ok: true, state: mission.state };
      case 'retry':
        if (!graph || !itemId) return { ok: false, error: 'itemId required' };
        try { graph.retry(itemId); } catch (e) { return { ok: false, error: String(e.message || e) }; }
        this._publish(mission, { type: 'WORK_RETRIED', summary: `Item requeued for another attempt: ${itemId}` });
        if (mission.state === 'FAILED') {
          // the ONLY re-entry into a terminal state: the user explicitly
          // retried failed work — validated, recorded, never silent
          this._publish(mission, { type: 'MISSION_RESUMED', summary: 'Failed mission re-opened by an explicit user retry.' });
          mission.setState('EXECUTING', 'user retried failed work');
        }
        this.kick(mission.id);
        return { ok: true };
      case 'skip':
        if (!graph || !itemId) return { ok: false, error: 'itemId required' };
        try { graph.skip(itemId, reason || 'skipped by user'); } catch (e) { return { ok: false, error: String(e.message || e) }; }
        this._publish(mission, { type: 'WORK_SKIPPED', summary: `Item skipped: ${itemId}${reason ? ` — ${reason}` : ''}` });
        this.kick(mission.id);
        return { ok: true };
      case 'promote':
        if (!graph || !itemId) return { ok: false, error: 'itemId required' };
        try { graph.promote(itemId); } catch (e) { return { ok: false, error: String(e.message || e) }; }
        this._publish(mission, { type: 'WORK_PROMOTED', summary: `Deferred item promoted into ready work: ${itemId}` });
        this.kick(mission.id);
        return { ok: true };
      default:
        return { ok: false, error: `unknown action ${action}` };
    }
  }

  /* ── snapshots for the API ────────────────────────────────────────── */

  snapshot(missionId) {
    const mission = loadMission(missionId);
    if (!mission) return null;
    const graph = loadWorkGraph(mission.id);
    return {
      mission: {
        id: mission.id, conversationId: mission.conversationId, state: mission.state,
        objective: mission.objective, successCriteria: mission.successCriteria,
        createdAt: mission.createdAt, updatedAt: mission.updatedAt,
        needsQuestion: mission.needsQuestion, pausedReason: mission.pausedReason,
        analysis: mission.analysis ? { complexity: mission.analysis.complexity, risk: mission.analysis.risk, decidedBy: mission.analysis.decidedBy, executionDepth: mission.analysis.executionDepth } : null,
        imagination: mission.imagination ? {
          status: mission.imagination.status, simulated: mission.imagination.simulated === true,
          reason: mission.imagination.reason || null,
          selected: (mission.imagination.branches || []).find((b) => b.id === mission.imagination.selectedId)?.name || null,
          branches: (mission.imagination.branches || []).map((b) => ({ name: b.name, status: b.status })),
          review: mission.imagination.review ? { outcomeMatched: mission.imagination.review.outcomeMatched, itemsDelta: mission.imagination.review.itemsDelta, lesson: mission.imagination.review.lesson } : null,
        } : null,
        lessonsKnown: lessonCount(),
        verification: mission.verification, result: mission.result ? { summary: mission.result.summary } : null,
        budgets: mission.budgets, usage: mission.usage,
      },
      graph: graph ? {
        stats: graph.stats(),
        items: graph.items.map((i) => ({
          id: i.id, planIndex: i.planIndex, title: i.title, status: i.status, priority: i.priority,
          origin: i.origin, classification: i.classification, deferred: i.deferred,
          dependsOn: i.dependsOn, attempts: i.attempts, failureReason: i.failureReason,
          result: i.result ? { content: i.result.content.slice(0, 2000), artifacts: i.result.artifacts, employeeName: i.result.employeeName, ms: i.result.ms, confidence: i.result.confidence } : null,
        })),
        relations: graph.relations,
      } : null,
    };
  }

  /* ── the chat bridge: chat is a VIEW onto the mission ─────────────── */

  /**
   * Route a chat message to the mission lane when it is mission-related.
   * Returns true when handled (the caller finishes the request); false when
   * the turn belongs to the Director/legacy lanes.
   */
  async handleChat({ raw, effectiveQuery, convId, sendEvent, done, decision = null }) {
    const text = String(raw || '').trim();
    if (!text || !this.llm) return false;
    const query = effectiveQuery || text;
    const mission = activeMissionFor(convId);

    const streamToChat = (missionId) => this._streamMissionToChat(missionId, { sendEvent, done, query });

    if (!mission) {
      if (!MISSION_CREATE_RE.test(text)) return false;
      const m = this.create({
        conversationId: convId, objective: text, rawRequest: text,
        contextBlock: decision && decision.contextBlock ? decision.contextBlock : '',
        budgets: {},
      });
      return streamToChat(m.id);
    }

    // an active/resumable mission exists for this conversation
    if (MISSION_CANCEL_RE.test(text) && text.length <= 60) {
      this._publish(mission, { type: 'MISSION_CANCELLED', severity: 'warn', summary: `Cancelled from chat: "${text.slice(0, 80)}"` });
      mission.cancel('cancelled from chat');
      done({
        success: true, query,
        summary: `Mission cancelled — **${mission.objective.slice(0, 160)}**.\n\nEvery item's state is preserved in the record (${mission.id}); done work and artifacts stay on disk.`,
        sources: [], statistics: { directed: true, mission: true, missionId: mission.id, cancelled: true },
      });
      return true;
    }

    if (MISSION_CONTINUE_RE.test(text) && text.length <= 60) {
      if (mission.state === 'PAUSED') this.control(mission.id, 'resume', { reason: 'resumed from chat' });
      else if (mission.state === 'AWAITING_INPUT') { /* the question is re-surfaced below */ }
      else this.kick(mission.id);
      return streamToChat(mission.id);
    }

    if (mission.state === 'AWAITING_INPUT') {
      // this message is the answer to the blocking question
      this.answer(mission.id, text);
      return streamToChat(mission.id);
    }

    if (MISSION_STEER_RE.test(text) && text.length <= 300) {
      const r = this.steer(mission.id, text);
      if (r.ok) return streamToChat(mission.id);
    }

    if (MISSION_CREATE_RE.test(text)) {
      // a NEW mission while another is resumable: start it; the old one stays parked and inspectable
      const m = this.create({ conversationId: convId, objective: text, rawRequest: text, budgets: {} });
      return streamToChat(m.id);
    }

    return false; // not mission-related — the Director/legacy lane takes the turn
  }

  _streamMissionToChat(missionId, { sendEvent, done, query }) {
    let finished = false;
    let unsub = null;
    let timer = null;
    const cleanup = () => { if (unsub) { unsub(); unsub = null; } if (timer) { clearInterval(timer); timer = null; } };
    const finishWith = (payload) => {
      if (finished) return;
      finished = true;
      cleanup();
      try {
        done({
          success: payload.success !== false, query,
          summary: payload.summary,
          sources: [],
          statistics: { directed: true, mission: true, missionId, ...(payload.statistics || {}) },
        });
      } catch { /* the client may already be gone; the mission continues regardless */ }
    };

    unsub = this.subscribe(missionId, (evt) => {
      try {
        sendEvent('team', { event: evt });
        if (evt.type !== 'MISSION_CREATED') sendEvent('log', { agent: (evt.data && evt.data.agentName) || 'JEXI', message: evt.summary });
      } catch { /* viewer gone; work continues */ }
    });
    // REPLAY: a viewer that attaches late (or reconnects) first receives the
    // persisted event history, then the live stream — same contract as
    // /api/team/events, and the frontend filters duplicates by event id.
    for (const evt of loadMissionEvents(missionId)) {
      try { sendEvent('team', { event: evt, replay: true }); } catch { /* viewer gone */ }
    }

    const summarize = (m) => {
      const snap = this.snapshot(m.id);
      const st = snap?.graph?.stats;
      if (m.isTerminal) return { summary: m.result?.summary || `Mission ${m.state.toLowerCase()}.`, statistics: { state: m.state } };
      if (m.state === 'AWAITING_INPUT') {
        return {
          summary: `One answer needed before the work can finish:\n\n> ${m.needsQuestion?.question || 'the lead employee flagged a missing fact'}\n\nReply here and the mission continues with your answer.`,
          statistics: { state: m.state },
        };
      }
      if (m.state === 'PAUSED') {
        return { summary: `Mission paused — ${m.pausedReason || 'by user'}.\n\n${st ? `${st.byStatus.DONE || 0} done · ${st.byStatus.FAILED || 0} failed · ${st.open} open.` : ''} Say "Continue." to resume (a fresh budget window opens, and that's recorded).`, statistics: { state: m.state } };
      }
      return {
        summary: `Mission **running** — ${st ? `${st.byStatus.DONE || 0} done · ${st.byStatus.FAILED || 0} failed · ${st.ready} ready · ${st.open} open` : 'in flight'}.\n\nI keep working in the background — say **"Continue."** anytime to check in, or tell me a change and I'll steer mid-flight. (${m.id})`,
        statistics: { state: m.state },
      };
    };

    const poll = () => {
      const m = loadMission(missionId);
      if (!m) { finishWith({ success: false, summary: 'Mission record lost — this should not happen; everything is on disk under data/missions.' }); return; }
      if (m.isTerminal || m.state === 'AWAITING_INPUT' || m.state === 'PAUSED') { finishWith(summarize(m)); return; }
      if (Date.now() - startedAt > CHAT_STREAM_MS) finishWith(summarize(m));
    };
    const startedAt = Date.now();
    timer = setInterval(poll, 700);
    poll(); // immediate first check (a mission may already be waiting/terminal)
    return true;
  }
}

/** The singleton used by index.js (routes, boot recovery, chat bridge). */
export const missionRunner = new MissionRunner();
