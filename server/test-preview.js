/**
 * B127 — TAPPABLE PREVIEW LINKS regression suite.
 * Proves: the preview-server engine returns a public http(s) URL (never
 * file://), and sanitizeModelOutput rewrites file:// and absolute workspace
 * paths into tappable preview URLs.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-prev-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');
fs.mkdirSync(process.env.WORKSPACE_DIR, { recursive: true });

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const { executeTool, sanitizeModelOutput } = await import('./src/services/ToolRuntime.js');
const { loadPlugins, setActivePluginContext } = await import('./src/services/PluginContext.js');
const { ctx } = await loadPlugins({ services: {} });
setActivePluginContext(ctx);

console.log('\n== 1. preview-server returns a TAPPABLE public URL ==');
fs.writeFileSync(path.join(process.env.WORKSPACE_DIR, 'index.html'), '<h1>Hi</h1><script>const x=1;</script>', 'utf-8');
const pv = await executeTool({ slug: 'preview-server', args: { name: 'index.html' } });
ok(pv.ok === true, 'preview-server executes (now has a real engine)');
const url = (() => { try { return JSON.parse(pv.result).url || ''; } catch { return ''; } })();
ok(/^https?:\/\//.test(url), `url is an http(s) URL, not file:// (${url.slice(0, 60)})`);
ok(url.indexOf('file://') === -1, 'no file:// in the URL');
ok(url.includes('/preview/'), 'url points at the /preview route (served by the backend)');

console.log('\n== 2. sanitizeModelOutput rewrites file:// + absolute paths ==');
const ws = process.env.WORKSPACE_DIR;
const s1 = sanitizeModelOutput(`See the app: file://${ws}/index.html and file://${ws}/app.js`, ws);
ok(s1.indexOf('file://') === -1, 'file:// removed');
ok(s1.includes('/preview/index.html'), 'file://<workspace>/index.html → /preview/index.html');
const s2 = sanitizeModelOutput(`The file is at ${ws}/index.html`, ws);
ok(s2.indexOf(ws) === -1, 'absolute workspace path removed');
ok(s2.includes('/preview/index.html'), 'absolute path rewritten to a tappable preview URL');
const s3 = sanitizeModelOutput('plain text, no paths', ws);
ok(s3 === 'plain text, no paths', 'plain text untouched');

console.log(`\nB127 preview: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
