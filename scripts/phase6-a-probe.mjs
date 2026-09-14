/**
 * Phase 6 Scope A live probe — raw output only.
 *
 * Writes a deliberate TypeScript type error plus a small multi-file symbol
 * graph, then exercises every LSP tool through the real domain engines.
 * Prints raw JSON per tool. Run with:
 *   DOTENV_CONFIG_QUIET=true node scripts/phase6-a-probe.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'phase6-a-'));
const BROKEN = path.join(ROOT, 'broken.ts');
const DEFS = path.join(ROOT, 'defs.ts');
const USES = path.join(ROOT, 'uses.ts');

fs.writeFileSync(BROKEN, `export interface Point {
  x: number;
  y: number;
}

export function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

const label: number = "not a number";
export const total = label + 1;
`);

fs.writeFileSync(DEFS, `export const TARGET = 42;

export function scale(n: number): number {
  return n * TARGET;
}
`);

fs.writeFileSync(USES, `import { TARGET, scale } from './defs';

export const doubled = scale(TARGET);
export const again = scale(TARGET);
`);

const { registerLspTools } = await import('../server/src/tools/domains/lsp/index.js');
const { lspManager } = await import('../server/src/lsp/manager.js');
const { unreg, engines } = registerLspTools();
const out = (x) => console.log(JSON.stringify(x, null, 1));

console.log(`workspace: ${ROOT}`);

console.log('\n== mission start: index the workspace so diagnostics populate ==');
const idx = await lspManager().startMission(ROOT);
out({ root: idx.root, files: idx.files, opened: idx.opened, skipped: idx.skipped, byServer: idx.byServer });

console.log('\n== lsp_servers ==');
out(await engines.lsp_servers({}));

console.log('\n== lsp_diagnostics (deliberate type error) ==');
const d = await engines.lsp_diagnostics({ file: BROKEN, root: ROOT });
out({ ok: d.ok, available: d.available, mode: d.mode, server: d.server, count: d.count, diagnostics: d.diagnostics });

console.log('\n== lsp_definition (Point on distance signature) ==');
out(await engines.lsp_definition({ file: BROKEN, line: 6, character: 29, root: ROOT }));

console.log('\n== lsp_references (TARGET, declaration + 3 uses) ==');
const ref = await engines.lsp_references({ file: DEFS, line: 1, character: 14, root: ROOT });
out({
  ok: ref.ok, available: ref.available, server: ref.server, count: (ref.locations ?? []).length,
  locations: (ref.locations ?? []).map((l) => ({ file: path.basename(l.file), line: l.line, character: l.character })),
});

console.log('\n== lsp_hover (distance) ==');
out(await engines.lsp_hover({ file: BROKEN, line: 6, character: 17, root: ROOT }));

console.log('\n== lsp_symbols (document) ==');
const sym = await engines.lsp_symbols({ file: BROKEN, root: ROOT });
out({ ok: sym.ok, scope: sym.scope, count: (sym.symbols ?? []).length, symbols: sym.symbols });

console.log('\n== router: languages with no server installed skip gracefully ==');
for (const f of ['x.py', 'x.go', 'x.rb']) {
  const r = await engines.lsp_definition({ file: path.join(ROOT, f), line: 1, character: 1, root: ROOT });
  out({ file: f, available: r.available, note: r.note ?? r.reason ?? null });
}

unreg();
process.exit(0);
