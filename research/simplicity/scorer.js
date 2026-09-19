// research/simplicity/scorer.js
// PHASE 21 SCOPE G — the simplicity criterion.
//
// A metric improvement is not free: it is bought with complexity. The scorer
// weighs the two and returns a verdict.
//
//   complexityCost = linesChanged + 5 * filesChanged + 10 * hackyMarkers
//     linesChanged   = addedLines + removedLines (NEGATIVE when the diff shrinks the code)
//     filesChanged   = how many files the experiment touched (churn is expensive)
//     hackyMarkers   = explicit hacky flags + auto-detected code smells (eval, as any,
//                      @ts-ignore, FIXME, TODO HACK, empty catch, process.exit, globalThis)
//
//   worth = metricGain > 0 && metricGain >= complexityCost * EPS
//           || (metricGain === 0 && complexityCost < 0)   // pure simplification
//   EPS = 0.0002 — every unit of complexity must buy at least 0.0002 metric.
//
// The phase's rule holds exactly: a 0.001 improvement from 20 hacky lines is
// worth: false (cost 20+10 = 30 -> needs 0.006); the same 0.001 from 4 clean
// lines is worth: true (needs 0.0008). Simpler wins ties: compare() breaks
// equal-gain contests by lower complexityCost.

const EPS = 0.0002;
const FILE_WEIGHT = 5;
const HACKY_WEIGHT = 10;

const SMELL_PATTERNS = [
  /\beval\s*\(/,
  /\bas\s+any\b/,
  /@ts-ignore/,
  /\bFIXME\b/,
  /TODO\s+HACK/i,
  /catch\s*\{\s*\}/,
  /process\.exit\s*\(/,
  /\bglobalThis\b/,
];

function countSmells(code) {
  if (typeof code !== 'string') return 0;
  let n = 0;
  for (const re of SMELL_PATTERNS) {
    const m = code.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
    if (m) n += m.length;
  }
  return n;
}

function metricGainOf(experiment) {
  if (Number.isFinite(experiment.metricGain)) return experiment.metricGain;
  const { metric, previousBest } = experiment;
  if (!Number.isFinite(metric) || !Number.isFinite(previousBest)) return null;
  // lower is better by default (val_bpb semantics); higherIsBetter flips the sign
  const gain = experiment.higherIsBetter === true ? metric - previousBest : previousBest - metric;
  return gain;
}

// CONTRACT
//   score(experiment) -> { metricGain, complexityCost, worth, minimumGain, reasons }
// experiment: {
//   metric, previousBest       — lower-is-better metric (or explicit metricGain)
//   metricGain, higherIsBetter — alternative encodings
//   diff: { added, removed }   — or explicit linesChanged
//   filesChanged,
//   hacky: true|['reason',...], code: '...' — hacky flags + smell text to scan
// }
export function score(experiment = {}) {
  const reasons = [];

  const metricGain = metricGainOf(experiment);
  if (metricGain === null) {
    return {
      metricGain: null,
      complexityCost: null,
      worth: false,
      minimumGain: null,
      reasons: ['no metric pair (metric, previousBest) or explicit metricGain — cannot score'],
    };
  }

  const added = Number.isFinite(experiment.diff?.added) ? experiment.diff.added : 0;
  const removed = Number.isFinite(experiment.diff?.removed) ? experiment.diff.removed : 0;
  // (removed lines REDUCE cost — deleting code is the cheapest improvement)
  // NET line delta: negative when the diff shrinks the code (simplification).
  const linesChanged = Number.isFinite(experiment.linesChanged)
    ? experiment.linesChanged
    : added - removed;
  const filesChanged = Number.isFinite(experiment.filesChanged) ? experiment.filesChanged : 0;
  const explicitHacky = experiment.hacky === true ? 1 : Array.isArray(experiment.hacky) ? experiment.hacky.length : 0;
  const hackyMarkers = explicitHacky + countSmells(experiment.code);

  const complexityCost = linesChanged + FILE_WEIGHT * filesChanged + HACKY_WEIGHT * hackyMarkers;
  const minimumGain = complexityCost * EPS;

  if (metricGain > 0 && metricGain >= minimumGain) {
    reasons.push(
      `gain ${metricGain} buys its complexity (cost ${complexityCost} needs >= ${minimumGain.toFixed(6)})`,
    );
  } else if (metricGain > 0) {
    reasons.push(
      `gain ${metricGain} too small for complexity cost ${complexityCost} (needs >= ${minimumGain.toFixed(6)})`,
    );
  } else if (metricGain === 0 && complexityCost < 0) {
    reasons.push(`zero metric change but the diff is simpler (cost ${complexityCost}) — simplification is worth it`);
  } else if (metricGain === 0) {
    reasons.push(`no metric gain and no simplification (cost ${complexityCost}) — not an experiment worth keeping`);
  } else {
    reasons.push(`metric regressed (gain ${metricGain})`);
  }
  if (hackyMarkers > 0) reasons.push(`${hackyMarkers} hacky marker(s) add ${HACKY_WEIGHT * hackyMarkers} cost`);

  const worth = (metricGain > 0 && metricGain >= minimumGain) || (metricGain === 0 && complexityCost < 0);

  return { metricGain, complexityCost, worth, minimumGain, reasons };
}

// CONTRACT
//   compare(a, b) -> 'a' | 'b' | 'tie'
// Higher metricGain wins; on a tie, SIMPLER wins (lower complexityCost).
export function compare(a, b) {
  const sa = score(a);
  const sb = score(b);
  if (sa.metricGain === null || sb.metricGain === null) return 'tie';
  if (Math.abs(sa.metricGain - sb.metricGain) > 1e-9) {
    return sa.metricGain > sb.metricGain ? 'a' : 'b';
  }
  if (sa.complexityCost === sb.complexityCost) return 'tie';
  return sa.complexityCost < sb.complexityCost ? 'a' : 'b';
}

export const SIMPLICITY_EPS = EPS;
