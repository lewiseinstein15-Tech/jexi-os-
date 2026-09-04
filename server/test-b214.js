#!/usr/bin/env node
/**
 * B214 — PREVIEW LINKS MUST ALWAYS WORK IN ANY BROWSER.
 *
 * Found by auditing the publish flow: publishProject committed the files
 * and returned the URL immediately — but GitHub Pages rebuilds for the
 * next ~10-60s, so the link 404ed in the user's face. Plus the workspace
 * repo had no .nojekyll, so Jekyll could silently drop `_`-prefixed
 * assets (Next.js `_next/` etc.) and break published apps.
 *
 * §1 (always runs): waitForLive behavior against REAL local servers —
 *    late-200 (goes live while polling), never-200 (honest live:false),
 *    connection-refused (no crash).
 * §2 (JEXI_WORKSPACE_E2E=1 + GITHUB_TOKEN only): a REAL publish to the
 *    live workspace repo, verified by fetching the public URL, then
 *    cleaned up. Self-skips otherwise (CI stays fast; skip is honest).
 */

process.env.DATA_DIR = './data/test-b214';

const http = (await import('node:http')).default;
const { waitForLive, publishProject, clearProject } = await import('./src/services/WorkspacePublisher.js');

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', r));

console.log('\n== 1. waitForLive: a link is only "live" when it actually serves ==');
{
  // 1a — server that 404s for ~3.5s, then serves 200 (the Pages rebuild shape)
  let up = false;
  const late = http.createServer((req, res) => {
    if (!up) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>Late App</title><h1>up</h1>');
  });
  await listen(late);
  const lateUrl = `http://127.0.0.1:${late.address().port}/app/`;
  setTimeout(() => { up = true; }, 3500);
  const a = await waitForLive(lateUrl, 15000, 500);
  check('goes-live-mid-poll → live:true', a.live === true, JSON.stringify(a));
  check('waited for the real turnaround (>=3s)', a.waitedMs >= 3000, String(a.waitedMs));
  late.close();

  // 1b — server that never serves 200 → honest live:false after the bound
  const never = http.createServer((req, res) => { res.writeHead(404); res.end('nope'); });
  await listen(never);
  const b = await waitForLive(`http://127.0.0.1:${never.address().port}/x/`, 4000, 1000);
  check('never-live → honest live:false (no fake success)', b.live === false && b.waitedMs >= 3500, JSON.stringify(b));
  never.close();

  // 1c — nothing listening (connection refused) → no crash, live:false
  const dead = http.createServer(() => {});
  await listen(dead);
  const deadPort = dead.address().port;
  dead.close();
  await new Promise((r) => setTimeout(r, 300));
  const c = await waitForLive(`http://127.0.0.1:${deadPort}/x/`, 2500, 500);
  check('connection refused → no crash, live:false', c.live === false, JSON.stringify(c));
}

console.log('\n== 2. REAL publish E2E on the live workspace (opt-in) ==');
{
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  if (process.env.JEXI_WORKSPACE_E2E !== '1' || !token) {
    console.log('  ⏭ SKIP — set JEXI_WORKSPACE_E2E=1 + GITHUB_TOKEN to run the live publish proof');
  } else {
    const MARKER = `b214-live-check-${Date.now()}`;
    const pub = await publishProject({
      name: 'b214-live-check',
      title: 'B214 link liveness proof',
      brief: 'published by test-b214 to prove preview links serve before handover',
      files: [
        { name: 'index.html', code: `<!doctype html><html><head><meta charset="utf-8"><title>B214 Proof</title></head><body><h1>${MARKER}</h1></body></html>` },
      ],
      entry: 'index.html',
    });
    check('publish reports ok', pub.ok === true, JSON.stringify(pub).slice(0, 200));
    check('publish WAITED for the URL to serve (live:true)', pub.live === true, `waitedMs=${pub.waitedMs}`);
    check('index.html entry → clean directory URL', /\/b214-live-check\/$/.test(pub.url), pub.url);

    // zero-trust: fetch the PUBLIC url ourselves and read the content back
    const res = await fetch(pub.url, { headers: { 'Cache-Control': 'no-cache' } });
    const body = await res.text();
    check('the public URL serves 200 to a fresh client', res.status === 200, String(res.status));
    check('the served page is OUR page (marker visible)', body.includes(MARKER));

    // .nojekyll present on the public repo (Jekyll off → underscore assets safe)
    const nj = await fetch('https://lewiseinstein15-tech.github.io/jexi-workspace/.nojekyll');
    check('.nojekyll is live on the workspace repo (Jekyll disabled)', nj.status === 200, String(nj.status));

    // cleanup — leave the workspace as we found it
    const cleared = await clearProject('b214-live-check');
    check('cleanup clears the proof project', cleared.ok === true, JSON.stringify(cleared).slice(0, 120));
  }
}

console.log('\n== 3. Binary (b64) files publish byte-identical (opt-in, same flag) ==');
{
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  if (process.env.JEXI_WORKSPACE_E2E !== '1' || !token) {
    console.log('  ⏭ SKIP — set JEXI_WORKSPACE_E2E=1 + GITHUB_TOKEN to run the binary publish proof');
  } else {
    // a real 1x1 red PNG
    const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const pub = await publishProject({
      name: 'b214-binary-check',
      title: 'binary publish proof',
      brief: 'images must survive the publish round-trip byte-identical',
      files: [
        { name: 'index.html', code: '<!doctype html><img src="dot.png">' },
        { name: 'dot.png', b64: PNG_B64 },
      ],
      entry: 'index.html',
    });
    check('binary publish ok + live', pub.ok === true && pub.live === true, JSON.stringify(pub).slice(0, 150));
    const res = await fetch('https://lewiseinstein15-tech.github.io/jexi-workspace/b214-binary-check/dot.png', { headers: { 'Cache-Control': 'no-cache' } });
    const buf = Buffer.from(await res.arrayBuffer());
    check('published PNG serves with the image content-type', res.status === 200 && /^image\/png/.test(res.headers.get('content-type') || ''), res.headers.get('content-type'));
    check('published PNG is BYTE-IDENTICAL to the original', buf.toString('base64') === PNG_B64, `got ${buf.length} bytes: ${buf.toString('utf-8').slice(0, 30)}`);
    const cleared = await clearProject('b214-binary-check');
    check('cleanup clears the binary proof project', cleared.ok === true);
  }
}

console.log('\n============================================================');
console.log(`B214: ${pass} passed, ${fail} failed`);
console.log('============================================================');
if (fail > 0) process.exit(1);
