/**
 * JEXI OS — PHASE 31 SCOPE 5 — S4-EXEC: executable skills -> server skills catalog.
 *
 * skills/executable/** packages (SKILL.md + skill.py, shipped READ-ONLY) join
 * the server skills catalog through the catalog's OWN plugin-skill seam —
 * server/src/skills/catalog.js pluginSkillDirs() reads
 * globalThis.__jexiPluginRegistry ({ discoverPlugins, isPluginEnabled }).
 * This registrar contributes the skills/executable directory as one
 * contribution, MERGING with the real PluginRegistry global when it is
 * already installed (server/index.js imports PluginRegistry at module load,
 * before the boot seam runs) and installing standalone otherwise.
 *
 * Result: the executable skills become visible via catalog() and loadable via
 * skillMdPath()/readSkill()/executeSkillBySlug() — exactly like builtin
 * skills, with zero shipped-module edits and zero file copies.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const EXEC_SKILLS_DIR = path.join(REPO_ROOT, 'skills', 'executable');
const CONTRIBUTION_ID = 'w31-executable-skills';

export function executableSkillsStatus() {
  try {
    const dirs = fs.readdirSync(EXEC_SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(EXEC_SKILLS_DIR, d.name, 'SKILL.md')))
      .map((d) => d.name);
    return { dir: EXEC_SKILLS_DIR, skills: dirs, registered: globalThis.__jexiPluginRegistry?.__w31ExecutableSkills === true };
  } catch (e) {
    return { dir: EXEC_SKILLS_DIR, skills: [], registered: false, error: String(e && e.message || e).slice(0, 120) };
  }
}

/** Install (or merge into) the plugin-skill seam. Idempotent; never clobbers. */
export function registerExecutableSkills() {
  const prev = globalThis.__jexiPluginRegistry || null;
  if (prev && prev.__w31ExecutableSkills) return executableSkillsStatus(); // already installed
  const mine = { id: CONTRIBUTION_ID, packageDir: path.join(REPO_ROOT, 'skills'), contributes: { skillsDir: 'executable' } };

  globalThis.__jexiPluginRegistry = {
    __w31ExecutableSkills: true,
    discoverPlugins() {
      const theirs = prev && typeof prev.discoverPlugins === 'function' ? prev.discoverPlugins() : [];
      return [...theirs, mine];
    },
    isPluginEnabled(id) {
      if (id === CONTRIBUTION_ID) return true;
      return prev && typeof prev.isPluginEnabled === 'function' ? !!prev.isPluginEnabled(id) : false;
    },
  };
  return executableSkillsStatus();
}

export default registerExecutableSkills;
