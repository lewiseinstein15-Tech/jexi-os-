// B50 P3 — FIRST-CLASS CODING LOOP.
// Proves: machine-checkable success predicates; the loop runs edit→run→
// observe-exact-error→fix→re-run; it stops on predicate pass; it respects the
// hard attempt budget; attempts + exact errors are recorded (fix attempts).
import { runCodingLoop, successPredicateFromCriterion } from './src/services/CodingLoop.js';

let passed = 0;
let failed = 0;
const check = (name, ok) => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}`);
};

// 1. Machine-checkable success criteria.
check('exit-zero accepts exit 0', successPredicateFromCriterion('exit-zero')(0, 'whatever'));
check('exit-zero rejects exit 1', !successPredicateFromCriterion('exit-zero')(1, 'ok'));
check('exit-zero-no-error-text rejects error text', !successPredicateFromCriterion('exit-zero-no-error-text')(0, 'Traceback (most recent call last)'));
check('exit-zero-no-error-text accepts clean exit 0', successPredicateFromCriterion('exit-zero-no-error-text')(0, 'all good'));
check('contains:DONE passes when output has DONE', successPredicateFromCriterion('contains:DONE')(1, 'building... DONE'));
check('contains:DONE fails without DONE', !successPredicateFromCriterion('contains:DONE')(0, 'still running'));
check('not-contains:Error passes when clean', successPredicateFromCriterion('not-contains:Error')(0, 'ok output'));
check('function predicate is used as-is', successPredicateFromCriterion((code) => code === 7)(7, 'x'));

// 2. Concrete multi-iteration fix: a buggy script fixed by the fixer over
//    two passes — the loop must iterate 3 times and record each attempt.
{
  const store = new Map();
  store.set('buggy.js', "console.log(brokenVar);");
  const runs = [];
  const runCommand = async () => {
    const code = store.get('buggy.js');
    let output;
    try { new Function(code); output = code.includes('brokenVar') ? 'ReferenceError: brokenVar is not defined' : (code.includes('undefinedVar') ? 'ReferenceError: undefinedVar is not defined' : 'everything worked — DONE'); }
    catch (e) { output = e.message; }
    runs.push(output);
    const failedRun = /ReferenceError|is not defined/.test(output);
    return { exitCode: failedRun ? 1 : 0, output };
  };
  const writeFiles = async (files) => { for (const f of files) store.set(f.name, f.code); };
  // Deterministic fixer: pass 1 → still-broken variant; pass 2 → clean.
  let fixCalls = 0;
  const fixer = async ({ errorOutput }) => {
    fixCalls++;
    if (fixCalls === 1) return { files: [{ name: 'buggy.js', code: 'console.log(undefinedVar);' }], entryPoint: 'buggy.js' };
    return { files: [{ name: 'buggy.js', code: "console.log('everything worked — DONE');" }], entryPoint: 'buggy.js' };
  };

  const res = await runCodingLoop({
    goal: 'make buggy.js print DONE',
    entryPoint: 'buggy.js',
    files: [{ name: 'buggy.js', code: store.get('buggy.js') }],
    runCommand, writeFiles, fixer,
    successCriterion: 'contains:DONE',
    maxAttempts: 6,
    sendEvent: () => {},
  });

  check('loop iterated multiple times (attempts=3, got ' + res.attempts + ')', res.attempts === 3);
  check('loop succeeded once predicate passed', res.success === true);
  check('fixer was called twice (2 fix passes)', fixCalls === 2);
  check('exact errors were observed and fed back (attemptsLog length 3)', res.attemptsLog.length === 3);
  check('attempt 1 error recorded (brokenVar)', res.attemptsLog[0].outputHead.includes('brokenVar'));
  check('attempt 2 error recorded (undefinedVar)', res.attemptsLog[1].outputHead.includes('undefinedVar'));
  check('attempt 3 clean output recorded (DONE)', res.attemptsLog[2].outputHead.includes('DONE'));
  check('runs reflect 3 executions', runs.length === 3);
}

// 3. Hard budget: a fixer that never fixes → loop stops at maxAttempts, fails.
{
  const store = new Map();
  store.set('never.js', 'throw new Error("always");');
  const runCommand = async () => ({ exitCode: 1, output: 'Error: always' });
  const writeFiles = async () => {};
  const fixer = async () => ({ files: [{ name: 'never.js', code: 'throw new Error("always");' }], entryPoint: 'never.js' });
  const res = await runCodingLoop({
    goal: 'make it pass', entryPoint: 'never.js', files: [{ name: 'never.js', code: 'x' }],
    runCommand, writeFiles, fixer, successCriterion: 'exit-zero', maxAttempts: 4, sendEvent: () => {},
  });
  check('budget exhausted at 4 attempts', res.attempts === 4);
  check('budget exhaustion reports failure', res.success === false);
}

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
