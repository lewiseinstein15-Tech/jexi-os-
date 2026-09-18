/**
 * JEXI OS — UNIVERSAL SKILL INSTALLER — detect.js (Phase 12 Scope G).
 *
 * Consumes the Phase 7H cross-harness adapters (harness/adapters/index.js)
 * — same 14 targets, displayName + configDir come FROM the adapters; this
 * module derives each harness's SKILLS directory and detects installation.
 *
 * `--root` / env JEXI_INSTALLER_ROOT overrides the home base so installs
 * can be proven into a sandbox dir (real-home installs use the same code
 * path with root = os.homedir()).
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { list as adapterList } from '../../harness/adapters/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');

/** Harnesses whose skills story is directories of SKILL.md vs flattened md.
 *  NOTE: the 7H adapters predate skills support (all carry supports.skills:
 *  false for their AGENT pipelines) — this installer's job is to ADD the
 *  SKILL.md story, so the default is skill-dir and only true exceptions are
 *  overridden. aider has no skills/rules concept at all → flattened docs. */
const STYLE_OVERRIDES = { aider: 'flat-md' };

/** Explicit skills-dir overrides where derivation from configDir is wrong. */
const DIR_OVERRIDES = { aider: '~/.aider/skills' };

export function homeRoot() {
  return process.env.JEXI_INSTALLER_ROOT || os.homedir();
}

/** '~/.claude/agents' / '~/.cursor/rules' → <root>/.claude/skills, .cursor/skills */
export function skillsDirFor(adapter, root = homeRoot()) {
  if (DIR_OVERRIDES[adapter.id]) {
    const o = DIR_OVERRIDES[adapter.id];
    return o.startsWith('~') ? path.join(root, o.slice(1)) : path.resolve(root, o);
  }
  const cfg = String(adapter.configDir || '');
  const expanded = cfg.startsWith('~') ? path.join(root, cfg.slice(1)) : path.resolve(root, cfg);
  const withSkills = /\/(agents|rules)$/.test(expanded)
    ? expanded.replace(/\/(agents|rules)$/, '/skills')
    : path.join(expanded, 'skills');
  return withSkills;
}

export function targets(root = homeRoot()) {
  return adapterList().map((a) => {
    const style = STYLE_OVERRIDES[a.id] || 'skill-dir';
    return {
      id: a.id,
      displayName: a.displayName,
      configDir: a.configDir,
      dir: skillsDirFor(a, root),
      style, // 'skill-dir' → <dir>/<slug>/SKILL.md ; 'flat-md' → <dir>/<slug>.md
    };
  });
}

export function detect(root = homeRoot()) {
  return targets(root).map((t) => {
    const parent = path.dirname(t.dir);
    const detected = fs.existsSync(t.dir) || fs.existsSync(parent);
    return { ...t, detected, evidence: fs.existsSync(t.dir) ? t.dir : detected ? parent : null };
  });
}

export function getTarget(id, root = homeRoot()) {
  return targets(root).find((t) => t.id === id) ?? null;
}
