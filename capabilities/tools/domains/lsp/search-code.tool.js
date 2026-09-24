// CBM tool — search-code: grep-like text search within indexed project files
// (the 15th CBM tool — present upstream, absent from the block's list).
import { defineTool } from '../../../server/src/tools/interface/ToolDefinition.js';
import { repoRoot, walkSourceFiles, readSource, ToolInputError } from './_graph.js';

export const def = defineTool({
  name: 'search-code',
  description: 'Grep-like literal/regex text search across the repository source files, returning file:line matches with snippets.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Text or regex to find.' },
      regex: { type: 'boolean', description: 'Treat query as a regex (default false = literal).' },
      maxResults: { type: 'number', minimum: 1, maximum: 200 },
      root: { type: 'string' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  returns: { type: 'object', description: '{ ok, query, filesScanned, matches: [{ file, line, snippet }], truncated }' },
  riskLevel: 'low',
  runtimeRing: 2,
  sideEffects: [],
  idempotent: true,
  failureTypes: ['tool_error'],
});

const MAX_RESULTS_DEFAULT = 40;

export async function handler(args = {}) {
  const query = String(args.query ?? '');
  if (!query) throw new ToolInputError('QUERY_REQUIRED', 'query is required');
  let re;
  if (args.regex) {
    try {
      re = new RegExp(query, 'i');
    } catch (err) {
      throw new ToolInputError('INVALID_REGEX', `query is not a valid regex: ${err.message}`);
    }
  } else {
    re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
  const root = repoRoot(args.root);
  const files = walkSourceFiles(root);
  const max = Math.min(args.maxResults || MAX_RESULTS_DEFAULT, 200);
  const matches = [];
  let truncated = false;
  for (const rel of files) {
    if (matches.length >= max) { truncated = true; break; }
    const src = readSource(root, rel);
    if (!src || !re.test(src)) continue;
    const lines = src.split('\n');
    for (let i = 0; i < lines.length && matches.length < max; i++) {
      if (re.test(lines[i])) {
        matches.push({ file: rel, line: i + 1, snippet: lines[i].trim().slice(0, 200) });
        if (matches.length >= max) truncated = matches.length < countTotal(re, lines) || false;
      }
    }
  }
  return { ok: true, query, filesScanned: files.length, matches, truncated };
}

function countTotal(re, lines) {
  let n = 0;
  for (const l of lines) if (re.test(l)) n++;
  return n;
}
