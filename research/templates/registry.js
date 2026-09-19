// research/templates/registry.js
// PHASE 21 SCOPE I — template registry: named skills that seed experiments.
// A template skill is validated at registration (name + description + applies
// + seed), deduplicated, and selectable by applicability to a codebase.
import { parameterSweepSkill } from './template.skill.js';

export function createTemplateRegistry() {
  const skills = new Map();

  function validate(skill) {
    if (!skill || typeof skill !== 'object') throw new Error('template skill must be an object');
    if (typeof skill.name !== 'string' || !skill.name) throw new Error('template skill requires a name');
    if (typeof skill.description !== 'string') throw new Error('template skill requires a description');
    if (typeof skill.applies !== 'function') throw new Error('template skill requires applies(context)');
    if (typeof skill.seed !== 'function') throw new Error('template skill requires seed(context)');
  }

  return {
    register(skill) {
      validate(skill);
      if (skills.has(skill.name)) throw new Error(`duplicate template skill '${skill.name}'`);
      skills.set(skill.name, skill);
      return skill.name;
    },
    get(name) {
      return skills.get(name) ?? null;
    },
    list() {
      return [...skills.values()].map((s) => ({ name: s.name, description: s.description }));
    },
    // CONTRACT: seed from a codebase with the first applicable skill.
    //   registry.seedFromTarget({ targetPath, source, ... }) ->
    //     { skill: name, configs: [...], ok: boolean }
    seedFromTarget({ targetPath, source, ...rest } = {}) {
      for (const skill of skills.values()) {
        if (skill.applies({ source, targetPath, ...rest })) {
          const configs = skill.seed({ targetPath, source, ...rest });
          return { ok: true, skill: skill.name, configs };
        }
      }
      return { ok: false, skill: null, configs: [], reason: 'no applicable template skill for this target' };
    },
  };
}

export function createDefaultRegistry() {
  const registry = createTemplateRegistry();
  registry.register(parameterSweepSkill);
  return registry;
}
