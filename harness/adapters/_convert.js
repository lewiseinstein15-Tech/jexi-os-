/**
 * JEXI OS — CROSS-HARNESS ADAPTERS — canonical collector (Phase 7 H).
 *
 * Reads the canonical JEXI structure from the repo and normalizes it into
 * one input object every adapter understands:
 *
 *   {
 *     agents:   [{ id, name, description, models, body, source }],
 *     rules:    [{ id, category, name, description, body, source }],
 *     skills:   [{ id, name, description, body, source }],
 *     hooks:    { raw, entries: [{ id, event, matcher, command, exitBehavior, timeout, enabled }] },
 *     commands: [{ name, aliases, description, category, args }],
 *     mcp:      { mcpServers } | null,
 *     errors:   [{ file, error }],   // per-file collection errors (convert must NOT crash)
 *   }
 *
 * Sources are probed in order and missing locations are skipped silently —
 * the collector is resilient to this repo growing/moving directories.
 *
 * Every per-file failure (syntax error, bad JSON) is CAPTURED into errors[]
 * with the exact file + reason; the rest of the collection continues (P11).
 */

import fs from 'fs';
import path from 'path';
import { REPO_ROOT, slugify, parseFrontMatter } from './_base.adapter.js';

/* ── small resilient readers ────────────────────────────────────────────── */

function readTextIfExists(p) {
  try {
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  } catch (e) {
    return { __error: e };
  }
}

function listDir(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory() ? fs.readdirSync(p) : [];
  } catch {
    return [];
  }
}

function walkMd(dir, out = []) {
  for (const entry of listDir(dir)) {
    const full = path.join(dir, entry);
    let st = null;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkMd(full, out);
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

/* ── collectors ─────────────────────────────────────────────────────────── */

function collectAgents(errors) {
  const agents = [];
  // 1) jexi-agents/coworkers/*.md — front-matter markdown coworkers (current home)
  for (const f of listDir(path.join(REPO_ROOT, 'jexi-agents/coworkers'))) {
    if (!f.endsWith('.md')) continue;
    const full = path.join(REPO_ROOT, 'jexi-agents/coworkers', f);
    const text = readTextIfExists(full);
    if (text === null) continue;
    if (text.__error) {
      errors.push({ file: full, error: String(text.__error.message) });
      continue;
    }
    try {
      const { meta, body } = parseFrontMatter(text);
      const name = meta.name || path.basename(f, '.md');
      agents.push({
        id: slugify(name),
        name,
        description: meta.description || '',
        models: Array.isArray(meta.models) ? meta.models : typeof meta.models === 'string' ? meta.models.split(',').map((s) => s.trim()).filter(Boolean) : [],
        body,
        source: path.relative(REPO_ROOT, full),
      });
    } catch (e) {
      errors.push({ file: full, error: String(e.message) });
    }
  }
  // 1b) agents/<division>/*.agent.md — Phase 7(I) canonical specialist pool
  // (wired into the collector so cross-harness conversion covers the 68;
  //  division dirs are scanned one level deep, template in meta/ is NOT
  //  *.agent.md so it never enters the conversion set)
  for (const div of listDir(path.join(REPO_ROOT, 'agents'))) {
    const divDir = path.join(REPO_ROOT, 'agents', div);
    for (const f of listDir(divDir)) {
      if (!f.endsWith('.agent.md')) continue;
      const full = path.join(divDir, f);
      const text = readTextIfExists(full);
      if (text === null) continue;
      if (text.__error) {
        errors.push({ file: full, error: String(text.__error.message) });
        continue;
      }
      try {
        const { meta, body } = parseFrontMatter(text);
        const name = meta.name || path.basename(f, '.agent.md');
        agents.push({
          id: slugify(name),
          name,
          description: meta.description || '',
          models: [],
          tools: Array.isArray(meta.tools) ? meta.tools : typeof meta.tools === 'string' ? meta.tools.split(',').map((s) => s.trim()).filter(Boolean) : [],
          division: meta.division || div,
          body,
          source: path.relative(REPO_ROOT, full),
        });
      } catch (e) {
        errors.push({ file: full, error: String(e.message) });
      }
    }
  }
  // 2) workforce/coworkers/*/agents/*.agent.js — canonical phase layout (if populated)
  for (const cw of listDir(path.join(REPO_ROOT, 'workforce/coworkers'))) {
    const agDir = path.join(REPO_ROOT, 'workforce/coworkers', cw, 'agents');
    for (const f of listDir(agDir)) {
      if (!f.endsWith('.agent.js')) continue;
      const full = path.join(agDir, f);
      const text = readTextIfExists(full);
      if (text === null) continue;
      if (text.__error) {
        errors.push({ file: full, error: String(text.__error.message) });
        continue;
      }
      try {
        // Extract declarative meta without executing the module (agents may
        // import runtime deps). Meta is a plain object literal in the file.
        const nameM = /name:\s*['"]([^'"]+)['"]/.exec(text);
        const descM = /description:\s*['"]([^'"]+)['"]/.exec(text);
        const name = nameM ? nameM[1] : path.basename(f, '.agent.js');
        agents.push({
          id: slugify(name),
          name,
          description: descM ? descM[1] : '',
          models: [],
          body: text.replace(/^\/\*\*[\s\S]*?\*\//, '').trim(),
          source: path.relative(REPO_ROOT, full),
        });
      } catch (e) {
        errors.push({ file: full, error: String(e.message) });
      }
    }
  }
  return agents;
}

function collectRules(errors) {
  const rules = [];
  const ruleRoots = [path.join(REPO_ROOT, 'server/rules'), path.join(REPO_ROOT, 'rules')];
  for (const root of ruleRoots) {
    if (!fs.existsSync(root)) continue;
    for (const f of walkMd(root)) {
      const text = readTextIfExists(f);
      if (text === null) continue;
      if (text.__error) {
        errors.push({ file: f, error: String(text.__error.message) });
        continue;
      }
      try {
        const category = path.basename(path.dirname(f));
        const { meta, body } = parseFrontMatter(text);
        const name = meta.name || meta.title || path.basename(f, '.md');
        rules.push({
          id: slugify(`${category}-${name}`),
          category,
          name,
          description: meta.description || '',
          body,
          source: path.relative(REPO_ROOT, f),
        });
      } catch (e) {
        errors.push({ file: f, error: String(e.message) });
      }
    }
  }
  return rules;
}

function collectSkills(errors) {
  const skills = [];
  for (const f of listDir(path.join(REPO_ROOT, 'skills'))) {
    const full = path.join(REPO_ROOT, 'skills', f);
    if (f.endsWith('.json')) {
      const text = readTextIfExists(full);
      if (text === null) continue;
      if (text.__error) {
        errors.push({ file: full, error: String(text.__error.message) });
        continue;
      }
      try {
        const data = JSON.parse(text);
        skills.push({ id: slugify(data.name || path.basename(f, '.json')), name: data.name || path.basename(f, '.json'), description: data.description || '', body: JSON.stringify(data, null, 2), source: path.relative(REPO_ROOT, full), data });
      } catch (e) {
        errors.push({ file: full, error: `JSON parse: ${e.message}` });
      }
    } else if (f.endsWith('.skill.js')) {
      const text = readTextIfExists(full);
      if (text === null) continue;
      if (text.__error) {
        errors.push({ file: full, error: String(text.__error.message) });
        continue;
      }
      const nameM = /name:\s*['"]([^'"]+)['"]/.exec(text);
      const descM = /description:\s*['"]([^'"]+)['"]/.exec(text);
      const name = nameM ? nameM[1] : path.basename(f, '.skill.js');
      skills.push({ id: slugify(name), name, description: descM ? descM[1] : '', body: text, source: path.relative(REPO_ROOT, full) });
    }
  }
  return skills;
}

function collectHooks(errors) {
  const full = path.join(REPO_ROOT, 'hooks/hooks.json');
  const text = readTextIfExists(full);
  if (text === null) return { raw: null, entries: [] };
  if (text.__error) {
    errors.push({ file: full, error: String(text.__error.message) });
    return { raw: null, entries: [] };
  }
  try {
    const raw = JSON.parse(text);
    const entries = Array.isArray(raw.hooks) ? raw.hooks : [];
    return { raw, entries };
  } catch (e) {
    errors.push({ file: full, error: `JSON parse: ${e.message}` });
    return { raw: null, entries: [] };
  }
}

async function collectCommands(errors) {
  try {
    const facade = await import(path.join(REPO_ROOT, 'commands/index.js'));
    if (typeof facade.registerAll === 'function') facade.registerAll();
    const list = typeof facade.list === 'function' ? facade.list() : [];
    return list.map((c) => ({ name: c.name, aliases: c.aliases || [], description: c.description, category: c.category, args: c.args || [] }));
  } catch (e) {
    errors.push({ file: 'commands/index.js', error: String(e.message) });
    return [];
  }
}

function collectMcp(errors) {
  const candidates = [path.join(REPO_ROOT, 'mcp/registry/local.json'), path.join(REPO_ROOT, 'mcp.example.json')];
  for (const full of candidates) {
    const text = readTextIfExists(full);
    if (text === null) continue;
    if (text.__error) {
      errors.push({ file: full, error: String(text.__error.message) });
      continue;
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      errors.push({ file: full, error: `JSON parse: ${e.message}` });
    }
  }
  return null;
}

/* ── public API ─────────────────────────────────────────────────────────── */

/** Collect the canonical input. Never throws for per-file issues (→ errors). */
export async function collectCanonical() {
  const errors = [];
  const [commands] = [await collectCommands(errors)];
  return {
    agents: collectAgents(errors),
    rules: collectRules(errors),
    skills: collectSkills(errors),
    hooks: collectHooks(errors),
    commands,
    mcp: collectMcp(errors),
    errors,
  };
}

/* ── rule filtering helper (probe P8: common + typescript) ──────────────── */

/** Filter rules to a set of categories, preserving order (common first). */
export function filterRules(rules, categories) {
  const wanted = new Set(categories);
  const common = rules.filter((r) => r.category === 'common');
  const rest = rules.filter((r) => wanted.has(r.category) && r.category !== 'common');
  return [...common, ...rest];
}
