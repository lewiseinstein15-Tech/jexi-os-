/**
 * CONNECTORS — registry + webhook mount for the JEXI OS connector layer.
 *
 * Every connector exposes the same contract:
 *   healthCheck()  → { status: 'PASS'|'FAIL'|'BLOCKED', ok, detail, ... }  (REAL API call)
 *   send(args)     → { ok, ... }                                           (REAL API call)
 *   receive(raw)   → parsed, flat payload                                  (webhook body)
 *   envInfo()      → masked presence/source of required env vars
 *
 * Webhook routes are mounted with express.raw so HMAC signatures can be
 * verified against the exact bytes received. mountConnectorWebhooks() must run
 * BEFORE app.use(express.json(...)) — body-parser only parses once, and the
 * webhook signature check needs the untouched raw stream.
 *
 * Routes:
 *   GET  /webhooks/connectors/whatsapp   Meta verification handshake
 *   POST /webhooks/connectors/whatsapp   inbound WhatsApp messages (HMAC)
 *   POST /webhooks/connectors/github     GitHub webhook events (HMAC)
 */
import express from 'express';
import * as whatsapp from './whatsapp.js';
import * as github from './github.js';
import * as email from './email.js';

export const CONNECTORS = {
  whatsapp: {
    name: 'WhatsApp',
    healthCheck: whatsapp.healthCheck,
    send: whatsapp.send,
    receive: whatsapp.receive,
    envInfo: whatsapp.whatsappEnvInfo,
    sendArgs: ['to', 'body'],
  },
  github: {
    name: 'GitHub',
    healthCheck: github.healthCheck,
    send: github.send,
    receive: github.receive,
    envInfo: github.githubEnvInfo,
    sendArgs: ['owner', 'repo', 'title', 'body'],
  },
  email: {
    name: 'Email (Resend)',
    healthCheck: email.healthCheck,
    send: email.send,
    receive: email.receive,
    envInfo: email.resendEnvInfo,
    sendArgs: ['to', 'from', 'subject', 'html', 'text'],
  },
};

/** Masked status for every connector — used by /api/connectors. */
export function connectorStatus() {
  const out = {};
  for (const [key, c] of Object.entries(CONNECTORS)) {
    out[key] = { name: c.name, env: c.envInfo() };
  }
  return out;
}

/** Run a connector's real health check. */
export async function runHealthCheck(name) {
  const c = CONNECTORS[name];
  if (!c) return { ok: false, error: `Unknown connector: ${name}. Available: ${Object.keys(CONNECTORS).join(', ')}` };
  try {
    const result = await c.healthCheck();
    return { connector: name, time: new Date().toISOString(), ...result };
  } catch (e) {
    return { connector: name, status: 'FAIL', ok: false, detail: (e && e.message) || String(e) };
  }
}

/** Run a connector's real send. */
export async function runSend(name, args) {
  const c = CONNECTORS[name];
  if (!c) return { ok: false, error: `Unknown connector: ${name}. Available: ${Object.keys(CONNECTORS).join(', ')}` };
  try {
    const result = await c.send(args || {});
    return { connector: name, time: new Date().toISOString(), ...result };
  } catch (e) {
    return { connector: name, ok: false, error: (e && e.message) || String(e) };
  }
}

/** Mount the webhook endpoints. MUST be called before express.json(). */
export function mountConnectorWebhooks(app) {
  const webhookRouter = express.Router();
  webhookRouter.use(express.raw({ type: '*/*', limit: '5mb' }));

  // --- WhatsApp: Meta verification handshake (GET) ---
  webhookRouter.get('/whatsapp', (req, res) => {
    const result = whatsapp.verifyWebhook({
      mode: req.query['hub.mode'],
      verifyToken: req.query['hub.verify_token'],
      challenge: req.query['hub.challenge'],
    });
    if (result.ok && result.challenge) {
      res.setHeader('Content-Type', 'text/plain');
      res.status(200).send(String(result.challenge));
      return;
    }
    res.status(403).json({ error: 'Verification failed — hub.verify_token does not match VERIFY_TOKEN' });
  });

  // --- WhatsApp: inbound messages (POST, HMAC-verified) ---
  webhookRouter.post('/whatsapp', (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const signature = req.headers['x-hub-signature-256'];
    if (!whatsapp.verifySignature(raw, signature)) {
      return res.status(403).json({ error: 'Invalid x-hub-signature-256 — APP_SECRET mismatch or missing header' });
    }
    let parsed;
    try {
      parsed = whatsapp.receive(raw);
    } catch (e) {
      return res.status(400).json({ error: `Unparseable webhook payload: ${(e && e.message) || e}` });
    }
    // Meta requires a fast 200; the parsed payload is what the app consumes.
    res.status(200).json({ received: parsed.received, parsed });
  });

  // --- GitHub: webhook events (POST, HMAC-verified) ---
  webhookRouter.post('/github', (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const signature = req.headers['x-hub-signature-256'];
    if (!github.verifySignature(raw, signature)) {
      return res.status(403).json({ error: 'Invalid x-hub-signature-256 — secret mismatch or missing header' });
    }
    let parsed;
    try {
      parsed = github.receive(raw, String(req.headers['x-github-event'] || ''));
    } catch (e) {
      return res.status(400).json({ error: `Unparseable webhook payload: ${(e && e.message) || e}` });
    }
    res.status(200).json({ received: true, event: parsed.event, parsed });
  });

  app.use('/webhooks/connectors', webhookRouter);
}
