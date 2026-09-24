/** JEXI OS — Phase 30 Scope B — fail-closed skill tool enforcement. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SemanticaError } from '../../../services/semantica/_internal.js';
import { allowed, parse } from './scoping.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '../../..');
const PHASE12_BASELINE_DIRS = Object.freeze(['skills/design', 'skills/engineering']);
const PHASE12_MANIFEST = 'skills/library/IMPORT-MANIFEST.json';

export function assert(skill, call) {
  const skillName = String(skill?.name ?? skill?.slug ?? '(unnamed skill)');
  const toolName = String(call?.tool ?? '(unknown tool)');
  const allowlist = skill && typeof skill === 'object' && Object.hasOwn(skill, 'allowedTools')
    ? skill.allowedTools
    : undefined;
  const verdict = allowed(allowlist, call);
  if (verdict.allowed) return verdict;
  const error = new SemanticaError(
    'E_TOOL_NOT_ALLOWED',
    `skill ${JSON.stringify(skillName)} cannot call tool ${JSON.stringify(toolName)}: ${verdict.reason}`,
  );
  error.skill = skillName;
  error.tool = toolName;
  throw error;
}

function walkSkillFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkSkillFiles(target));
    else if (entry.isFile() && entry.name === 'SKILL.md') files.push(target);
  }
  return files;
}

function stripQuotes(value) {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'")))) return value.slice(1, -1);
  return value;
}

function parseArray(value) {
  if (!value.startsWith('[') || !value.endsWith(']')) return null;
  const inner = value.slice(1, -1).trim();
  if (!inner) return [];
  const values = inner.split(',').map((item) => stripQuotes(item.trim()));
  return values.every((item) => item !== '') ? values : null;
}

function inspectSkill(root, descriptor) {
  const absolute = path.resolve(root, descriptor.path);
  const rootPrefix = `${path.resolve(root)}${path.sep}`;
  if (!absolute.startsWith(rootPrefix) || !fs.existsSync(absolute)) {
    return {
      name: descriptor.id,
      path: descriptor.path,
      source: descriptor.source,
      allowedTools: null,
      declared: false,
      enforced: false,
      reason: !absolute.startsWith(rootPrefix) ? 'registry path escapes repository root' : 'SKILL.md is missing',
    };
  }

  const raw = fs.readFileSync(absolute, 'utf8');
  const end = raw.startsWith('---\n') ? raw.indexOf('\n---\n', 4) : -1;
  const frontmatter = end >= 0 ? raw.slice(4, end) : '';
  const lines = frontmatter.split('\n');
  const nameLine = lines.find((line) => /^name\s*:/.test(line));
  const name = nameLine ? stripQuotes(nameLine.replace(/^name\s*:\s*/, '').trim()) : descriptor.id;
  const declarations = lines.filter((line) => /^allowedTools\s*:/.test(line));
  const alternative = lines.find((line) => /^(allowedtools|allowed-tools)\s*:/.test(line));

  if (declarations.length !== 1) {
    const detail = declarations.length > 1
      ? 'allowedTools is declared more than once'
      : alternative ? `allowedTools is not declared (found non-canonical ${JSON.stringify(alternative.split(':', 1)[0])})`
        : 'allowedTools is not declared';
    return {
      name,
      path: descriptor.path,
      source: descriptor.source,
      allowedTools: null,
      declared: false,
      enforced: false,
      reason: detail,
    };
  }

  const patterns = parseArray(declarations[0].replace(/^allowedTools\s*:\s*/, '').trim());
  if (!patterns) {
    return {
      name,
      path: descriptor.path,
      source: descriptor.source,
      allowedTools: null,
      declared: true,
      enforced: false,
      reason: 'allowedTools must be a bracketed array',
    };
  }

  try {
    for (const pattern of patterns) parse(pattern);
  } catch (error) {
    return {
      name,
      path: descriptor.path,
      source: descriptor.source,
      allowedTools: patterns,
      declared: true,
      enforced: false,
      reason: `${error.code ?? error.name}: ${error.message}`,
    };
  }

  return {
    name,
    path: descriptor.path,
    source: descriptor.source,
    allowedTools: patterns,
    declared: true,
    enforced: true,
  };
}

/** Audit the exact Phase 12 baseline plus Scope F import manifest. */
export function auditPhase12({ root = REPO_ROOT } = {}) {
  const resolvedRoot = path.resolve(root);
  const manifestPath = path.join(resolvedRoot, PHASE12_MANIFEST);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new SemanticaError(
      'E_PHASE12_REGISTRY_UNAVAILABLE',
      `Phase 12 skill registry manifest is unavailable: ${error.code ?? error.name}`,
    );
  }
  if (!Array.isArray(manifest.imported)) {
    throw new SemanticaError('E_PHASE12_REGISTRY_UNAVAILABLE', 'Phase 12 skill registry manifest has no imported array');
  }

  const descriptors = [];
  for (const relativeDir of PHASE12_BASELINE_DIRS) {
    for (const file of walkSkillFiles(path.join(resolvedRoot, relativeDir))) {
      descriptors.push({
        id: path.basename(path.dirname(file)),
        path: path.relative(resolvedRoot, file).split(path.sep).join('/'),
        source: 'baseline',
      });
    }
  }
  const baselineCount = descriptors.length;
  for (const imported of manifest.imported) {
    descriptors.push({
      id: String(imported.id ?? path.basename(String(imported.to ?? 'unknown'))),
      path: `${String(imported.to ?? '')}/SKILL.md`,
      source: String(imported.sourceGroup ?? 'import'),
    });
  }

  descriptors.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const registryErrors = [];
  if (baselineCount !== manifest.baselineSize) {
    registryErrors.push(`baseline count ${baselineCount} does not match manifest baselineSize ${manifest.baselineSize}`);
  }
  if (manifest.imported.length !== manifest.importedCount) {
    registryErrors.push(`imported count ${manifest.imported.length} does not match manifest importedCount ${manifest.importedCount}`);
  }
  const duplicatePaths = descriptors.filter((entry, index) => index > 0 && entry.path === descriptors[index - 1].path);
  if (duplicatePaths.length) registryErrors.push(`duplicate registry paths: ${duplicatePaths.map((entry) => entry.path).join(', ')}`);

  const skills = descriptors
    .map((descriptor) => inspectSkill(resolvedRoot, descriptor))
    .map((skill) => ({ ...skill, unenforced: !skill.enforced }));
  const unenforcedSkills = skills
    .filter((skill) => skill.unenforced)
    .map(({ name, path: skillPath, reason }) => ({ name, path: skillPath, reason }));
  return {
    total: skills.length,
    declared: skills.filter((skill) => skill.declared).length,
    enforced: skills.filter((skill) => skill.enforced).length,
    unenforced: unenforcedSkills.length,
    unenforcedSkills,
    registryErrors,
    skills,
  };
}
