/**
 * JEXI OS — Coding Loop (B50 P3).
 *
 * The coding edit → run → observe exact error → fix → repeat-until-success loop,
 * made FIRST-CLASS and machine-checkable. Coder writes, Runner executes, the
 * loop observes the EXACT output and feeds the error text back into the next
 * fix turn, and stops only when a success PREDICATE returns true or the hard
 * attempt budget (default 6) is exhausted.
 *
 * Success conditions are explicit and checkable by running a command:
 *   - 'exit-zero'                → command exited 0
 *   - 'exit-zero-no-error-text'  → exit 0 AND no error-class markers in output
 *   - 'contains:<text>'          → output must contain the text (e.g. "PASS")
 *   - 'not-contains:<text>'      → output must NOT contain the text
 *   - a predicate function       → (exitCode, output) => boolean
 *
 * Every iteration records attempt count + the exact error observed, so the
 * caller (and tests) can prove multi-iteration fix behaviour.
 */
import { generateContent } from './LLMClient.js';
import { JEXI_SYSTEM_PROMPT } from './JexiPrompt.js';
import { runFile } from './Runner.js';

export const DEFAULT_MAX_ATTEMPTS = 6;

/** Error-class markers that mean "the code did not work" even if exit is 0. */
const ERROR_PATTERNS = /traceback|exception|syntaxerror|errno|no such file|modulenotfound|nameerror|importerror|attributeerror|typeerror|referenceerror|cannot find module|is not defined|command not found|failed|error:/i;

/** Turn a success-criterion string into a machine-checkable predicate. */
export function successPredicateFromCriterion(criterion) {
  if (typeof criterion === 'function') return criterion;
  const c = String(criterion || 'exit-zero-no-error-text');
  if (c === 'exit-zero') return (exitCode) => exitCode === 0;
  if (c.startsWith('contains:')) {
    const needle = c.slice('contains:'.length);
    return (_exitCode, output) => String(output || '').includes(needle);
  }
  if (c.startsWith('not-contains:')) {
    const needle = c.slice('not-contains:'.length);
    return (_exitCode, output) => !String(output || '').includes(needle);
  }
  // default: exit-zero-no-error-text
  return (exitCode, output) => exitCode === 0 && !ERROR_PATTERNS.test(String(output || ''));
}

/**
 * Run one coding iteration: run the entry point (or a custom runCommand),
 * return { success, exitCode, output }.
 */
export async function runOnce({ entryPoint, runCommand, sendEvent }) {
  const emit = typeof sendEvent === 'function' ? sendEvent : () => {};
  if (runCommand) {
    try {
      const res = await runCommand();
      const exitCode = res && typeof res.exitCode === 'number' ? res.exitCode : (res && res.ok ? 0 : 1);
      const output = String((res && (res.output || res.stdout || res.error)) || '').slice(0, 8000);
      emit('log', { agent: 'Runner', message: `▶ Ran ${entryPoint || 'command'} → exit ${exitCode}` });
      return { success: false, exitCode, output }; // success decided by the predicate, not us
    } catch (e) {
      const output = String((e && e.message) || e).slice(0, 8000);
      emit('log', { agent: 'Runner', message: `⚠ Run threw: ${output.slice(0, 200)}` });
      return { success: false, exitCode: 1, output };
    }
  }
  return (async () => {
    const res = await runFile(entryPoint, (stream, data) => emit('log', { agent: 'Terminal', message: String(data).slice(0, 200) }));
    const exitCode = res && res.success ? 0 : 1;
    const output = String((res && (res.output || res.error)) || '').slice(0, 8000);
    return { success: false, exitCode, output }; // success decided by the predicate, not us
  })();
}

/**
 * The default fixer: feed goal + the EXACT last error into the model as the
 * Coder and get back files to write. Injectable for tests/determinism.
 */
export async function defaultFixer({ goal, errorOutput, files, attempt, sendEvent, failureHistory = [] }) {
  const emit = typeof sendEvent === 'function' ? sendEvent : () => {};
  const existing = (files || []).map((f) => `## ${f.name}\n${f.code}`).join('\n\n').slice(0, 12000);
  // B53 P7 — every retry sees the EXACT last error + the failure-history tail,
  // and is told to fix ONLY that error (no scope creep, no invented features).
  const historyTail = (failureHistory || []).slice(-4).map((f) => `- ${String(f).slice(0, 200)}`).join('\n');
  const prompt = `Goal: ${goal}\n\nCurrent code:\n${existing || '(none)'}\n\nEXACT ERROR FROM THE LAST RUN (attempt ${attempt}):\n${String(errorOutput || '(no output)').slice(-3000)}${historyTail ? `\n\nFailure history (recent):\n${historyTail}` : ''}\n\nFix THE ERROR ABOVE and nothing else. Do not expand scope, do not add unrelated features, do not rewrite working parts. Reply with a fenced json block:\n{"files": [{"name": "<path>", "code": "<complete fixed file>"}], "entryPoint": "<file to run>"}`;
  emit('log', { agent: 'Debugger', message: `✍ Attempt ${attempt}: reading the error and rewriting…` });
  const reply = await generateContent(prompt, JEXI_SYSTEM_PROMPT + '\nYou are the Coder in a fix loop. Output the fenced json block only.', null, { temperature: 0.2 });
  try {
    const m = String(reply || '').match(/```json\s*([\s\S]*?)```/);
    const parsed = JSON.parse((m ? m[1] : reply).trim());
    return {
      files: Array.isArray(parsed.files) ? parsed.files : [],
      entryPoint: parsed.entryPoint || null,
    };
  } catch (e) {
    return { files: [], entryPoint: null, parseError: String((e && e.message) || e) };
  }
}

/**
 * THE CODING LOOP. Runs write → run → observe → fix → re-run until the
 * predicate passes or maxAttempts is exhausted.
 *
 * @param {object} opts
 *   goal            — what the code must do
 *   entryPoint      — file to run (first attempt; may be updated by fixes)
 *   files           — initial files [{name, code}] (optional)
 *   writeFiles      — async (files) => void; persists the files (required)
 *   runCommand      — optional async () => {exitCode, output}; overrides runFile
 *   successCriterion— string or predicate (see successPredicateFromCriterion)
 *   fixer           — optional async ({goal, errorOutput, files, attempt}) => {files, entryPoint}
 *   maxAttempts     — hard cap (default 6)
 *   sendEvent       — event emitter (log/tool events)
 *
 * @returns { attempts, success, lastOutput, lastExitCode, files, entryPoint }
 */
export async function runCodingLoop(opts) {
  const emit = typeof opts.sendEvent === 'function' ? opts.sendEvent : () => {};
  const maxAttempts = opts.maxAttempts || DEFAULT_MAX_ATTEMPTS;
  const predicate = successPredicateFromCriterion(opts.successCriterion);
  const fixer = opts.fixer || defaultFixer;

  let files = (opts.files || []).map((f) => ({ ...f }));
  let entryPoint = opts.entryPoint;
  let lastOutput = '';
  let lastExitCode = null;
  let attempts = 0;
  const attemptsLog = [];

  // B51 P5 — repeated-failure guard: the SAME error text seen IDENTICAL_STREAK
  // times means blind re-fixing is wasting attempts → escalate (change strategy)
  // instead of re-running the exact same step again.
  const IDENTICAL_STREAK = 3;
  let lastErrorSig = null;
  let identicalStreak = 0;
  const errorSignature = (output) => String(output || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 500);

  for (let i = 1; i <= maxAttempts; i++) {
    attempts = i;
    // Attempt 1 runs the given code; later attempts run after a fix.
    const run = await runOnce({ entryPoint, runCommand: opts.runCommand, sendEvent: emit });
    lastOutput = run.output;
    lastExitCode = run.exitCode;
    attemptsLog.push({ attempt: i, exitCode: run.exitCode, outputHead: String(run.output).slice(0, 300) });
    emit('log', { agent: 'Runner', message: `▶ Attempt ${i}/${maxAttempts}: exit ${run.exitCode}` });

    const ok = predicate(run.exitCode, run.output);
    if (ok) {
      emit('log', { agent: 'Runner', message: `✅ Success predicate PASSED on attempt ${i}.` });
      return { attempts, success: true, lastOutput, lastExitCode, files, entryPoint, attemptsLog };
    }

    // Repeated-failure guard: identical error N times → escalate, don't re-run
    // the exact same step blindly (B51 P5).
    const sig = errorSignature(run.output);
    if (sig && sig === lastErrorSig) {
      identicalStreak += 1;
    } else {
      identicalStreak = 1;
    }
    lastErrorSig = sig;
    if (identicalStreak >= IDENTICAL_STREAK) {
      emit('log', { agent: 'Debugger', message: `⚠ Same error repeated ${IDENTICAL_STREAK}x — escalating instead of re-fixing blindly.` });
      return { attempts, success: false, escalated: true, repeatedError: String(run.output).slice(0, 1200), lastOutput, lastExitCode, files, entryPoint, attemptsLog };
    }

    if (i >= maxAttempts) {
      emit('log', { agent: 'Debugger', message: `⚠ Attempt budget exhausted (${maxAttempts}). Reporting last error.` });
      return { attempts, success: false, lastOutput, lastExitCode, files, entryPoint, attemptsLog };
    }

    // Feed the EXACT error back and let the fixer rewrite (B53 P7 — the
    // failure-history tail travels with it so the fix learns, not repeats).
    const failureHistory = attemptsLog.map((a) => `attempt ${a.attempt}: ${String(a.outputHead).slice(0, 200)}`);
    const fixed = await fixer({ goal: opts.goal, errorOutput: run.output, files, attempt: i + 1, sendEvent: emit, failureHistory });
    if (fixed.parseError) {
      emit('log', { agent: 'Debugger', message: `⚠ Fixer output unparseable: ${fixed.parseError}` });
      return { attempts, success: false, lastOutput, lastExitCode, files, entryPoint, attemptsLog };
    }
    if (fixed.files && fixed.files.length) {
      files = fixed.files.map((f) => ({ ...f }));
      entryPoint = fixed.entryPoint || entryPoint;
      await opts.writeFiles(files);
    } else {
      emit('log', { agent: 'Debugger', message: '⚠ Fixer returned no files — stopping.' });
      return { attempts, success: false, lastOutput, lastExitCode, files, entryPoint, attemptsLog };
    }
  }

  return { attempts, success: false, lastOutput, lastExitCode, files, entryPoint, attemptsLog };
}
