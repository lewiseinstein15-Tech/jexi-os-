/**
 * JEXI OS — tools/registry/governance.js (Phase 9 C — Enumerable Tool Surface)
 *
 * ONE source of truth for "what tools exist". This module is a READ-ONLY
 * governance view over the REAL runtime registry at
 * server/src/tools/registry/ToolRegistry.js — it never shadows or forks it.
 *
 * Layering (who owns what):
 *   1. server/src/services/ToolRegistry.js   — the legacy ENGINE CATALOG
 *      (TOOL_REGISTRY array). It is the SEED of the registry, not a second
 *      registry. governance only joins it to recover two presentation
 *      fields the runtime normalization drops (human `name`, `type`→domain).
 *   2. server/src/tools/registry/ToolRegistry.js — the REAL runtime
 *      registry (Map of ToolDefinitions). listAllTools()/countTools()/
 *      getToolSchema() read EVERYTHING else straight from it: existence,
 *      slug, risk, description, schema, permissions, timeout, engine.
 *
 * Therefore: register a new tool into the runtime registry and governance
 * immediately reflects it — nothing here is hardcoded.
 *
 * Drift checking: checkDrift() compares the registry's real count against
 * numeric tool-count claims in the designated living docs
 * (ARCHITECTURE.md, README.md, docs/REBUILD-MAP.md, docs/AUTONOMY_AUDIT.md,
 * docs/UPGRADE-FINAL-REPORT.md). Historical fixlogs are deliberately not
 * scanned (frozen records, like changelogs). Lines that count a DIFFERENT
 * surface (external MCP connectors: "N connected services", standalone
 * "MCP") are skipped so the audit never false-positives on them.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  listTools,
  getTool as registryGetTool,
  initFromEngineCatalog,
} from '../../server/src/tools/registry/ToolRegistry.js';
import { TOOL_REGISTRY as ENGINE_CATALOG } from '../../server/src/services/ToolRegistry.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The registry is seeded from the engine catalog exactly once per process,
 * and only if the host has not already populated it (overlay semantics: if
 * a host registered tools, governance observes what the host built).
 * This is the FIRST production caller of initFromEngineCatalog().
 */
let seeded = false;
function ensureRegistry() {
  if (seeded) return;
  if (listTools().length === 0) initFromEngineCatalog(ENGINE_CATALOG);
  seeded = true;
}

/** Presentation-only join: legacy catalog is the registry's own seed, not a parallel list. */
const legacyBySlug = () => new Map(ENGINE_CATALOG.map((t) => [t.slug, t]));

/**
 * Complete, authoritative tool list — read from the REAL runtime registry.
 * Contract per tool: { slug, name, domain, risk, description }.
 *   slug/risk/description come from the runtime registry;
 *   `name` (human label) and `domain` are joined from the seed catalog,
 *   falling back to the slug / 'uncategorized' for runtime-only tools.
 */
export function listAllTools() {
  ensureRegistry();
  const legacy = legacyBySlug();
  return listTools().map((def) => ({
    slug: def.name,
    name: legacy.get(def.name)?.name ?? def.name,
    domain: legacy.get(def.name)?.type ?? 'uncategorized',
    risk: def.riskLevel,
    description: def.description,
  }));
}

/** { total, byDomain, byRisk } — keys sorted for stable, diffable output. */
export function countTools() {
  const all = listAllTools();
  const byDomain = {};
  const byRisk = {};
  for (const t of all) {
    byDomain[t.domain] = (byDomain[t.domain] ?? 0) + 1;
    byRisk[t.risk] = (byRisk[t.risk] ?? 0) + 1;
  }
  const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  return { total: all.length, byDomain: sorted(byDomain), byRisk: sorted(byRisk) };
}

/**
 * Real schema for one tool, straight from the runtime registry.
 * Returns null for an unknown slug. `parameters` is the tool's actual
 * JSON Schema; the rest is the tool's real contract metadata.
 */
export function getToolSchema(slug) {
  ensureRegistry();
  const def = registryGetTool(slug);
  if (!def) return null;
  const legacy = legacyBySlug().get(slug);
  return {
    slug: def.name,
    name: legacy?.name ?? def.name,
    domain: legacy?.type ?? 'uncategorized',
    risk: def.riskLevel,
    parameters: def.parameters,
    permissions: def.permissions,
    timeout: def.timeout,
    idempotent: def.idempotent,
    engine: def.engine,
    agents: def.agents,
  };
}

// ── Drift: docs vs reality ────────────────────────────────────────────────

/** Living docs scanned by checkDrift(). Extend as new claimant docs appear. */
export const DOC_SOURCES = [
  'ARCHITECTURE.md',
  'README.md',
  'docs/REBUILD-MAP.md',
  'docs/AUTONOMY_AUDIT.md',
  'docs/UPGRADE-FINAL-REPORT.md',
];

/** "218 tools", "~151 tools", "12 built-in tools" — first match per line. */
const CLAIM_RE = /(~?)(\d{1,4})\s+(?:built-in\s+)?tools\b/i;
/** Skip lines that count an EXTERNAL surface (MCP connectors), not the registry. */
const EXTERNAL_CONTEXT_RE = /\bMCP\b|connected services/i;
/** Approximate claims ("~151") get ±15% slop; exact claims must match exactly. */
const APPROX_SLOP = 0.15;

/**
 * Compare doc claims to the real registry count.
 * Returns { real, claimed, claims[], drift[], ok, scanned }.
 *   claimed = the first exact (non-approximate) claim in DOC_SOURCES order,
 *   or null when no doc claims a number.
 *   ok = drift.length === 0.
 */
export function checkDrift() {
  ensureRegistry();
  const real = listTools().length;
  const claims = [];
  const drift = [];

  for (const rel of DOC_SOURCES) {
    const abs = path.join(REPO_ROOT, rel);
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      claims.push({ doc: rel, line: null, claimed: null, note: 'doc missing (unreadable)' });
      continue;
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (EXTERNAL_CONTEXT_RE.test(line)) continue;
      const m = line.match(CLAIM_RE);
      if (!m) continue;
      const approx = m[1] === '~';
      const claimed = parseInt(m[2], 10);
      const delta = claimed - real;
      const drifted = approx
        ? Math.abs(delta) / real > APPROX_SLOP
        : delta !== 0;
      claims.push({ doc: rel, line: i + 1, claimed, approx, matches: !drifted });
      if (drifted) {
        drift.push({
          doc: rel,
          line: i + 1,
          claimed,
          real,
          approx,
          message: `${rel}:${i + 1} claims ${approx ? '~' : ''}${claimed} tools; the real registry has ${real} (Δ ${delta > 0 ? '+' : ''}${delta})`,
        });
      }
    }
  }

  const firstExact = claims.find((c) => typeof c.claimed === 'number' && !c.approx);
  return {
    real,
    claimed: firstExact?.claimed ?? null,
    claims,
    drift,
    ok: drift.length === 0,
    scanned: DOC_SOURCES.length,
  };
}
