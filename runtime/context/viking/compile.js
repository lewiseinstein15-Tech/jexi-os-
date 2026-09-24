/**
 * JEXI OS — Phase 17 Scope E — CONTEXT FILESYSTEM / COMPILE.
 *
 * compile.run({ source, target, dest, fs }) — organize raw source material
 * into three durable artifacts:
 *
 *   wiki             structured markdown (title, TOC, sections)
 *   knowledge-graph  entities + relations (reuses the Scope D LABELED
 *                    rule-based extractor from memory/knowledge-graph.js —
 *                    no LLM key, none used)
 *   report           narrative summary (stats + section openers,
 *                    deterministic — labeled)
 *
 * `source` is either a viking:// URI (read at L2 through the fs) or a plain
 * string. With `dest` (a viking:// directory) the three artifacts are written
 * back through the filesystem with auto sidecars. All organizers are
 * deterministic transformations labeled where they stand in for LLM work.
 */

import { buildGraph, createRuleExtractor } from '../../../mind/memory/knowledge-graph.js';
import { firstSentence } from './filesystem.js';

export const COMPILE_LABEL = 'viking compile (deterministic organizers) — LLM summarization NOT VERIFIED';

function splitSections(text, title) {
  const t = String(text || '').replace(/\r\n/g, '\n').trim();
  const out = [];
  const lines = t.split('\n');
  let current = { title: title || 'Overview', body: [] };
  let sawHeading = false;
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      if (current.body.length || sawHeading) out.push(current);
      current = { title: h[2].trim(), body: [] };
      sawHeading = true;
    } else {
      current.body.push(line);
    }
  }
  out.push(current);
  return out
    .map((s) => ({ title: s.title, body: s.body.join('\n').trim() }))
    .filter((s) => s.body.length > 0 || out.length === 1);
}

/** Structured wiki markdown: title, provenance note, TOC, sections. */
export function compileWiki(text, { title = 'Compiled Document' } = {}) {
  const sections = splitSections(text, title);
  const toc = sections.map((s, i) => `${i + 1}. ${s.title}`).join('\n');
  const body = sections.map((s) => `## ${s.title}\n\n${s.body}`).join('\n\n');
  return [`# ${title}`, '', `> Organized by ${COMPILE_LABEL}.`, '', '## Contents', toc, '', body].join('\n');
}

/** Knowledge-graph export: entities + relations from the labeled extractor. */
export function compileKnowledgeGraph(text) {
  const entries = [{ id: 'compile-source', missionId: 'compile', tier: 'semantic', content: String(text || ''), createdAt: 0, metadata: {} }];
  const graph = buildGraph(entries, { extractor: createRuleExtractor() });
  return {
    extractor: graph.extractor,
    entities: [...graph.entities.values()].map((e) => ({ name: e.name, type: e.type, entryIds: [...e.entryIds] })),
    relations: graph.relations.map((r) => ({ type: r.type, from: r.from, to: r.to })),
  };
}

/** Narrative report: stats + one opener sentence per section. Deterministic. */
export function compileReport(text, { title = 'Compiled Document' } = {}) {
  const sections = splitSections(text, title);
  const words = String(text || '').split(/\s+/).filter(Boolean).length;
  const openers = sections.map((s) => firstSentence(s.body)).filter(Boolean);
  const lines = [
    `# Report: ${title}`,
    '',
    `> ${COMPILE_LABEL}.`,
    '',
    `Source: ${words} words in ${sections.length} section${sections.length === 1 ? '' : 's'}.`,
    '',
    'Summary of findings:',
    ...openers.map((o) => `- ${o}`),
  ];
  return lines.join('\n');
}

/**
 * @param {object} o
 * @param {string|{text, title}} o.source   viking:// URI or {text, title}
 * @param {'wiki'|'knowledge-graph'|'report'|'all'} [o.target='all']
 * @param {import('./filesystem.js').VikingFs} [o.fs]      required when source is a URI or dest is given
 * @param {string} [o.dest]       viking:// directory to persist artifacts into
 * @returns {{ artifacts: {wiki?, knowledgeGraph?, report?}, uris: object|null, label: string }}
 */
export function run({ source, target = 'all', fs = null, dest = null }) {
  let text, title, uris = null;
  if (typeof source === 'string' && source.startsWith('viking://')) {
    if (!fs) throw Object.assign(new Error('compile.run: a viking fs is required when source is a URI'), { code: 'E_FS_REQUIRED' });
    const r = fs.read(source, { tier: 'L2' });
    text = r.content;
    title = source.split('/').pop() || 'Compiled Document';
  } else if (source && typeof source === 'object') {
    text = String(source.text || '');
    title = source.title || 'Compiled Document';
  } else {
    text = String(source ?? '');
    title = 'Compiled Document';
  }
  if (!text.trim()) throw Object.assign(new Error('compile.run: empty source'), { code: 'E_EMPTY_SOURCE' });

  const want = target === 'all' ? ['wiki', 'knowledge-graph', 'report'] : [target];
  const artifacts = {};
  for (const t of want) {
    if (t === 'wiki') artifacts.wiki = compileWiki(text, { title });
    else if (t === 'knowledge-graph') artifacts.knowledgeGraph = compileKnowledgeGraph(text);
    else if (t === 'report') artifacts.report = compileReport(text, { title });
    else throw Object.assign(new Error(`compile.run: unknown target ${t}`), { code: 'E_INVALID_TARGET' });
  }

  if (dest) {
    if (!fs) throw Object.assign(new Error('compile.run: a viking fs is required when dest is given'), { code: 'E_FS_REQUIRED' });
    uris = {};
    if (artifacts.wiki != null) uris.wiki = `${dest.replace(/\/$/, '')}/wiki.md`;
    if (artifacts.knowledgeGraph != null) uris.knowledgeGraph = `${dest.replace(/\/$/, '')}/knowledge-graph.json`;
    if (artifacts.report != null) uris.report = `${dest.replace(/\/$/, '')}/report.md`;
    if (uris.wiki) fs.write(uris.wiki, artifacts.wiki, { l0: `Wiki organization of "${title}".` });
    if (uris.knowledgeGraph) fs.write(uris.knowledgeGraph, JSON.stringify(artifacts.knowledgeGraph, null, 2), { l0: `Knowledge graph of "${title}" (${artifacts.knowledgeGraph.entities.length} entities, ${artifacts.knowledgeGraph.relations.length} relations).` });
    if (uris.report) fs.write(uris.report, artifacts.report, { l0: firstSentence(artifacts.report.split('\n')[4] || `Report on ${title}.`) });
  }

  return { artifacts, uris, label: COMPILE_LABEL };
}

export default { run, compileWiki, compileKnowledgeGraph, compileReport, COMPILE_LABEL };
