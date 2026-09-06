/**
 * CAPABILITY ROUTER — Ultimate Architecture Upgrade §7 + §11 (Sept 2026).
 *
 * JEXI does NOT hand the model all 515 MCP tools. Every request is routed:
 *
 *   USER REQUEST → INTENT → REQUIRED CAPABILITIES → CAPABILITY MATCHING
 *   → MINIMUM REQUIRED AGENTS/TOOLS/MCPs → EXECUTION
 *
 * The router maps intent (+ query keywords) to capability tags, and tags to
 * the MCP servers that provide them. Selected servers' tools (from the live
 * connection or the tool directory) become OpenAI function schemas named
 * mcp__<server>__<tool>; ToolRuntime dispatches those names back through the
 * MCP gateway. Sleeping servers wake on first use — routing costs no memory.
 *
 * Design rule (Lewis, standing): everything is ON by default, JEXI picks the
 * smallest useful set per request. No switches.
 */
import { loadToolDirectory, mcpServerHealth } from './MCPGateway.js';

/* ── capability tags → MCP servers (registry names) ──────────────────────── */
export const CAPABILITY_SERVERS = {
  web_search: ['duckduckgo', 'free-search'],
  encyclopedia: ['wikipedia-js', 'wikipedia-py'],
  papers: ['arxiv'],
  news: ['rss', 'hackernews'],
  docs: ['context7', 'context7-remote', 'deepwiki', 'gitmcp', 'mslearn', 'cloudflare-docs', 'x-docs', 'aws-docs'],
  math: ['sympy', 'calculator'],
  analytics: ['duckdb', 'sqlite'],
  weather: ['weather'],
  books: ['openlibrary'],
  music: ['musicbrainz'],
  economy: ['worldbank'],
  maps: ['osm'],
  files: ['filesystem', 'fs-alt'],
  git: ['git'],
  knowledge_graph: ['memory'],
  vector_store: ['chroma'],
  convert: ['markitdown', 'pandoc'],
  qr: ['qrcode'],
  diagram: ['mermaid'],
  clock: ['time'],
  fetch: ['fetch'],
  reasoning: ['sequentialthinking', 'everything'],
  // browser servers are excluded from chat routing by default — they need a
  // browser the free brain does not ship (see docs/BROWSER-PLAN.md).
  browser: ['playwright', 'playwright-ea', 'chrome-devtools'],
};

/* ── intent → capability tags (the minimum useful set) ───────────────────── */
export const INTENT_CAPABILITIES = {
  research: ['web_search', 'encyclopedia', 'papers', 'fetch'],
  learning_research: ['web_search', 'encyclopedia', 'papers'],
  news_latest: ['news', 'web_search'],
  link_analysis: ['fetch', 'web_search'],
  weather: ['weather'],
  math_solve: ['math', 'analytics'],
  study_topic: ['encyclopedia', 'papers'],
  knowledge_recall: [],
  direct_answer: [],
  conversation: [],
  memory_query: [],
  code_task: ['docs', 'files', 'git'],
  docs: ['docs'],
  content_creation: ['docs'],
  data_analysis: ['analytics', 'math'],
  translation: [],
  creative_writing: [],
  self_check: [],
  observability: [],
  plugin_task: [],
  news: ['news'],
};

/* ── query keyword boosts — the user's own words refine the intent set ───── */
const QUERY_BOOSTS = [
  [/weather|forecast|rain|temperature|humid/i, ['weather']],
  [/arxiv|paper|papers|journal|scientific stud|preprint|thesis|citation/i, ['papers']],
  [/book|books|novel|author|isbn|library|reading list/i, ['books']],
  [/song|album|artist|band|music|discography|track list/i, ['music']],
  [/gdp|inflation|economy|economic|world bank|population|country data|indicator/i, ['economy']],
  [/map|maps|location|directions|nearby|osm|openstreetmap/i, ['maps']],
  [/\bqr code\b|qrcode/i, ['qr']],
  [/convert|conversion|docx|pdf to|to pdf|to html|to markdown|word document/i, ['convert']],
  [/diagram|flow ?chart|mermaid|sequence diagram/i, ['diagram']],
  [/sqlite|sql query|database|duckdb|query.*data|csv|analytics/i, ['analytics']],
  [/hacker news|\bhn\b|show hn|tech news|startup news/i, ['news']],
  [/latest news|breaking|headlines|what.?s happening/i, ['news', 'web_search']],
  [/search (the web|online|for)|google|duckduckgo|look up online/i, ['web_search']],
  [/wikipedia|wiki/i, ['encyclopedia']],
  [/time ?zone|what time|current time in/i, ['clock']],
  [/solve|equation|integral|derivative|factor|simplify|algebra|calculus|math/i, ['math']],
  [/git (history|log|status|commit|diff|branch)|version control/i, ['git']],
];

/** Intent + query → the minimum capability set (ordered, deduped). */
export function routeCapabilities(query, plan = {}) {
  const intent = plan.intent || 'direct_answer';
  const q = String(query || '');
  // query-specific boosts FIRST — the user's own words outrank the generic intent
  const boosts = [];
  for (const [re, b] of QUERY_BOOSTS) {
    if (re.test(q)) boosts.push(...b);
  }
  const caps = [...new Set([...boosts, ...(INTENT_CAPABILITIES[intent] || [])])];
  const ordered = [...new Set(caps)];
  const servers = [];
  for (const cap of ordered) {
    for (const s of CAPABILITY_SERVERS[cap] || []) {
      if (!servers.includes(s)) servers.push(s);
    }
  }
  return {
    intent,
    capabilities: ordered,
    servers,
    reason: ordered.length
      ? `${intent} → ${ordered.join(', ')} → ${servers.length} MCP server(s)`
      : `${intent} → no MCP capability needed (native tools only)`,
  };
}

/* ── schema helpers ───────────────────────────────────────────────────────── */
/** Keep only what LLM function-calling understands; never choke a provider. */
export function sanitizeJsonSchema(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 4) return { type: 'string' };
  if (Array.isArray(schema)) return { type: 'array', items: sanitizeJsonSchema(schema[0], depth + 1) };
  const out = {};
  if (schema.type) out.type = schema.type;
  else if (schema.properties || schema.required) out.type = 'object';
  if (schema.description && typeof schema.description === 'string') out.description = schema.description.slice(0, 180);
  if (Array.isArray(schema.enum)) out.enum = schema.enum.slice(0, 24);
  if (schema.default !== undefined && ['string', 'number', 'boolean'].includes(typeof schema.default)) out.default = schema.default;
  if (schema.items) out.items = sanitizeJsonSchema(schema.items, depth + 1);
  if (schema.properties && typeof schema.properties === 'object') {
    out.properties = {};
    for (const [k, v] of Object.entries(schema.properties).slice(0, 24)) {
      out.properties[k] = sanitizeJsonSchema(v, depth + 1);
    }
  }
  if (Array.isArray(schema.required)) out.required = schema.required.slice(0, 12);
  if (!out.type) out.type = 'string';
  return out;
}

export function mcpToolFunctionName(server, tool) {
  const clean = (x) => String(x).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
  return `mcp__${clean(server)}__${clean(tool)}`;
}

const MCP_ROUTING_DISABLED_SERVERS = () =>
  process.env.JEXI_MCP_BROWSER === '1' ? [] : ['playwright', 'playwright-ea', 'chrome-devtools'];

/**
 * The minimum useful MCP toolset for a request.
 * @returns {{ schemas: object[], map: Record<string,{server,tool}>, servers: string[], capabilities: string[] }}
 */
export function selectMcpToolset(query, plan = {}, { limit = 16, perServer = 5 } = {}) {
  const routed = routeCapabilities(query, plan);
  const disabled = MCP_ROUTING_DISABLED_SERVERS();
  const wanted = routed.servers.filter((s) => !disabled.includes(s));
  if (!wanted.length) return { schemas: [], map: {}, servers: [], capabilities: routed.capabilities, reason: routed.reason };

  // live tools first (a connected server answers instantly); directory tools
  // cover sleeping servers — they wake on first call through the gateway.
  const directory = loadToolDirectory();
  const live = new Map();
  try {
    for (const h of mcpServerHealth()) {
      if (h.status === 'connected') live.set(h.name, true);
    }
  } catch { /* health is best-effort */ }

  const schemas = [];
  const map = {};
  const chosen = [];
  // round-robin queues: every routed server gets representation before any
  // server takes a second slot — a 4-capability request never starves its
  // last capability (e.g. papers must survive alongside web_search).
  const queues = [];
  for (const server of wanted) {
    const entry = directory[server];
    if (!entry || !Array.isArray(entry.tools) || !entry.tools.length) continue;
    queues.push({ server, tools: entry.tools.filter((t) => t.name).map((t) => ({ ...t })), i: 0, picked: 0 });
  }
  let progressed = true;
  while (schemas.length < limit && progressed) {
    progressed = false;
    for (const qq of queues) {
      if (schemas.length >= limit) break;
      if (qq.picked >= perServer) continue;
      if (qq.i >= qq.tools.length) continue;
      const t = qq.tools[qq.i++];
      const fname = mcpToolFunctionName(qq.server, t.name);
      if (map[fname]) { progressed = true; continue; }
      const params = sanitizeJsonSchema(t.inputSchema);
      schemas.push({
        type: 'function',
        function: {
          name: fname,
          description: `[${qq.server}] ${String(t.description || t.name).slice(0, 400)}`,
          parameters: params.type === 'object' ? params : { type: 'object', properties: {} },
        },
      });
      map[fname] = { server: qq.server, tool: t.name };
      qq.picked += 1;
      if (qq.picked === 1) chosen.push(qq.server);
      progressed = true;
    }
  }
  return { schemas, map, servers: chosen, capabilities: routed.capabilities, reason: routed.reason };
}

/** Parse an mcp__<server>__<tool> function name back to its parts. */
export function parseMcpFunctionName(name) {
  const m = /^mcp__([a-zA-Z0-9_-]+)__(.+)$/.exec(String(name || ''));
  if (!m) return null;
  // the sanitized tool name must be matched back against the directory
  return { server: m[1], toolSanitized: m[2] };
}

/** Resolve a sanitized function name to the real {server, tool} via directory. */
export function resolveMcpFunction(name) {
  const parsed = parseMcpFunctionName(name);
  if (!parsed) return null;
  const directory = loadToolDirectory();
  const entry = directory[parsed.server];
  if (!entry) return null;
  const tool = entry.tools.find((t) => mcpToolFunctionName(parsed.server, t.name) === name);
  return tool ? { server: parsed.server, tool: tool.name } : null;
}
