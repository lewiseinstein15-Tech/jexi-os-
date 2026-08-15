/**
 * JEXI OS — Connector test mocks (Build 56).
 *
 * ⚠️ CLEARLY LABELED: these are LOCAL MOCK SERVERS that mimic the real
 * provider APIs' response shapes so the connector code can be exercised and
 * verified WITHOUT live credentials. Nothing here is a real API call, and the
 * test output always says "MOCK". The same code paths run unchanged against
 * the real providers when real keys are configured (baseUrl is the only
 * difference; it defaults to the real provider URL).
 *
 * Behavior switches are driven by the bearer token value so tests can force
 * auth failure, rate limits, provider errors and malformed responses:
 *   bad-*        → HTTP 401 (auth failure)
 *   ratelimit-*  → HTTP 429 with retry-after
 *   fail-*       → HTTP 500 (provider error)
 *   malformed-*  → HTTP 200 with a wrong-shaped body
 *   window-*     → B63: free-form text → HTTP 400 (#131047 outside-window);
 *                  template sends → HTTP 200 (exercises the fallback)
 */

import http from 'http';

const json = (res, status, data, extraHeaders = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(data));
};

const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
});

const authToken = (req) => {
  const h = req.headers['authorization'] || '';
  return h.replace(/^Bearer\s+/i, '').trim();
};

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      // Force-close keep-alive sockets (and the hanging server's never-ending
      // ones) so close() never waits forever.
      close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
    }));
  });
}

/* ------------------------- WhatsApp / Graph ------------------------- */

export function startMockWhatsApp() {
  return startServer(async (req, res) => {
    const token = authToken(req);
    const m = req.url.match(/^\/([^/]+)\/([^/]+)(\/messages)?/);
    if (!m) return json(res, 404, { error: { message: 'not found' } });
    const [, , phoneNumberId, isMessages] = m;
    if (token.startsWith('bad-')) return json(res, 401, { error: { message: 'Invalid OAuth access token.', type: 'OAuthException' } });
    if (token.startsWith('ratelimit-')) return json(res, 429, { error: { message: '(#80007) There have been too many messages sent' } }, { 'retry-after': '7' });
    if (token.startsWith('fail-')) return json(res, 500, { error: { message: 'Internal server error' } });
    if (token.startsWith('malformed-')) return json(res, 200, { hello: 'not-the-shape-you-wanted' });
    if (token.startsWith('window-') && isMessages) {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch (e) { /* noop */ }
      if (body.type === 'text') {
        return json(res, 400, { error: { message: '(#131047) Re-engagement message', code: 131047, type: 'OAuthException' } });
      }
      return json(res, 200, { messaging_product: 'whatsapp', contacts: [{ wa_id: body.to || '' }], messages: [{ id: `wamid.mock.template.${Date.now()}` }] });
    }
    if (isMessages) {
      return json(res, 200, { messaging_product: 'whatsapp', contacts: [{ wa_id: '15550001111' }], messages: [{ id: `wamid.mock.${Date.now()}` }] });
    }
    return json(res, 200, { id: phoneNumberId, display_phone_number: '+15550000000', verified_name: 'JEXI Test' });
  });
}

/* ------------------------------ GitHub ------------------------------ */

export function startMockGitHub() {
  // B61 — in-memory repo state for Contents API (create_file / update_file).
  const files = new Map(); // `${owner}/${repo}/${path}` → { sha, content }
  return startServer(async (req, res) => {
    const token = authToken(req);
    const url = req.url.split('?')[0];
    if (url === '/user') {
      if (token.startsWith('bad-')) return json(res, 401, { message: 'Bad credentials' });
      if (token.startsWith('ratelimit-')) return json(res, 403, { message: 'API rate limit exceeded for installation ID 1.' });
      return json(res, 200, { login: 'jexi-bot', id: 123 });
    }
    if (/^\/app\/installations\/\d+\/access_tokens$/.test(url) && req.method === 'POST') {
      return json(res, 201, { token: 'ghs_install_token_mock', expires_at: new Date(Date.now() + 55 * 60 * 1000).toISOString() });
    }
    const issues = url.match(/^\/repos\/([^/]+)\/([^/]+)\/issues$/);
    const comment = url.match(/^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/);
    const pulls = url.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls$/);
    const refGet = url.match(/^\/repos\/([^/]+)\/([^/]+)\/git\/ref\/heads\/([^/]+)$/);
    const blobs = url.match(/^\/repos\/([^/]+)\/([^/]+)\/git\/blobs$/);
    const trees = url.match(/^\/repos\/([^/]+)\/([^/]+)\/git\/trees$/);
    const commits = url.match(/^\/repos\/([^/]+)\/([^/]+)\/git\/commits$/);
    const refPatch = url.match(/^\/repos\/([^/]+)\/([^/]+)\/git\/refs\/heads\/([^/]+)$/);
    const contents = url.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/);
    if (token.startsWith('bad-')) return json(res, 401, { message: 'Bad credentials' });
    if (token.startsWith('ratelimit-')) return json(res, 429, { message: 'Too many requests' }, { 'retry-after': '30' });
    if (token.startsWith('fail-')) return json(res, 500, { message: 'Server error' });
    if (token.startsWith('malformed-')) return json(res, 200, { unexpected: true });
    if (token.startsWith('denied-')) return json(res, 403, { message: 'Resource not accessible by integration' });
    if (issues && req.method === 'POST') return json(res, 201, { number: 101, html_url: `https://github.com/${issues[1]}/${issues[2]}/issues/101` });
    if (comment && req.method === 'POST') return json(res, 201, { id: 4242, html_url: `https://github.com/${comment[1]}/${comment[2]}/issues/${comment[3]}#issuecomment-4242` });
    if (pulls && req.method === 'POST') return json(res, 201, { number: 7, html_url: `https://github.com/${pulls[1]}/${pulls[2]}/pull/7` });
    if (refGet && req.method === 'GET') return json(res, 200, { object: { sha: 'basehead123', type: 'commit' } });
    if (blobs && req.method === 'POST') return json(res, 201, { sha: 'blobsha1' });
    if (trees && req.method === 'POST') return json(res, 201, { sha: 'treesha1' });
    if (commits && req.method === 'POST') return json(res, 201, { sha: 'commitsha1' });
    if (refPatch && req.method === 'PATCH') return json(res, 200, { ref: `refs/heads/${refPatch[3]}`, object: { sha: 'commitsha1' } });
    if (contents) {
      const key = `${contents[1]}/${contents[2]}/${contents[3]}`;
      const existing = files.get(key);
      if (req.method === 'GET') {
        if (!existing) return json(res, 404, { message: 'Not Found' });
        return json(res, 200, {
          sha: existing.sha,
          content: Buffer.from(existing.content, 'utf8').toString('base64'),
          html_url: `https://github.com/${contents[1]}/${contents[2]}/blob/main/${contents[3]}`,
        });
      }
      if (req.method === 'PUT') {
        const body = await readBody(req);
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (e) { /* keep null */ }
        const newSha = `sha-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        const newContent = parsed && parsed.content ? Buffer.from(parsed.content, 'base64').toString('utf8') : '';
        if (existing && (!parsed || !parsed.sha)) {
          // GitHub rejects an update without the current SHA (422).
          return json(res, 422, { message: 'sha was supposed to be included in the request and must match the current file SHA' });
        }
        if (existing && parsed && parsed.sha && parsed.sha !== existing.sha) {
          return json(res, 409, { message: 'Current file sha does not match' });
        }
        files.set(key, { sha: newSha, content: newContent });
        const commitSha = `commit-${newSha}`;
        return json(res, 201, {
          content: { sha: newSha, html_url: `https://github.com/${contents[1]}/${contents[2]}/blob/main/${contents[3]}` },
          commit: { sha: commitSha, html_url: `https://github.com/${contents[1]}/${contents[2]}/commit/${commitSha}` },
        });
      }
    }
    return json(res, 404, { message: 'Not Found' });
  });
}

/* ------------------------------- Resend ------------------------------ */

export function startMockResend() {
  return startServer(async (req, res) => {
    const token = authToken(req);
    if (req.url === '/domains' && req.method === 'GET') {
      if (token.startsWith('bad-')) return json(res, 401, { message: 'Invalid API key' });
      if (token.startsWith('ratelimit-')) return json(res, 429, { message: 'Rate limit exceeded' }, { 'retry-after': '5' });
      if (token.startsWith('fail-')) return json(res, 500, { message: 'Internal error' });
      if (token.startsWith('malformed-')) return json(res, 200, { notTheShape: true });
      return json(res, 200, { data: [{ id: 'domain1', name: 'example.com', status: 'verified' }] });
    }
    if (req.url === '/emails' && req.method === 'POST') {
      if (token.startsWith('bad-')) return json(res, 401, { message: 'Invalid API key' });
      if (token.startsWith('ratelimit-')) return json(res, 429, { message: 'Rate limit exceeded' }, { 'retry-after': '5' });
      if (token.startsWith('fail-')) return json(res, 500, { message: 'Internal error' });
      if (token.startsWith('malformed-')) return json(res, 200, { notTheShape: true });
      // B61 — capture the sent body so tests can assert threading headers.
      const raw = await readBody(req);
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch (e) { /* keep null */ }
      if (parsed && parsed.headers && parsed.headers['In-Reply-To']) lastSentHeaders = parsed.headers;
      return json(res, 200, { id: `resend-mock-${Date.now()}` });
    }
    // B61 — Received-emails API: full email for one inbound event.
    const received = req.url.match(/^\/emails\/([^/]+)$/);
    if (received && req.method === 'GET') {
      if (token.startsWith('bad-')) return json(res, 401, { message: 'Invalid API key' });
      return json(res, 200, {
        id: received[1],
        from: 'user@example.com',
        to: ['jexi@yourdomain.com'],
        subject: 'Testing JEXI inbound',
        message_id: '<orig-msg-1@example.com>',
        created_at: '2026-08-15T12:00:00.000Z',
        body: { text: 'Hello JEXI, can you reply?', html: '<p>Hello JEXI, can you reply?</p>' },
        headers: [
          { name: 'Message-ID', value: '<orig-msg-1@example.com>' },
          { name: 'References', value: '<older-msg@example.com>' },
        ],
        attachments: [],
      });
    }
    return json(res, 404, { message: 'not found' });
  });
}

/** B61 — test hook: last threaded-reply headers the Resend mock captured. */
export let lastSentHeaders = null;
export function resetLastSentHeaders() { lastSentHeaders = null; }

/** Start every mock at once. Returns { whatsapp, github, resend, closeAll }. */
export async function startMockConnectorApis() {
  const [whatsapp, github, resend] = await Promise.all([
    startMockWhatsApp(), startMockGitHub(), startMockResend(),
  ]);
  return {
    whatsapp, github, resend,
    closeAll: async () => {
      await Promise.all([whatsapp.close(), github.close(), resend.close()]);
    },
  };
}

/** A server that accepts a request and never answers — for timeout tests. */
export function startHangingServer() {
  return startServer(() => { /* never respond */ });
}
