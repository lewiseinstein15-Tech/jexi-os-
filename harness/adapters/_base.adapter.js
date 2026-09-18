/**
 * JEXI OS — CROSS-HARNESS ADAPTERS — base contract (Phase 7 H).
 *
 * Every adapter declares the same contract. This module validates it at
 * registration time (a bad adapter fails fast, not mid-install at 2am) and
 * ships two presets that cover most harnesses:
 *
 *   makeAgentAdapter(def)  — agents live as one front-matter .md file each
 *                            (claude-code, codex, gemini, kimi, ...)
 *   makeRuleAdapter(def)   — rules live as per-rule files or one merged file
 *                            (cursor .mdc, windsurf, aider CONVENTIONS.md)
 *
 * An adapter converts the canonical JEXI structure (workforce agents, rules,
 * skills, hooks, commands, mcp) into the harness's native format and installs
 * the converted files into the harness's config dir. install() is idempotent:
 * identical content is never rewritten (no mtime churn, no duplicates).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { writeConverted } from './_install.js';

export const FORMATS = Object.freeze(['markdown', 'mdc', 'yaml', 'json']);
export const SUPPORT_KEYS = Object.freeze(['agents', 'rules', 'skills', 'hooks', 'commands', 'mcp']);

/** Repo root (this file lives at harness/adapters/_base.adapter.js). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Resolve roots: 'home' → os.homedir(), 'project' → repo root; override wins. */
export function resolveRoot(root, override) {
  if (override) return path.resolve(String(override));
  if (root === 'home') return os.homedir();
  return REPO_ROOT;
}

/** Honest detection: does this path exist? */
export function detectPath(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/** Is a binary on PATH? (used by adapters whose harness is a CLI, e.g. aider) */
export function onPath(bin) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  return dirs.some((d) => {
    try {
      fs.accessSync(path.join(d, bin));
      return true;
    } catch {
      return false;
    }
  });
}

export function slugify(name) {
  return (
    String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'agent'
  );
}

/* ── front-matter helpers (writer + reader for round-trips) ─────────────── */

/** Build a `---\nkey: value\n---\n\nbody` markdown string. Values are single-line. */
export function frontMatter(meta, body) {
  const lines = Object.entries(meta)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${String(v).replace(/\s*\n\s*/g, ' ').trim()}`);
  return `---\n${lines.join('\n')}\n---\n\n${body.replace(/\s+$/, '')}\n`;
}

/** Minimal YAML front-matter reader (flat `key: value` pairs). Round-trip safe. */
export function parseFrontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(String(text || ''));
  if (!m) return { meta: {}, body: String(text || '') };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1]] = kv[2];
  }
  return { meta, body: String(text).slice(m[0].length).replace(/^\s*\n/, '').replace(/\s+$/, '') };
}

/* ── contract validation ────────────────────────────────────────────────── */

/** Validate an adapter against the contract. Throws on any violation. */
export function validateAdapter(a) {
  const fail = (msg) => {
    throw new TypeError(`adapter "${a?.id || '?'}" invalid: ${msg}`);
  };
  if (!a || typeof a !== 'object') fail('must be an object');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(a.id))) fail('id must be lowercase [a-z0-9-]');
  if (!String(a.displayName || '').trim()) fail('displayName must not be empty');
  if (typeof a.detected !== 'function') fail('detected() must be a function');
  if (typeof a.configDir !== 'string' || !a.configDir.trim()) fail('configDir must be a non-empty string');
  if (!FORMATS.includes(a.format)) fail(`format must be one of ${FORMATS.join(' | ')} (got "${a.format}")`);
  if (!a.supports || typeof a.supports !== 'object') fail('supports must be an object');
  for (const k of SUPPORT_KEYS) {
    if (typeof a.supports[k] !== 'boolean') fail(`supports.${k} must be a boolean`);
  }
  if (typeof a.convert !== 'function') fail('convert() must be a function');
  if (typeof a.install !== 'function') fail('install() must be a function');
  if (typeof a.reader !== 'function') fail('reader() must be a function (round-trip support)');
  if (a.root !== 'home' && a.root !== 'project') fail('root must be "home" or "project"');
  return true;
}

/* ── shared install plumbing (idempotent write via _install) ────────────── */

function makeInstall(def) {
  return function install(converted, opts = {}) {
    const base = installBaseFor(def);
    let targetRoot;
    if (opts.root) {
      // Controlled test root: mirror the same layout under the override.
      const rel = base === '.' ? '' : base.replace(/^~\/?/, '');
      targetRoot = path.join(path.resolve(String(opts.root)), rel);
    } else if (def.root === 'home') {
      targetRoot = path.join(os.homedir(), base.replace(/^~\/?/, ''));
    } else {
      targetRoot = path.resolve(REPO_ROOT, base);
    }
    return writeConverted({ converted, targetRoot, dryRun: !!opts.dryRun });
  };
}

/** Harness marker for detection: an explicit detectPath wins; otherwise the
 *  first segment of configDir ('~' stripped). '.' (repo-root harnesses like
 *  aider) must NOT collapse to the repo root itself — always exists, always
 *  a false positive — so such harnesses rely on detectPath/detectExtra. */
function markerFor(def) {
  if (def.detectPath) return def.detectPath;
  const seg = String(def.configDir).split('/')[0].replace(/^~\/?/, '');
  return seg && seg !== '.' ? seg : String(def.configDir);
}

/** Install BASE: the config dir minus the leaf segment the preset itself
 *  appends (agents/commands/rules). Converted paths are relative to this
 *  base (claude-code '~/.claude/agents' → base '~/.claude' so settings.json
 *  lands at ~/.claude/settings.json and agents at ~/.claude/agents/*.md). */
function installBaseFor(def) {
  const cd = String(def.configDir);
  return cd.replace(/\/(agents|rules|commands)$/, '') || '.';
}

/* ── preset: agent-per-file harnesses ───────────────────────────────────── */

/**
 * makeAgentAdapter — one front-matter markdown file per agent, plus optional
 * rule/command/hook/mcp outputs when the harness supports them.
 *
 * def extras:
 *   agentsDir    relative dir for agent files (e.g. 'agents')
 *   rulesFile    optional merged rules markdown (e.g. 'CLAUDE.md')
 *   commandsDir  optional per-command .md dir (e.g. 'commands')
 *   hooksFile    optional hooks json path (e.g. 'settings.json')
 *   mcpFile      optional mcp json path
 *   extraFiles(input) → [{ path, content }] for bespoke artifacts (openclaw SOUL.md)
 */
export function makeAgentAdapter(def) {
  const a = {
    id: def.id,
    displayName: def.displayName,
    root: def.root,
    configDir: def.configDir,
    format: def.format || 'markdown',
    supports: { ...def.supports },

    detected() {
      const base = resolveRoot(def.root, null);
      return detectPath(path.join(base, markerFor(def))) || !!def.detectExtra?.();
    },

    convert(input) {
      const files = [];
      for (const ag of input.agents) {
        const meta = { name: ag.name, description: ag.description };
        if (ag.models?.length) meta.models = ag.models.join(', ');
        if (ag.tools?.length) meta.tools = ag.tools.join(', ');
        if (ag.division) meta.division = ag.division;
        files.push({ kind: 'agent', path: `${def.agentsDir || 'agents'}/${slugify(ag.name)}.md`, content: frontMatter(meta, ag.body) });
      }
      if (def.supports.rules && input.rules.length) {
        files.push({ kind: 'rules', path: def.rulesFile || 'RULES.md', content: mergeRulesMarkdown(input.rules, { title: `${def.displayName} — JEXI OS rules` }) });
      }
      if (def.supports.commands && input.commands.length && def.commandsDir) {
        for (const c of input.commands) {
          files.push({ kind: 'command', path: `${def.commandsDir}/${c.name}.md`, content: commandMarkdown(c) });
        }
      }
      if (def.supports.hooks && input.hooks.entries.length && def.hooksFile) {
        files.push({ kind: 'hooks', path: def.hooksFile, content: JSON.stringify(hooksToSettings(input.hooks.entries), null, 2) + '\n' });
      }
      if (def.supports.mcp && input.mcp && def.mcpFile) {
        files.push({ kind: 'mcp', path: def.mcpFile, content: JSON.stringify(input.mcp, null, 2) + '\n' });
      }
      if (def.extraFiles) files.push(...def.extraFiles(input));
      return { files, warnings: [] };
    },

    // Round-trip reader: parse a converted agent file back to canonical shape.
    reader(text) {
      const { meta, body } = parseFrontMatter(text);
      return {
        name: meta.name || '',
        description: meta.description || '',
        models: meta.models ? String(meta.models).split(',').map((s) => s.trim()).filter(Boolean) : [],
        body,
      };
    },

    install: null, // set below
  };

  a.install = makeInstall(def);
  validateAdapter(a);
  return a;
}

/* ── preset: rule-file harnesses ────────────────────────────────────────── */

/**
 * makeRuleAdapter — rules converted per-rule or merged into one file.
 * def extras:
 *   rulesDir   relative dir for per-rule files (cursor 'rules', windsurf 'rules')
 *   mergedFile write ALL rules merged into one file instead (aider 'CONVENTIONS.md')
 *   ext        file extension for per-rule files ('mdc' | 'md')
 */
export function makeRuleAdapter(def) {
  const a = {
    id: def.id,
    displayName: def.displayName,
    root: def.root,
    configDir: def.configDir,
    format: def.format || (def.ext === 'mdc' ? 'mdc' : 'markdown'),
    supports: { ...def.supports },

    detected() {
      const base = resolveRoot(def.root, null);
      return detectPath(path.join(base, markerFor(def))) || !!def.detectExtra?.();
    },

    convert(input) {
      const files = [];
      const rules = input.rules;
      if (def.mergedFile) {
        if (rules.length) {
          files.push({ kind: 'rules', path: def.mergedFile, content: mergeRulesMarkdown(rules, { title: `${def.displayName} — JEXI OS conventions` }) });
        }
      } else {
        for (const r of rules) {
          files.push({
            kind: 'rule',
            path: `${def.rulesDir || 'rules'}/${r.category === 'common' ? '' : `${r.category}-`}${slugify(r.name)}.${def.ext || 'md'}`,
            content: def.ext === 'mdc' ? toMdc(r) : frontMatter({ description: r.description || r.name }, r.body),
          });
        }
      }
      return { files, warnings: [] };
    },

    // Round-trip reader: parse a converted rule file back to canonical shape.
    reader(text) {
      const { meta, body } = parseFrontMatter(text);
      if (def.ext === 'mdc') {
        return { name: meta.description || '', description: meta.description || '', globs: meta.globs || '', alwaysApply: meta.alwaysApply || 'false', body };
      }
      return { name: meta.description || '', description: meta.description || '', body };
    },

    install: null, // set below
  };

  a.install = makeInstall(def);
  validateAdapter(a);
  return a;
}

/* ── shared conversion snippets (used by presets) ───────────────────────── */

/** Merge rules into one markdown doc (aider CONVENTIONS.md, CLAUDE.md, AGENTS.md). */
export function mergeRulesMarkdown(rules, { title } = {}) {
  const parts = [`# ${title || 'JEXI OS rules'}`, ''];
  let lastCat = null;
  for (const r of rules) {
    if (r.category !== lastCat) {
      parts.push(`## ${r.category}`, '');
      lastCat = r.category;
    }
    parts.push(`### ${r.name}`, '', r.body.replace(/\s+$/, ''), '');
  }
  return parts.join('\n');
}

/** Cursor .mdc rule format (front-matter: description, globs, alwaysApply). */
export function toMdc(rule) {
  return frontMatter(
    {
      description: rule.description || rule.name,
      globs: rule.category === 'common' ? '**/*' : `**/*.{${rule.category}}`,
      alwaysApply: rule.category === 'common' ? 'true' : 'false',
    },
    rule.body,
  );
}

/** One harness slash-command file (claude-code style). */
export function commandMarkdown(c) {
  const args = (c.args || [])
    .map((x) => `${x.required ? '<' : '['}${x.name}${x.required ? '>' : ']'}:${x.type}${x.default !== undefined && x.default !== null ? `=${x.default}` : ''}`)
    .join(' ');
  const meta = { description: c.description, category: c.category };
  if (c.aliases?.length) meta.aliases = c.aliases.join(', ');
  const body = [`/${c.name}${args ? ` ${args}` : ''} — ${c.description}`, '', `Category: ${c.category}. Aliases: ${c.aliases?.length ? c.aliases.map((x) => `/${x}`).join(', ') : 'none'}.`].join('\n');
  return frontMatter(meta, body);
}

/** JEXI hooks.json entries → Claude Code settings.json hooks shape. */
export function hooksToSettings(entries) {
  const out = {};
  for (const h of entries) {
    if (!h.enabled) continue;
    const ev = (out[h.event] ||= []);
    let group = ev.find((g) => (g.matcher || null) === (h.matcher || null));
    if (!group) {
      group = h.matcher ? { matcher: h.matcher, hooks: [] } : { hooks: [] };
      ev.push(group);
    }
    group.hooks.push({ type: 'command', command: h.command, timeout: h.timeout || 5000 });
  }
  return { hooks: out };
}
