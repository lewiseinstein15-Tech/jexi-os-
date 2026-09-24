import { PersistentRepl } from '../kernel/index.js';
let repl = new PersistentRepl();
process.on('disconnect', () => process.exit(0)); // daemon died: never leave an orphan runtime
process.on('message', ({ requestId, op, payload }) => {
  try {
    let value;
    if (op === 'restore') { repl = PersistentRepl.restore(payload); value = true; }
    else if (op === 'eval') {
      const prior = repl.snapshot();
      try { const result = repl.eval(payload.code, payload.ctx); value = { result, snapshot: repl.snapshot() }; }
      catch (e) { repl = PersistentRepl.restore(prior); throw e; }
    } else if (op === 'snapshot') value = repl.snapshot();
    else throw new Error('E_WORKER_OP');
    process.send?.({ requestId, value });
  } catch (e) { process.send?.({ requestId, error: e.code || e.message }); }
});
process.send({ ready: true });
