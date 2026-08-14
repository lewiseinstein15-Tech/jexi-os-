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
    if (isMessages) {
      return json(res, 200, { messaging_product: 'whatsapp', contacts: [{ wa_id: '15550001111' }], messages: [{ id: `wamid.mock.${Date.now()}` }] });
    }
    return json(res, 200, { id: phoneNumberId, display_phone_number: '+15550000000', verified_name: 'JEXI Test' });
  });
}

/* ------------------------------ GitHub ------------------------------ */

export function startMockGitHub() {
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
    if (token.startsWith('bad-')) return json(res, 401, { message: 'Bad credentials' });
    if (token.startsWith('ratelimit-')) return json(res, 429, { message: 'Too many requests' }, { 'retry-after': '30' });
    if (token.startsWith('fail-')) return json(res, 500, { message: 'Server error' });
    if (token.startsWith('malformed-')) return json(res, 200, { unexpected: true });
    if (issues && req.method === 'POST') return json(res, 201, { number: 101, html_url: `https://github.com/${issues[1]}/${issues[2]}/issues/101` });
    if (comment && req.method === 'POST') return json(res, 201, { id: 4242, html_url: `https://github.com/${comment[1]}/${comment[2]}/issues/${comment[3]}#issuecomment-4242` });
    if (pulls && req.method === 'POST') return json(res, 201, { number: 7, html_url: `https://github.com/${pulls[1]}/${pulls[2]}/pull/7` });
    if (refGet && req.method === 'GET') return json(res, 200, { object: { sha: 'basehead123', type: 'commit' } });
    if (blobs && req.method === 'POST') return json(res, 201, { sha: 'blobsha1' });
    if (trees && req.method === 'POST') return json(res, 201, { sha: 'treesha1' });
    if (commits && req.method === 'POST') return json(res, 201, { sha: 'commitsha1' });
    if (refPatch && req.method === 'PATCH') return json(res, 200, { ref: `refs/heads/${refPatch[3]}`, object: { sha: 'commitsha1' } });
    return json(res, 404, { message: 'Not Found' });
  });
}

/* ------------------------------ SendGrid ----------------------------- */

export function startMockSendGrid() {
  return startServer(async (req, res) => {
    const token = authToken(req);
    if (req.url === '/v3/scopes') {
      if (token.startsWith('bad-')) return json(res, 401, { errors: [{ message: 'authorization required' }] });
      return json(res, 200, { scopes: ['mail.send', 'suppression.read'] });
    }
    if (req.url === '/v3/mail/send' && req.method === 'POST') {
      if (token.startsWith('bad-')) return json(res, 401, { errors: [{ message: 'authorization required' }] });
      if (token.startsWith('ratelimit-')) return json(res, 429, { errors: [{ message: 'rate limit' }] }, { 'retry-after': '5' });
      if (token.startsWith('fail-')) return json(res, 400, { errors: [{ message: 'invalid from address', field: 'from' }] });
      if (token.startsWith('malformed-')) { res.writeHead(202, { 'X-Message-Id': 'mock-message-id' }); return res.end('not json at all'); }
      res.writeHead(202, { 'X-Message-Id': 'mock-message-id' });
      return res.end(); // SendGrid returns 202 with an empty body
    }
    return json(res, 404, { errors: [{ message: 'not found' }] });
  });
}

/* ------------------------------ Telegram ----------------------------- */

export function startMockTelegram() {
  return startServer(async (req, res) => {
    const url = req.url.split('?')[0];
    const tokenMatch = url.match(/^\/bot([^/]+)\/(getMe|sendMessage|sendPhoto|sendDocument|getUpdates)$/);
    if (!tokenMatch) return json(res, 404, { ok: false, error_code: 404, description: 'not found' });
    const [, token, method] = tokenMatch;
    if (token.startsWith('bad-')) return json(res, 401, { ok: false, error_code: 401, description: 'Unauthorized' });
    if (token.startsWith('ratelimit-')) return json(res, 429, { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 6 } });
    if (method === 'getMe') return json(res, 200, { ok: true, result: { id: 555, username: 'jexi_test_bot', first_name: 'JEXI' } });
    if (method === 'getUpdates') {
      return json(res, 200, { ok: true, result: [{ update_id: 9001, message: { message_id: 11, date: 1691785099, chat: { id: 777, type: 'private' }, from: { id: 888, username: 'tester' }, text: 'hello from telegram' } }] });
    }
    if (method === 'sendMessage' || method === 'sendPhoto' || method === 'sendDocument') {
      return json(res, 200, { ok: true, result: { message_id: 99, date: 1691785099, chat: { id: 777, type: 'private' }, text: 'sent' } });
    }
    return json(res, 200, { ok: true, result: [] });
  });
}

/** Start every mock at once. Returns { whatsapp, github, sendgrid, telegram, closeAll }. */
export async function startMockConnectorApis() {
  const [whatsapp, github, sendgrid, telegram] = await Promise.all([
    startMockWhatsApp(), startMockGitHub(), startMockSendGrid(), startMockTelegram(),
  ]);
  return {
    whatsapp, github, sendgrid, telegram,
    closeAll: async () => {
      await Promise.all([whatsapp.close(), github.close(), sendgrid.close(), telegram.close()]);
    },
  };
}

/** A server that accepts a request and never answers — for timeout tests. */
export function startHangingServer() {
  return startServer(() => { /* never respond */ });
}
