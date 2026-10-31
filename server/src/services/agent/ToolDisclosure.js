/**
 * JEXI OS — AGENT — ToolDisclosure.
 *
 * Progressive tool disclosure: a small initial menu plus a controlled way to
 * grow it, WITHOUT a second registry and WITHOUT ever bypassing a gate.
 *
 * The M11 result and the M12 recon point at the same defect: a coding turn was
 * offered 41 tools, so a small model ignored them all and answered in prose
 * (the file was never written). This module decides the initial menu.
 *
 * Two hard rules, both from the mission:
 *
 *   1. DISCOVERY NEVER EXPANDS AUTHORITY. Every slug a bundle names is
 *      resolved through the live registries (`resolveToolDef`) and must have a
 *      real engine. An unknown or unregistered slug is DROPPED. Expanding the
 *      menu adds reachable tools; it does not add permission — every call
 *      still passes the permission profile, RiskGuard and approval gates in
 *      `executeTool`, unchanged.
 *
 *   2. NO SECOND REGISTRY. Bundles reference existing slugs. This module
 *      resolves and filters them; it never declares a tool of its own.
 *
 * The initial menu is deliberately SMALL. `request_tools` is the escape hatch
 * that restores access to the full authorized capability set on demand, so
 * narrowing the initial menu costs nothing but a round-trip.
 */
import { resolveToolDef, toolHasEngine, buildNativeSchemas } from '../ToolRuntime.js';
import { TOOL_REGISTRY } from '../ToolRegistry.js';
import {
  TOOL_BUNDLES, DISCOVERABLE_BUNDLES,
  initialBundlesForIntent, getBundle,
} from './ToolBundles.js';

/**
 * Every slug that currently resolves to a real, engine-backed tool. Built from
 * the live registries the way ToolSetBuilder resolves them, so bundle prefix
 * matching never invents a tool that does not exist.
 *
 * `resolveToolDef` consults the legacy registry, the domain registry and
 * plugins; `toolHasEngine` proves it can actually run. This is the universe
 * prefix expansion is allowed to draw from.
 */
function slugUniverse(extraSlugs = []) {
  const universe = new Set(extraSlugs.filter(Boolean).map((s) => String(s)));
  for (const t of TOOL_REGISTRY) universe.add(t.slug);
  return [...universe];
}

/** Resolve a bundle's declared members against the live registry. */
function bundleMembers(bundle, universe, tier) {
  if (!bundle) return [];
  const out = new Set();
  const declared = tier === 'core' ? (bundle.core || []) : (bundle.slugs || []);
  for (const s of declared) {
    if (resolveToolDef(s) && toolHasEngine(s)) out.add(s);
  }
  if (tier !== 'core') {
    for (const p of bundle.prefixes || []) {
      for (const s of universe) {
        if ((s === p || s.startsWith(p)) && resolveToolDef(s) && toolHasEngine(s)) out.add(s);
      }
    }
  }
  return [...out];
}

/** The CORE slugs a set of bundle ids discloses (the initial menu members). */
export function coreSlugsForBundles(ids, universe = []) {
  const out = new Set();
  for (const id of ids) {
    for (const s of bundleMembers(getBundle(id), universe, 'core')) out.add(s);
  }
  return [...out];
}

/** The FULL membership of a set of bundle ids (for on-demand expansion). */
export function fullSlugsForBundles(ids, universe = []) {
  const out = new Set();
  for (const id of ids) {
    for (const s of bundleMembers(getBundle(id), universe, 'full')) out.add(s);
  }
  return [...out];
}

/**
 * Compute the initial disclosure for a turn.
 *
 * The initial menu is: the CORE members of the intent's bundles, plus any tool
 * the request EXPLICITLY required (from its own words), plus the caller's
 * control-plane subset. The plan's full tool list is deliberately NOT added
 * wholesale — that list is the 25-tool union that caused the M11 failure; the
 * plan's genuinely-needed tools are the ones the bundles and the explicit
 * requirements name. Anything else stays reachable via `request_tools`.
 *
 * @param {object} o
 * @param {string} o.intent            the classified intent
 * @param {string[]} [o.knownSlugs]    every slug that resolves in this process
 * @param {string[]} [o.requiredSlugs] slugs inferred as REQUIRED by the request
 * @param {string[]} [o.controlSlugs]  control-plane slugs to always keep
 * @returns {{ bundles: string[], slugs: string[], availableBundles: string[] }}
 */
export function initialDisclosure({ intent, knownSlugs = [], requiredSlugs = [], controlSlugs = [] } = {}) {
  const bundles = initialBundlesForIntent(intent);
  const universe = slugUniverse(knownSlugs);
  const core = coreSlugsForBundles(bundles, universe);

  const slugs = new Set([...core, ...requiredSlugs, ...controlSlugs]);

  return {
    bundles,
    slugs: [...slugs],
    availableBundles: discoverableBundleIds(bundles),
  };
}

/**
 * The bundle ids a request could still pull in — everything discoverable that
 * is not already disclosed. Used to describe `request_tools` to the model.
 */
export function discoverableBundleIds(alreadyDisclosed = []) {
  const have = new Set(alreadyDisclosed);
  return DISCOVERABLE_BUNDLES.filter((b) => !have.has(b));
}

/**
 * Resolve a `request_tools` call into concrete schemas.
 *
 * Accepts bundle ids ("web", "browser") and/or explicit tool slugs. Returns
 * the NEW schemas plus the slugs that could not be satisfied (so the model is
 * told honestly what it cannot have, rather than silently getting nothing).
 *
 * @returns {{ schemas: object[], slugs: string[], unknown: string[], bundles: string[] }}
 */
export function resolveDisclosureRequest({ requested = [], alreadyOffered = [], knownSlugs = [] } = {}) {
  const offered = new Set(alreadyOffered);
  const wantedBundles = [];
  const wantedSlugs = [];

  for (const raw of requested) {
    const token = String(raw || '').trim();
    if (!token) continue;
    if (TOOL_BUNDLES[token]) wantedBundles.push(token);
    else wantedSlugs.push(token);
  }

  const universe = slugUniverse(knownSlugs);
  const newSlugs = new Set();
  for (const s of fullSlugsForBundles(wantedBundles, universe)) {
    if (!offered.has(s)) newSlugs.add(s);
  }
  const unknown = [];
  for (const s of wantedSlugs) {
    if (offered.has(s)) continue;                       // already there — fine
    if (resolveToolDef(s) && toolHasEngine(s)) newSlugs.add(s);
    else unknown.push(s);
  }

  const slugs = [...newSlugs];
  const defs = slugs.map((s) => resolveToolDef(s)).filter(Boolean);
  const schemas = buildNativeSchemas(defs);
  return { schemas, slugs, unknown, bundles: wantedBundles };
}

/**
 * The compact description of the expansion tool, for the prompt. Kept short on
 * purpose: the whole point is to not drown a small model in tool text.
 */
export function disclosureMenuText(availableBundles = []) {
  if (!availableBundles.length) return '';
  return availableBundles
    .map((id) => {
      const b = getBundle(id);
      return b ? `${b.id} (${b.title}: ${b.description})` : null;
    })
    .filter(Boolean)
    .join('; ');
}

/** The OpenAI-shaped schema for the `request_tools` meta-tool. */
export function buildRequestToolsSchema(availableBundles = []) {
  return {
    type: 'function',
    function: {
      name: 'request_tools',
      description:
        'Load additional capabilities for this task. Call it when the tools you need are not in '
        + 'your current menu. Pass the bundle ids (or exact tool names) you need. This only adds '
        + 'reachable tools to your menu — it does not grant permission, and every call is still '
        + `checked against the active permission profile. Available bundles: ${availableBundles.join(', ')}.`,
      parameters: {
        type: 'object',
        properties: {
          bundles: {
            type: 'array',
            items: { type: 'string' },
            description: `Bundle ids to load, e.g. ["web","browser"]. One of: ${availableBundles.join(', ')}.`,
          },
          tools: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional exact tool names to load if you know them.',
          },
        },
        required: [],
      },
    },
  };
}

/** Is this call the expansion meta-tool? */
export function isDisclosureCall(name) {
  return String(name || '') === 'request_tools';
}
