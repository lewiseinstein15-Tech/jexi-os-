// research/templates/template.skill.js
// PHASE 21 SCOPE I — a skill that seeds experiments from any codebase.
//
// A template skill is a plain module with metadata + a seed() function: it
// READS a target file (the train.py analog), finds parameters worth sweeping,
// and emits experiment CONFIGS — one knob per experiment (the program.md
// strategy rule), each carrying a find/replace mutation plan that the loop
// applies through the Scope-B guards (guardedWriteFile), so a template can
// never violate the read-only constraint set.
//
// The builtin skill 'experiment-seeder.parameter-sweep' detects linear-model
// style expressions `a * x + b` in the source and sweeps each coefficient by
// ±10%. Other codebases fall back to seeding from an explicit spec (custom
// skills can be registered in registry.js).

const COEFF_RE = /([0-9]*\.?[0-9]+)\s*\*\s*([A-Za-z_$][\w$]*)\s*\+\s*([0-9]*\.?[0-9]+)/g;

export const parameterSweepSkill = {
  name: 'experiment-seeder.parameter-sweep',
  description:
    'Seed one-change-per-experiment configs from a codebase: finds coefficient-style parameters (a * x + b) in a target file and sweeps each by ±10%.',
  // Does this skill apply to the given codebase context?
  applies({ source }) {
    return typeof source === 'string' && COEFF_RE.test(source);
  },
  // CONTRACT
  //   seed({ idPrefix, targetPath, source, strategy }) -> experiment configs
  //   config: { id, hypothesis, knobs, plan: { file, find, replace } }
  seed({ idPrefix = 'sweep', targetPath, source = '', strategy = null } = {}) {
    if (!targetPath) throw new Error('seed requires targetPath');
    const configs = [];
    let m;
    COEFF_RE.lastIndex = 0;
    let index = 0;
    while ((m = COEFF_RE.exec(source)) !== null) {
      const [expr, a, varName, b] = m;
      const variants = [
        { label: 'slope-down', part: 'slope', knob: 'slope', value: round2(Number(a) * 0.9), from: a },
        { label: 'slope-up', part: 'slope', knob: 'slope', value: round2(Number(a) * 1.1), from: a },
        { label: 'bias-down', part: 'bias', knob: 'bias', value: round2(Number(b) * 0.9), from: b },
        { label: 'bias-up', part: 'bias', knob: 'bias', value: round2(Number(b) * 1.1), from: b },
      ];
      for (const v of variants) {
        // ONE change per experiment: a slope variant touches only the
        // coefficient term; a bias variant only the additive term.
        const replacement =
          v.part === 'slope'
            ? expr.replace(`${a} * ${varName}`, `${v.value} * ${varName}`)
            : expr.replace(`+ ${b}`, `+ ${v.value}`);
        configs.push({
          id: `${idPrefix}-${index}-${v.label}`,
          hypothesis: `sweep ${v.knob} -> ${v.value} (±10% from ${v.from}; ${v.part} only)`,
          template: parameterSweepSkill.name,
          knobs: { [v.knob]: v.value, target: targetPath },
          plan: { file: targetPath, find: expr, replace: replacement },
        });
      }
      index++;
    }
    if (strategy) {
      for (const c of configs) c.strategyHint = strategy;
    }
    return configs;
  },
};

function round2(n) {
  return Math.round(n * 100) / 100;
}
