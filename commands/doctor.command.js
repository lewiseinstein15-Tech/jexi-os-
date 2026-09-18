/**
 * JEXI OS — COMMANDS — /doctor (Phase 7 G).
 *
 * Environment + subsystem health from REAL probes — every row is an actual
 * check executed at run time (no static "all green" table):
 *   node        — runtime version ≥ 20
 *   providers   — configured + last known provider states
 *   storage     — DATA_DIR writable
 *   sqlite      — node:sqlite loads through StorageHub
 *   workgraph   — checkpoint db opens
 *   hud         — producer snapshot works
 *   observer    — bus emit + ring buffer responds
 *   learning    — store readable
 *   mcp         — registry JSON parses
 *   disk        — usable space on DATA_DIR mount
 */

import fs from 'node:fs';
import path from 'node:path';
import { serverMod, rootMod, hudSnapshot, dataDir, serverRoot, redact } from './_context.js';

export default {
  name: 'doctor',
  aliases: [],
  description: 'Environment + subsystem health (green/red per subsystem)',
  category: 'debug',
  args: [],
  async handler(args, ctx) {
    const rows = [];
    const check = async (name, fn) => {
      try {
        const r = await fn();
        rows.push({ subsystem: name, status: r?.ok ? 'green' : 'red', detail: redact(String(r?.detail || '')) });
      } catch (e) {
        rows.push({ subsystem: name, status: 'red', detail: redact(String(e.message || e).slice(0, 160)) });
      }
    };

    await check('node', () => {
      const major = Number(process.versions.node.split('.')[0]);
      return { ok: major >= 20, detail: `node ${process.versions.node} on ${process.platform}` };
    });

    await check('providers', async () => {
      const P = await serverMod('src/providers/index.js');
      const LLM = await serverMod('src/providers/runtime/LLMClient.js');
      if (!LLM?.resolveKeys) return { ok: false, detail: 'LLMClient unavailable' };
      const keys = LLM.resolveKeys();
      const configured = Object.entries(keys).filter(([, v]) => !!v).map(([k]) => k.replace(/Key$/, ''));
      let working = null;
      if (P?.canChat?.()) working = 'canChat=true';
      else working = 'canChat=false (no keyed provider satisfied capability gates)';
      return { ok: configured.length > 0, detail: `${configured.length} key(s) configured (${configured.join(', ') || 'none'}) — ${working}` };
    });

    await check('storage', async () => {
      const dir = await dataDir();
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, `.doctor-probe-${Date.now()}`);
      fs.writeFileSync(probe, 'ok');
      const size = fs.statSync(probe).size;
      fs.unlinkSync(probe);
      return { ok: size === 2, detail: `${dir} writable` };
    });

    await check('sqlite', async () => {
      const hub = await serverMod('src/services/StorageHub.js');
      if (!hub?.loadSqliteModule) return { ok: false, detail: 'StorageHub unavailable' };
      const sqlite = await hub.loadSqliteModule();
      return { ok: !!sqlite, detail: sqlite ? 'node:sqlite loads' : 'node:sqlite unavailable' };
    });

    await check('workgraph', async () => {
      const cp = await serverMod('src/workgraph/state/checkpoint.js');
      if (!cp?.openWorkGraphDb) return { ok: false, detail: 'checkpoint module unavailable' };
      const file = path.join(await dataDir(), 'workgraph', 'doctor-probe.sqlite');
      const db = await cp.openWorkGraphDb(file);
      db.prepare('SELECT 1').get();
      return { ok: true, detail: `checkpoint db opens (${path.basename(file)})` };
    });

    await check('hud', async () => {
      const snap = await hudSnapshot();
      return { ok: !!snap, detail: snap ? `producer responding (revision ${snap.revision ?? '?'})` : 'producer snapshot unavailable' };
    });

    await check('observer', async () => {
      const bus = await serverMod('src/services/Observer.js');
      if (!bus?.emit) return { ok: false, detail: 'bus unavailable' };
      const evt = bus.emit('doctor.probe', { summary: 'doctor probe', data: { at: Date.now() } });
      return { ok: !!evt, detail: evt ? `emit ok (id ${evt.id})` : 'emit rejected' };
    });

    await check('learning', async () => {
      const store = await rootMod('learning/store.js');
      if (!store?.projectStorePath) return { ok: false, detail: 'learning/ not present in this runtime' };
      const root = serverRoot() || process.cwd();
      const file = store.projectStorePath(root);
      const n = fs.existsSync(file) ? store.readRecords(file).length : 0;
      return { ok: true, detail: `store readable (${n} record(s))` };
    });

    await check('mcp', async () => {
      const root = serverRoot();
      const candidates = [path.join(root || '.', 'mcp', 'registry.json'), path.join((await dataDir()), '..', 'mcp', 'registry.json')];
      for (const c of candidates) {
        try {
          const j = JSON.parse(fs.readFileSync(c, 'utf8'));
          const n = Object.keys(j.servers || j).length;
          return { ok: n >= 0, detail: `registry parses (${n} server(s)) at ${path.basename(path.dirname(c))}/` };
        } catch { /* next candidate */ }
      }
      return { ok: false, detail: 'mcp/registry.json not found or unparseable' };
    });

    await check('disk', async () => {
      const dir = await dataDir();
      const st = fs.statfsSync ? fs.statfsSync(dir) : null;
      if (!st) return { ok: true, detail: 'statfs unavailable — skipped' };
      const freeGb = (st.bavail * st.bsize) / 1e9;
      return { ok: freeGb > 0.2, detail: `${freeGb.toFixed(2)} GB free on ${dir}` };
    });

    const green = rows.filter((r) => r.status === 'green').length;
    const red = rows.filter((r) => r.status === 'red').length;

    for (const r of rows) ctx.log(`${r.status === 'green' ? '✓' : '✗'} ${r.subsystem}: ${r.detail}`);

    return {
      ok: red === 0,
      summary: `doctor: ${green}/${rows.length} green${red ? `, ${red} red (${rows.filter((r) => r.status === 'red').map((r) => r.subsystem).join(', ')})` : ' — all subsystems healthy'}`,
      checks: rows,
      green,
      red,
    };
  },
};
