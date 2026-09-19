// CBM tool — detect-changes: map a git diff to affected symbols + blast radius.
import { execFileSync } from 'node:child_process';
import { defineTool } from '../../../server/src/tools/interface/ToolDefinition.js';
import { repoRoot, getStore, ToolInputError } from './_graph.js';

export const def = defineTool({
  name: 'detect-changes',
  description: 'Map a git diff (ref vs worktree or ref range) to affected graph symbols with fan-in/fan-out blast radius and risk class.',
  parameters: {
    type: 'object',
    properties: {
      ref: { type: 'string', description: "Git ref to diff against (default 'HEAD')." },
      project: { type: 'string' },
      root: { type: 'string' },
    },
    required: [],
    additionalProperties: false,
  },
  returns: { type: 'object', description: '{ ok, ref, files, affectedSymbols, blastRadius, risk }' },
  riskLevel: 'low',
  runtimeRing: 2,
  sideEffects: [],
  idempotent: true,
  failureTypes: ['tool_error'],
});

export async function handler(args = {}) {
  const root = repoRoot(args.root);
  const ref = String(args.ref || 'HEAD');
  // Validate the ref BEFORE running the diff (specific error, not git noise).
  try {
    execFileSync('git', ['-C', root, 'rev-parse', '--verify', ref], { stdio: 'pipe' });
  } catch {
    throw new ToolInputError('BAD_REF', `git ref "${ref}" does not resolve in this repository`);
  }
  let diff;
  try {
    diff = execFileSync('git', ['-C', root, 'diff', '--unified=0', ref], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (err) {
    throw new ToolInputError('DIFF_FAILED', `git diff failed: ${err.message}`);
  }
  const files = [];
  let cur = null;
  for (const line of diff.split('\n')) {
    const hf = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (hf) { cur = { file: hf[2], addedLines: [], removedLines: [] }; files.push(cur); continue; }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (cur && hunk) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let i = 0; i < count; i++) cur.addedLines.push(start + i);
    }
  }

  const project = String(args.project || 'jexi-os');
  const store = await getStore();
  const nodes = store.nodes(project);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outDeg = new Map();
  const inDeg = new Map();
  const cross = new Map();
  for (const e of store.edges(project)) {
    if (e.type === 'CALLS') {
      outDeg.set(e.src, (outDeg.get(e.src) || 0) + 1);
      inDeg.set(e.dst, (inDeg.get(e.dst) || 0) + 1);
    }
    if (e.type === 'CROSS_SERVICE') cross.set(e.src, (cross.get(e.src) || 0) + 1);
  }

  const affectedSymbols = [];
  for (const f of files) {
    const syms = nodes.filter((n) => n.file === f.file && (n.label === 'Function' || n.label === 'Class') && f.addedLines.some((l) => l >= (n.line || 0) && l <= (n.endLine || n.line || 0)));
    for (const s of syms) {
      affectedSymbols.push({
        symbol: s.qualname,
        label: s.label,
        fanIn: inDeg.get(s.id) || 0,
        fanOut: outDeg.get(s.id) || 0,
        crossService: cross.get(s.id) || 0,
      });
    }
  }

  const maxFanIn = affectedSymbols.reduce((m, s) => Math.max(m, s.fanIn), 0);
  const anyCross = affectedSymbols.some((s) => s.crossService > 0);
  const risk = affectedSymbols.length === 0 ? 'none' : anyCross || maxFanIn >= 5 ? 'high' : maxFanIn >= 2 ? 'medium' : 'low';

  return {
    ok: true,
    ref,
    filesChanged: files.length,
    files: files.map((f) => ({ file: f.file, addedLines: f.addedLines.length })),
    affectedSymbols: affectedSymbols.slice(0, 25),
    affectedCount: affectedSymbols.length,
    blastRadius: { totalFanIn: affectedSymbols.reduce((a, s) => a + s.fanIn, 0), totalFanOut: affectedSymbols.reduce((a, s) => a + s.fanOut, 0), maxFanIn, crossServiceTouched: anyCross },
    risk,
  };
}
