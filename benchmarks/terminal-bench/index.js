/**
 * JEXI OS — benchmarks/terminal-bench/index.js
 *
 * Public API (Phase 31 Scope 13 contract):
 *   tb.load({ split, fixturePath? })        -> tasks[]
 *   tb.agent({ pipeline })                  -> agent
 *     agent.step(observation)               -> { action, args }
 *     agent.done()                          -> { finished: bool }
 *   tb.actions.validate(action)             -> { valid, errors? }
 *   tb.observe(raw)                         -> { stdout, exitCode, cwd }
 *   tb.run({ fixture, pipeline })           -> { resolved, total, perTask[], ... }
 *
 * run() orchestrates: load -> resolve the fixture's sibling transcript ->
 * per task: replay the pre-recorded observation trace through
 * agent.step(), collecting validated actions until submit -> consult the
 * pre-declared verifier -> report. The pipeline is INJECTED: sandbox
 * (scope 13) uses a stub with pre-declared actions; the real run
 * (scope 17) injects the live chat pipeline.
 *
 * This adapter is the AGENT side only: the official runner owns the
 * container lifecycle and the verification pass; nothing here provisions
 * a container or invokes the official harness. No Docker, no live model,
 * no network outside the gated loader.
 */

import path from 'node:path';
import {
  load,
  loadDiagnostics,
  validateTask,
  validateTranscript,
  loadTranscript,
  loadReal,
  FIXTURES,
} from './tasks.js';
import { createAgent } from './agent.js';
import { ACTION_SPACE, ACTION_SPACE_VERSION, CTRL_KEYS, validate } from './actions.js';
import { observe, stripAnsi } from './observation.js';
import { buildReport } from './report.js';

export async function run({ fixture, split = 'mini', pipeline, transcriptPath } = {}) {
  if (typeof pipeline !== 'function') {
    const err = new Error(
      'tb.run: an injected pipeline function is required ' +
      '(sandbox: stub with pre-declared actions; scope 17: live chat pipeline)'
    );
    err.code = 'TB_PIPELINE_REQUIRED';
    throw err;
  }

  const diag =
    fixture === null
      ? { tasks: await load({ split, fixturePath: null }), rejected: [], fixture: null, transcriptRef: null } // gated: throws NOT VERIFIED
      : await loadDiagnostics({ split, fixturePath: fixture });

  // Resolve the transcript: explicit override wins; otherwise the tasks
  // fixture declares its sibling transcript file.
  if (fixture === null) {
    // unreachable in practice: load({ fixturePath: null }) throws NOT VERIFIED
    // before any transcript resolution; kept explicit for shape clarity.
  }
  let transcriptFile = transcriptPath ?? null;
  if (!transcriptFile) {
    if (!diag.transcriptRef) {
      const err = new Error(
        'E_INVALID_TRANSCRIPT — fixture does not declare a transcript ' +
        '(add "transcript": "<sibling file>" to the fixture or pass transcriptPath)'
      );
      err.code = 'E_INVALID_TRANSCRIPT';
      throw err;
    }
    transcriptFile = path.join(path.dirname(diag.fixture), diag.transcriptRef);
  }
  const transcript = await loadTranscript(transcriptFile);

  const evaluated = [];
  for (const task of diag.tasks) {
    const entry = transcript.tasks[task.task_id];
    if (!entry) {
      const err = new Error(`E_INVALID_TRANSCRIPT — no transcript entry for task "${task.task_id}"`);
      err.code = 'E_INVALID_TRANSCRIPT';
      throw err;
    }
    const agent = createAgent({ pipeline });
    const actions = [];
    let submitted = false;
    for (const step of entry.steps) {
      const observation = observe(step.observation);
      const move = await agent.step(observation, { task });
      actions.push({ action: move.action, args: move.args });
      if (move.action === 'submit') {
        submitted = true;
        break;
      }
    }
    agent.done(); // trace closed from the agent's side; submitted drives the verdict below
    const verifier = {
      kind: entry.verifier.kind ?? 'stub',
      resolved: entry.verifier.resolved,
      tests: entry.verifier.tests ?? [],
    };
    evaluated.push({
      task_id: task.task_id,
      category: task.category,
      difficulty: task.difficulty,
      instruction: task.instruction,
      submitted,
      stepsUsed: actions.length,
      resolved: submitted === true && verifier.resolved === true,
      actions,
      verifier,
    });
  }

  return buildReport({
    split,
    fixture: fixture ?? `bundled:${split}`,
    evaluated,
    rejected: diag.rejected,
  });
}

export const tb = {
  load,
  loadDiagnostics,
  validateTask,
  validateTranscript,
  loadTranscript,
  loadReal,
  agent: createAgent,
  actions: { ACTION_SPACE, ACTION_SPACE_VERSION, CTRL_KEYS, validate },
  observe,
  stripAnsi,
  run,
  FIXTURES,
};

export {
  load,
  loadDiagnostics,
  validateTask,
  validateTranscript,
  loadTranscript,
  loadReal,
  createAgent,
  observe,
  stripAnsi,
  ACTION_SPACE,
  ACTION_SPACE_VERSION,
  CTRL_KEYS,
  validate,
  FIXTURES,
};
export default tb;
