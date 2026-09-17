/**
 * JEXI OS — Phase 7 Scope A: rules system loader.
 *
 * Detects the project stack from on-disk markers, loads the matching rule
 * files (common always loads; language-specific rules load per detected
 * stack) and renders the context block injected into the agent's system
 * prompt (server/src/services/JexiPrompt.js).
 *
 * Contract:
 *   - `common` rules ALWAYS load.
 *   - Language rules load only for a detected stack.
 *   - A rule file either loads WHOLE or is reported as not loaded (budget).
 *     Nothing is ever half-rendered silently.
 *   - The loader never throws: if rules break, the system prompt must still
 *     build (an error is logged to stderr and the block is omitted).
 *   - Project root resolution: env JEXI_RULES_PROJECT_ROOT, else this repo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RULES_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(RULES_DIR, '..');

/** Language stacks with rule directories under rules/. */
export const LANGUAGE_STACKS = [
  'typescript', 'python', 'golang', 'rust', 'react', 'vue', 'angular',
  'php', 'ruby', 'swift', 'react-native', 'web', 'arkts',
];

/** Char budget for the rendered rules block (~3k tokens). */
export const DEFAULT_BLOCK_BUDGET = 12000;

function exists(p) {
  try { fs.statSync(p); return true; } catch { return false; }
}

function readdirSafe(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

function readPkgJson(projectDir) {
  try { return JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf-8')); }
  catch { return null; }
}

function depsOf(pkg) {
  return { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
}

function hasDep(deps, name) {
  return Object.prototype.hasOwnProperty.call(deps, name);
}

function hasDepPrefix(deps, prefix) {
  return Object.keys(deps).some((k) => k === prefix || k.startsWith(prefix));
}

/**
 * Detect the project stack for a directory.
 * Returns an ordered list; 'common' is always first.
 */
export function detectStack(projectDir) {
  const dir = path.resolve(projectDir);
  const stacks = [];
  const push = (s) => { if (!stacks.includes(s)) stacks.push(s); };
  const has = (f) => exists(path.join(dir, f));
  const anyFile = (re) => readdirSafe(dir).some((f) => re.test(f));

  // — Marker-file languages —
  if (has('pyproject.toml') || has('requirements.txt') || has('setup.py') || has('setup.cfg') || has('Pipfile')) push('python');
  if (has('go.mod') || has('go.sum')) push('golang');
  if (has('Cargo.toml')) push('rust');
  if (has('composer.json')) push('php');
  if (has('Gemfile') || anyFile(/\.gemspec$/)) push('ruby');
  if (has('Package.swift') || has('Podfile') || anyFile(/\.xcworkspace$|\.xcodeproj$/)) push('swift');

  // — HarmonyOS / ArkTS (marker dirs or files) —
  if (has('oh-package.json5') || has('build-profile.json5') || has('AppScope')) push('arkts');

  // — package.json ecosystems —
  const pkg = readPkgJson(dir);
  if (pkg) {
    const deps = depsOf(pkg);
    if (hasDep(deps, 'react-native') || hasDepPrefix(deps, '@react-native/') || hasDep(deps, 'expo')) push('react-native');
    if (hasDep(deps, 'react') || hasDep(deps, 'react-dom') || hasDep(deps, 'next')) push('react');
    if (hasDep(deps, 'vue') || hasDep(deps, 'nuxt') || hasDepPrefix(deps, '@nuxt/')) push('vue');
    if (hasDepPrefix(deps, '@angular/')) push('angular');
    if (hasDep(deps, 'typescript') || has('tsconfig.json')) push('typescript');
    // Plain JS/HTML project with no detected framework falls back to web.
    if (stacks.length === 0) push('web');
  } else if (stacks.length === 0) {
    // No package.json and no language markers: HTML/CSS/JS presence → web.
    if (anyFile(/\.html$/i) || anyFile(/\.css$/i) || anyFile(/\.m?js$/i)) push('web');
  }

  return ['common', ...stacks];
}

/** Strip YAML-ish frontmatter (--- ... ---) from a rule file body. */
function stripFrontmatter(content) {
  const m = content.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  return m ? content.slice(m[0].length) : content;
}

/**
 * Load rule files for a project directory.
 * Whole-file semantics: a file fits in the budget or is reported dropped.
 */
export function loadRules(projectDir = REPO_ROOT, opts = {}) {
  const dir = path.resolve(projectDir);
  const budget = Number(opts.budget) || DEFAULT_BLOCK_BUDGET;
  const stacks = detectStack(dir);
  const files = [];
  const dropped = [];
  let chars = 0;

  for (const stack of stacks) {
    const sdir = path.join(RULES_DIR, stack);
    for (const f of readdirSafe(sdir).filter((n) => n.endsWith('.md')).sort()) {
      const abs = path.join(sdir, f);
      let content;
      try { content = fs.readFileSync(abs, 'utf-8'); } catch { continue; }
      const id = (content.match(/^id:\s*(\S+)/m) || [])[1] || `${stack}/${f.replace(/\.md$/, '')}`;
      const cost = content.length + 48; // section header + blank lines
      if (chars + cost > budget) { dropped.push(`rules/${stack}/${f}`); continue; }
      chars += cost;
      files.push({ stack, rel: `rules/${stack}/${f}`, id, content });
    }
  }

  return { project: dir, stacks, files, dropped, chars };
}

/**
 * Render the loaded rules as the system-prompt context block.
 * The block carries its own header, so zero loaded files → empty string.
 */
export function renderRulesBlock(loaded) {
  if (!loaded || loaded.files.length === 0) return '';
  const parts = [];
  parts.push(`# ACTIVE RULES (JEXI rules system — Phase 7A)`);
  parts.push(`Detected stack: ${loaded.stacks.join(', ')}. Loaded ${loaded.files.length} rule file(s), ${loaded.chars} chars. These rules are binding for this project.`);
  for (const f of loaded.files) {
    parts.push(`\n## ${f.rel} [id: ${f.id}]`);
    parts.push(stripFrontmatter(f.content).trim());
  }
  if (loaded.dropped.length > 0) {
    parts.push(`\nNot loaded (over budget): ${loaded.dropped.join(', ')}`);
  }
  return parts.join('\n');
}

/** Default project root: env override, else this repository. */
function resolveProjectRoot(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.JEXI_RULES_PROJECT_ROOT) return path.resolve(process.env.JEXI_RULES_PROJECT_ROOT);
  return REPO_ROOT;
}

/**
 * One-call integration surface used by the system prompt:
 * builds the block for the active project root. Never throws.
 */
export function rulesBlockForProject(projectDir, opts = {}) {
  try {
    return renderRulesBlock(loadRules(resolveProjectRoot(projectDir), opts));
  } catch (e) {
    console.error('[rules] load failed:', String(e?.message || e));
    return '';
  }
}

/** Status summary (for /api surfaces and probes). */
export function rulesStatus(projectDir, opts = {}) {
  const loaded = loadRules(resolveProjectRoot(projectDir), opts);
  return {
    project: loaded.project,
    stacks: loaded.stacks,
    files: loaded.files.map((f) => f.rel),
    dropped: loaded.dropped,
    chars: loaded.chars,
  };
}
