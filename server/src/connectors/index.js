/**
 * JEXI OS — Connector System (Build 56) — wiring module.
 *
 *   registerConnectors()   — read settings.connectors + register every
 *                            connector into the registry (env keys win).
 *   getConnectorStatus()   — health + config (masked) for the UI.
 *   saveConnectorConfig()  — persist config (settings file), re-register.
 *   callConnector()        — dispatch send/receive/health by name+method.
 *   handleConnectorWebhook() — verify signature → normalize → events.
 *
 * Agent access goes through the `connector-call` tool (ToolRuntime): it is
 * EXTERNAL-tier, so every outbound send from an agent requires ONE explicit
 * human approval with the finalized details (B55 OpenWorker model).
 * User-initiated sends from the Connectors UI are themselves the approval.
 */

import { loadSettings, saveSettings } from '../services/SettingsManager.js';
import { ConnectorConfig, ConnectorError, ERROR_CODES } from './ConnectorBase.js';
import { ConnectorRegistry } from './ConnectorRegistry.js';
import { registerWhatsAppConnector } from './whatsapp.js';
import { registerGitHubConnector } from './github.js';
import { registerEmailConnector } from './email.js';
import { registerTelegramConnector } from './telegram.js';
import { listConnectorTools } from './toolBridge.js';

export const CONNECTOR_NAMES = ['whatsapp', 'github', 'email', 'telegram'];

const REGISTRARS = {
  whatsapp: registerWhatsAppConnector,
  github: registerGitHubConnector,
  email: registerEmailConnector,
  telegram: registerTelegramConnector,
};

function storedConfigs() {
  const s = loadSettings();
  return (s && s.connectors) || {};
}

/** Register every known connector with its stored config (env keys win at call time). */
export function registerConnectors() {
  const stored = storedConfigs();
  for (const name of CONNECTOR_NAMES) {
    const cfg = stored[name] || {};
    try {
      REGISTRARS[name](new ConnectorConfig({ name, auth: cfg.auth || {}, enabled: cfg.enabled !== false }));
    } catch (e) {
      console.error(`[connectors] failed to register ${name}:`, (e && e.message) || e);
    }
  }
  return ConnectorRegistry.listAvailable();
}

/** Persist + re-register one connector's config. Returns the masked saved config. */
export function saveConnectorConfig(name, { auth, enabled } = {}) {
  const key = String(name).toLowerCase();
  if (!REGISTRARS[key]) throw new ConnectorError(ERROR_CODES.NOT_CONFIGURED, `Unknown connector "${name}". Available: ${CONNECTOR_NAMES.join(', ')}`);
  const s = loadSettings();
  const connectors = s.connectors || (s.connectors = {});
  const prev = connectors[key] || {};
  connectors[key] = {
    auth: { ...prev.auth, ...(auth || {}) },
    enabled: enabled !== undefined ? !!enabled : prev.enabled !== false,
  };
  saveSettings(s);
  // Re-register with the new config.
  ConnectorRegistry.unregister(key);
  REGISTRARS[key](new ConnectorConfig({ name: key, auth: connectors[key].auth, enabled: connectors[key].enabled }));
  return { name: key, enabled: connectors[key].enabled, auth: connectors[key].auth };
}

/** Health + masked config for every registered connector. */
export async function getConnectorStatus() {
  const out = [];
  for (const name of ConnectorRegistry.listAvailable()) {
    const c = ConnectorRegistry.get(name);
    const health = await c.healthCheck().catch((e) => ({ status: 'error', detail: (e && e.message) || String(e), code: e && e.code }));
    out.push({
      name,
      label: c.label,
      enabled: c.config.enabled,
      configured: c.config.configured,
      health: health.status === 'ok' ? 'ok' : health.status === 'error' ? 'error' : 'unknown',
      detail: health.detail,
      code: health.code || null,
      tier: 'external',
      tool: `send_${(c.constructor.toolName || name).replace(/^send_/, '')}`,
      auth: c.config.masked(),
      meta: { ...(c.config.meta || {}), webhooks: connectorWebhookPaths(name) },
    });
  }
  return out;
}

function connectorWebhookPaths(name) {
  const base = `/webhooks/connectors/${name}`;
  if (name === 'whatsapp') return { post: base, get: `${base}?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<random>` };
  return { post: base };
}

/** Dispatch a connector call: method ∈ send | receive | authenticate | health. */
export async function callConnector(name, { method = 'send', payload = {}, offset } = {}) {
  const connector = ConnectorRegistry.get(name);
  if (!connector.config.enabled) {
    return { ok: false, connector: name, error: `Connector "${name}" is disabled — enable it in Settings → Connectors first.`, code: 'DISABLED' };
  }
  try {
    if (method === 'send') {
      const result = await connector.send(payload);
      return { ok: true, connector: name, method, result };
    }
    if (method === 'receive') {
      const events = await connector.receive(payload);
      return { ok: true, connector: name, method, events };
    }
    if (method === 'authenticate') {
      const ok = await connector.authenticate();
      return { ok: !!ok, connector: name, method, authenticated: !!ok };
    }
    if (method === 'health') {
      const health = await connector.healthCheck();
      return { ok: health.status === 'ok', connector: name, method, health };
    }
    throw new ConnectorError(ERROR_CODES.NOT_CONFIGURED, `Unknown connector method "${method}" (send | receive | authenticate | health)`, { provider: name });
  } catch (e) {
    return {
      ok: false,
      connector: name,
      method,
      error: (e && e.message) || String(e),
      code: (e && e.code) || 'PROVIDER_ERROR',
      retryAfter: (e && e.retryAfter) || null,
    };
  }
}

/**
 * Webhook dispatch used by the Express routes (mounted before express.json,
 * so rawBody is the untouched request body for signature verification).
 */
export async function handleConnectorWebhook(name, { rawBody, headers = {}, query = {}, body = null } = {}) {
  const connector = ConnectorRegistry.get(name);

  // WhatsApp GET verification handshake (Meta requires this).
  if (name === 'whatsapp' && (query['hub.mode'] || query['hub.challenge'])) {
    const handshake = connector.handleWebhookVerification(query);
    return { kind: 'handshake', ...handshake };
  }

  // Signature verification per provider.
  if (name === 'whatsapp' || name === 'github') {
    const verified = connector.verifyWebhookSignature(rawBody, headers);
    if (!verified) {
      return { kind: 'rejected', error: 'Webhook signature verification failed (X-Hub-Signature mismatch)' };
    }
  }
  if (name === 'telegram') {
    const verified = connector.verifyWebhookSecret(headers);
    if (!verified) {
      return { kind: 'rejected', error: 'Telegram webhook secret token mismatch' };
    }
  }

  // Parse the body for each provider shape.
  let events = [];
  if (name === 'email') {
    const contentType = headers['content-type'] || '';
    if (/multipart\/form-data/i.test(contentType)) {
      const { parseMultipartForm } = await import('./email.js');
      const { fields, attachments } = parseMultipartForm(rawBody || '', contentType);
      events = connector.normalizeInbound({ fields, attachments });
    } else {
      events = connector.receive(body); // JSON event webhook
    }
  } else if (name === 'telegram') {
    events = connector.normalizeInbound(body);
  } else {
    events = connector.normalizeInbound(body);
  }

  return { kind: 'events', verified: true, events };
}

/** Tool schemas for every registered connector (agent-facing). */
export function getConnectorToolSchemas() {
  return listConnectorTools();
}
