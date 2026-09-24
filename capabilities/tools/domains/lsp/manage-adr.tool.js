// CBM tool — manage-adr: CRUD for Architecture Decision Records in graph meta.
import { defineTool } from '../../../server/src/tools/interface/ToolDefinition.js';
import { getStore, ToolInputError } from './_graph.js';

export const def = defineTool({
  name: 'manage-adr',
  description: 'Create, read, and section-edit Architecture Decision Records persisted alongside the graph (modes: create/get/set_sections/sections/list).',
  parameters: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['create', 'get', 'set_sections', 'sections', 'list'] },
      project: { type: 'string' },
      id: { type: 'string', description: 'ADR id (get/set_sections/sections); auto-assigned on create.' },
      title: { type: 'string', description: 'Title (create).' },
      body: { type: 'string', description: 'Full document body (create).' },
      sections: { type: 'object', description: '{ "## Heading": "replacement text" } (set_sections) — other bytes preserved.' },
    },
    required: ['mode'],
    additionalProperties: false,
  },
  returns: { type: 'object', description: 'mode-dependent: { ok, id, document? | headings? | adrs? }' },
  riskLevel: 'medium',
  runtimeRing: 2,
  sideEffects: ['graph-db'],
  idempotent: false,
  failureTypes: ['tool_error'],
});

const adrKey = (project, id) => `adr:${project}:${id}`;

export async function handler(args = {}) {
  const project = String(args.project || 'jexi-os');
  const store = await getStore();
  const mode = args.mode;

  if (mode === 'create') {
    const title = String(args.title || '').trim();
    if (!title) throw new ToolInputError('TITLE_REQUIRED', 'create requires a title');
    const body = String(args.body || '');
    const existing = store.listProjects ? listAdrIds(store, project) : [];
    const id = `adr-${String(existing.length + 1).padStart(4, '0')}`;
    const doc = { id, title, body, createdAt: new Date().toISOString(), updatedAt: null };
    store.setMeta(adrKey(project, id), JSON.stringify(doc));
    store.flush();
    return { ok: true, id, title, document: doc };
  }

  if (mode === 'list') {
    const ids = listAdrIds(store, project);
    return { ok: true, project, adrs: ids.map((id) => {
      const d = JSON.parse(store.getMeta(adrKey(project, id)));
      return { id, title: d.title, createdAt: d.createdAt };
    }) };
  }

  const id = String(args.id || '');
  if (!id) throw new ToolInputError('ID_REQUIRED', `mode "${mode}" requires id`);
  const raw = store.getMeta(adrKey(project, id));
  if (!raw) throw new ToolInputError('ADR_NOT_FOUND', `no ADR "${id}" in project "${project}" (have: ${listAdrIds(store, project).join(', ') || 'none'})`);
  const doc = JSON.parse(raw);

  if (mode === 'get') return { ok: true, id, document: doc };

  if (mode === 'sections') {
    const headings = [...doc.body.matchAll(/^## +(.+)$/gm)].map((m) => m[1]);
    return { ok: true, id, headings };
  }

  if (mode === 'set_sections') {
    const sections = args.sections || {};
    if (!sections || typeof sections !== 'object' || Object.keys(sections).length === 0) {
      throw new ToolInputError('SECTIONS_REQUIRED', 'set_sections requires sections: { "## Heading": "text" }');
    }
    let body = doc.body;
    for (const [heading, text] of Object.entries(sections)) {
      body = spliceSection(body, heading, String(text));
    }
    doc.body = body;
    doc.updatedAt = new Date().toISOString();
    store.setMeta(adrKey(project, id), JSON.stringify(doc));
    store.flush();
    return { ok: true, id, document: doc };
  }

  throw new ToolInputError('UNKNOWN_MODE', `unknown mode "${mode}"`);
}

function listAdrIds(store, project) {
  const out = [];
  if (store.data && store.data.meta) {
    for (const k of Object.keys(store.data.meta)) {
      const m = k.startsWith(`adr:${project}:`) && k.slice(`adr:${project}:`.length);
      if (m) out.push(m);
    }
    return out.sort();
  }
  const count = Number(store.getMeta(`adr:${project}:count`) || 0);
  for (let i = 1; i <= count; i++) out.push(`adr-${String(i).padStart(4, '0')}`);
  return out;
}

/** Replace the text under one `## Heading`, preserving every other byte. */
function spliceSection(body, heading, text) {
  const lines = body.split('\n');
  const target = heading.replace(/^#+\s*/, '').trim();
  const hRe = new RegExp(`^##\\s+${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  const idx = lines.findIndex((l) => hRe.test(l.trim()));
  if (idx === -1) {
    return `${body}\n\n## ${target}\n${text}`.trim();
  }
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  return [...lines.slice(0, idx + 1), text, ...lines.slice(end)].join('\n');
}
