// Toy training harness — the analog of autoresearch's train.py run + eval.
// READ-ONLY to the experiment loop (it is the judge, like prepare.py's eval in
// karpathy/autoresearch). It loads the candidate module named by TOY_CANDIDATE,
// simulates a short training run, then prints `val_metric=<number>` — lower is
// better, the toy analog of val_bpb.
import { pathToFileURL } from 'node:url';
import { generateData } from './data.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidatePath = process.env.TOY_CANDIDATE;
if (!candidatePath) {
  console.error('TOY_CANDIDATE env var is required');
  process.exit(2);
}

let predict;
try {
  const mod = await import(pathToFileURL(candidatePath).href);
  predict = mod.predict;
} catch (err) {
  console.error('candidate failed to load:', err?.message ?? err);
  process.exit(3);
}
if (typeof predict !== 'function') {
  console.error('candidate must export predict(x)');
  process.exit(3);
}

const { train, val } = generateData();

// Metric: 0.5 * MSE + 1.0 — keeps numbers in val_bpb-like territory (~1.0x).
const evaluate = (rows) => {
  let sum = 0;
  for (const { x, y } of rows) {
    const d = predict(x) - y;
    sum += d * d;
  }
  return (sum / rows.length) * 0.5 + 1.0;
};

for (let epoch = 1; epoch <= 6; epoch++) {
  await sleep(15);
  console.log(`epoch ${epoch}/6 train_metric=${evaluate(train).toFixed(6)}`);
}

console.log(`val_metric=${evaluate(val).toFixed(6)}`);
