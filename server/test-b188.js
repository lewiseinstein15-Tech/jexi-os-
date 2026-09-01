/** B188 — the separate build workspace (GitHub Pages home) tests. */
import fs from 'fs';
let failures = 0;
const ok = (name, cond) => { console.log(`${cond ? '✅' : '❌'} ${name}`); if (!cond) failures += 1; };

console.log('\n== 1. publisher module ==');
const WP = await import('./src/services/WorkspacePublisher.js');
ok('workspace home is the SEPARATE pages site', WP.workspaceHome().includes('jexi-workspace'));

console.log('\n== 2. LIVE publish → public URL → listed → cleared (real repo, real Pages) ==');
if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
  console.log('⏭ live publish tests SKIPPED (no GITHUB_TOKEN on this host — the brain has one; CI/local stay green)');
} else {
{
  const pub = await WP.publishProject({
    name: 'b188-selftest',
    title: 'B188 Selftest App',
    brief: 'verifies the workspace end-to-end',
    icon: '🧪',
    files: [
      { name: 'index.html', code: '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Selftest</title></head><body style="background:#0a0e17;color:#00ff9d;font-family:monospace;padding:40px"><h1>B188 WORKSPACE SELFTEST OK</h1></body></html>' },
      { name: 'README.md', code: '# selftest' },
    ],
    entry: 'index.html',
  });
  ok('published ok', pub.ok);
  ok(`public URL returned (${pub.url})`, pub.ok && pub.url.includes('jexi-workspace/b188-selftest/index.html'));

  // wait for Pages to build, then verify it LOADS
  await new Promise((r) => setTimeout(r, 45000));
  const res = await fetch(pub.url, { signal: AbortSignal.timeout(20000) });
  const body = res.ok ? await res.text() : '';
  ok(`live page loads (HTTP ${res.status})`, res.ok && body.includes('SELFTEST OK'));

  const list = await WP.listPublished();
  ok('listed in the registry with expiry', list.some((p) => p.slug === 'b188-selftest' && p.expiresAt));

  const idx = await fetch(WP.workspaceHome(), { signal: AbortSignal.timeout(20000) });
  const idxBody = idx.ok ? await idx.text() : '';
  ok('portfolio index lists the project', idxBody.includes('b188-selftest') || idxBody.includes('Selftest'));

  const cleared = await WP.clearProject('b188-selftest');
  ok('cleared on demand', cleared.ok);
  const after = await WP.listPublished();
  ok('gone from the registry', !after.some((p) => p.slug === 'b188-selftest'));
}
}

console.log('\n== 3. wiring ==');
{
  const idx = fs.readFileSync('./index.js', 'utf-8');
  ok('admin routes exist', ['/api/workspace-admin/publish', '/api/workspace-admin/clear', '/api/workspace-admin/sweep'].every((r) => idx.includes(r)));
  ok('boot sweep runs', idx.includes('sweepWorkspace()'));
  ok('chat intent: /workspace · publish it · clear my workspace · done with X', idx.includes('B188 — WORKSPACE INTENT'));
  const tr = fs.readFileSync('./src/services/TeamRouter.js', 'utf-8');
  ok('Ada auto-publishes web builds with the PUBLIC link', tr.includes('publishProject') && tr.includes('works on any device'));
}

console.log(failures === 0 ? '\n🎉 B188 WORKSPACE CHECKS PASSED' : `\n💥 ${failures} FAILURES`);
process.exit(failures ? 1 : 0);
