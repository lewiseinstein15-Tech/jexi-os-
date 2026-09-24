// research/budget/wall-clock.js
// Fixed wall-clock budget per experiment — the autoresearch design choice
// (karpathy/autoresearch, MIT): every run gets the SAME fixed budget (there 5
// minutes excluding startup/compile) so experiments stay comparable no matter
// what the agent changes.
//
// CONTRACT
//   enforceBudget(fn, ms, opts?) -> Promise<{
//     overBudget: boolean, killed: boolean,
//     result?: any, error?: string, elapsedMs: number
//   }>
//
// Modes:
//   - 'worker' (default): fn's source is evaluated inside a worker_threads
//     Worker with a hard timer. An over-budget run is TERMINATED cleanly via
//     worker.terminate() -> killed: true. Works even for busy-wait sync fns.
//     fn must be self-contained (no closure references).
//   - 'inline': runs fn in-process via a Promise race. Use for closure-bound
//     or async fns. A blocking fn CANNOT be stopped this way — the race
//     resolves overBudget: true but the work itself must be abandoned by the
//     caller (killed: false, honest about the limitation).
import { Worker } from 'node:worker_threads';

const WORKER_SRC = `
  const { parentPort, workerData } = require('node:worker_threads');
  (async () => {
    try {
      const fn = eval('(' + workerData.fnSource + ')');
      const result = await fn(workerData.arg);
      parentPort.postMessage({ ok: true, result });
    } catch (err) {
      parentPort.postMessage({ ok: false, error: String((err && err.message) || err) });
    }
  })();
`;

function runInWorker(fnSource, ms, arg) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    let terminating = false; // set once WE initiate terminate(); any exit after that is a budget kill
    const done = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const worker = new Worker(WORKER_SRC, {
      eval: true,
      workerData: { fnSource, arg },
      stdio: 'ignore',
    });
    const timer = setTimeout(() => {
      terminating = true;
      worker
        .terminate()
        .catch(() => {})
        .then(() =>
          done({ overBudget: true, killed: true, elapsedMs: Date.now() - started }),
        );
    }, ms);
    worker.on('message', (msg) => {
      if (msg?.ok) done({ overBudget: false, killed: false, result: msg.result, elapsedMs: Date.now() - started });
      else done({ overBudget: false, killed: false, error: msg?.error ?? 'worker failed', elapsedMs: Date.now() - started });
    });
    worker.on('error', (err) =>
      done({ overBudget: false, killed: false, error: String(err?.message ?? err), elapsedMs: Date.now() - started }),
    );
    worker.on('exit', (code) => {
      if (terminating) {
        // We pulled the plug — attribute the exit to the budget, whatever the code.
        done({ overBudget: true, killed: true, elapsedMs: Date.now() - started });
      } else if (code !== 0) {
        done({ overBudget: false, killed: false, error: `worker exited with code ${code}`, elapsedMs: Date.now() - started });
      }
    });
  });
}

async function runInline(fn, ms) {
  const started = Date.now();
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(fn)
        .then(
          (result) => ({ overBudget: false, killed: false, result, elapsedMs: Date.now() - started }),
          (err) => ({ overBudget: false, killed: false, error: String(err?.message ?? err), elapsedMs: Date.now() - started }),
        ),
      new Promise((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              overBudget: true,
              killed: false,
              error: 'exceeded budget (inline race — work not stopped, must be abandoned by caller)',
              elapsedMs: Date.now() - started,
            }),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// CONTRACT
//   enforceBudget(fn, ms, opts?) — see header.
// opts: { mode?: 'worker'|'inline', arg?: any }
export async function enforceBudget(fn, ms, opts = {}) {
  if (typeof fn !== 'function') {
    return { overBudget: false, killed: false, error: 'enforceBudget requires a function', elapsedMs: 0 };
  }
  const mode = opts.mode === 'inline' ? 'inline' : 'worker';
  if (mode === 'worker') {
    return runInWorker(String(fn), ms, opts.arg ?? null);
  }
  return runInline(fn, ms);
}
