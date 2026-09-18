/**
 * JEXI OS — Phase 8 Scope A: FIXTURE — deliberately vulnerable local app.
 *
 * A zero-dependency node:http app planted SOLELY as a sandbox target for
 * the pentest pipeline (scope guard: only ever probed by our own pipeline,
 * never exposed beyond localhost, never a real third-party target).
 *
 * Vulnerabilities (all real, all local):
 *   V1  GET /item?id=...     — "SQL" built by string concatenation;
 *                              tautology (' OR '1'='1) leaks ALL rows;
 *                              UNION payloads reflect injected columns
 *   V2  GET /search?q=...    — q reflected into HTML without encoding
 *   V3  GET /download?file=. — path traversal, no normalization guard
 *   V4  GET /admin           — admin panel, zero authentication
 *   V5  ALL responses        — no security headers, verbose banner
 *   V6  GET /login           — session cookie without HttpOnly/Secure,
 *                              predictable token literal
 *   V7  source               — hardcoded APP_SECRET credential
 *
 * Run directly:   node vuln-app.js            (VULN_PORT env, default 4488)
 * Or as a module: import { startVulnApp } — returns { server, port, close }.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_SECRET = 'jexi-demo-secret-2233'; // V7: hardcoded credential (demo fixture)

const USERS = [
  { id: 1, user: 'alice', email: 'alice@example.test', role: 'user' },
  { id: 2, user: 'bob', email: 'bob@example.test', role: 'user' },
  { id: 3, user: 'carol', email: 'carol@example.test', role: 'admin' },
];

function fakeQuery(id) {
  // V1: deliberately naive "database" — string concatenation, no params.
  const q = "SELECT * FROM users WHERE id = '" + id + "'";
  if (q.includes("'1'='1")) {
    return { q, rows: USERS, count: USERS.length, marker: 'all-rows-leaked' };
  }
  if (q.toUpperCase().includes(' UNION ')) {
    return { q, rows: USERS.slice(0, 1), unionColumn: 'union-marker', count: 1 };
  }
  const row = USERS.find((u) => String(u.id) === String(parseInt(id, 10)));
  return { q, rows: row ? [row] : [], count: row ? 1 : 0 };
}

function renderTemplate(res, title, bodyHtml) {
  // V5: no security headers of any kind are set anywhere in this app.
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Server: 'VulnApp/1.0 (debug)' });
  res.end(`<!doctype html><html><head><title>${title}</title></head><body>
<h1>VulnApp demo target</h1>
<nav>
  <a href="/">home</a> | <a href="/item?id=1">item</a> |
  <a href="/search?q=test">search</a> | <a href="/download?file=notes.txt">download</a> |
  <a href="/admin">admin</a> | <a href="/login">login</a>
</nav>
${bodyHtml}
</body></html>`);
}

export function startVulnApp({ port = Number(process.env.VULN_PORT || 4488) } = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/') {
      renderTemplate(res, 'home', `<p>A deliberately vulnerable fixture. Probe responsibly.</p>`);
      return;
    }

    if (url.pathname === '/item') {
      const id = url.searchParams.get('id') || '';
      const r = fakeQuery(id);
      // V1 evidence: the concatenated query is echoed back into the response.
      res.writeHead(200, { 'Content-Type': 'application/json', Server: 'VulnApp/1.0 (debug)', 'X-Query': r.q });
      res.end(JSON.stringify(r));
      return;
    }

    if (url.pathname === '/search') {
      const q = url.searchParams.get('q') || '';
      // V2: reflected, unescaped.
      renderTemplate(res, 'search', `<h2>Results for: ${q}</h2><p>no results</p>`);
      return;
    }

    if (url.pathname === '/download') {
      const file = url.searchParams.get('file') || '';
      try {
        // V3: joins request-controlled path with NO normalization / jail.
        const target = path.join(APP_DIR, file);
        const data = fs.readFileSync(target);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', Server: 'VulnApp/1.0 (debug)' });
        res.end(data);
      } catch {
        res.writeHead(404, { Server: 'VulnApp/1.0 (debug)' });
        res.end('not found');
      }
      return;
    }

    if (url.pathname === '/admin') {
      // V4: zero authentication. V6 payload preview also lives here (fmt=json).
      const rows = USERS.map((u) => `<tr><td>${u.id}</td><td>${u.user}</td><td>${u.email}</td><td>${u.role}</td></tr>`).join('');
      if (url.searchParams.get('fmt') === 'json') {
        res.writeHead(200, { 'Content-Type': 'application/json', Server: 'VulnApp/1.0 (debug)' });
        res.end(JSON.stringify({ admin: true, users: USERS }));
        return;
      }
      renderTemplate(res, 'ADMIN', `<h2>ADMIN PANEL — no auth required</h2><table border="1"><tr><th>id</th><th>user</th><th>email</th><th>role</th></tr>${rows}</table>`);
      return;
    }

    if (url.pathname === '/login') {
      // V6: predictable token, no HttpOnly, no Secure, no SameSite.
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Set-Cookie': 'session=abc123; Path=/',
        Server: 'VulnApp/1.0 (debug)',
      });
      res.end('<html><body>logged in as guest</body></html>');
      return;
    }

    res.writeHead(404, { Server: 'VulnApp/1.0 (debug)' });
    res.end('not found');
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, port, close: () => server.close() }));
  });
}

/* Run directly: serve until killed. */
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);
if (isDirectRun) {
  const { port } = await startVulnApp();
  console.log(`[vuln-app] listening on http://127.0.0.1:${port}`);
  const shutdown = () => process.exit(0);
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
