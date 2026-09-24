/**
 * JEXI OS — providers/tokens/realtime.js (Phase 9 D — Realtime minting profile)
 *
 * OpenAI Realtime-compatible minting profile: the SERVER holds the
 * long-lived OPENAI_API_KEY and mints a SHORT-LIVED session token for a
 * client; the client never sees the long-lived key.
 *
 * Two paths:
 *
 * 1. mintRealtimeSession(...)  — LOCAL profile (always available).
 *    Mints a jexi_eph token (scope ['realtime.session'], 60s default TTL,
 *    ek_-prefixed value mirroring OpenAI's ephemeral-key convention) and
 *    returns the OpenAI session shape:
 *
 *      { client_secret: { value, expires_at }, session: { model, ... } }
 *
 *    A client that expects OpenAI's client_secret.value / expires_at can
 *    consume this drop-in; verification happens with ephemeral.verify()
 *    on any JEXI server process sharing the HMAC key.
 *
 * 2. mintRemoteRealtimeSession({ apiKey, model }) — REAL OpenAI path.
 *    POSTs {baseUrl}/realtime/sessions with the long-lived key and
 *    returns OpenAI's response. ONLY called when a real key is supplied
 *    by the CALLER (the bridge owns the key; this module never reads or
 *    stores it). If no key is available the local profile is used and the
 *    remote path is reported NOT VERIFIED — no faking.
 *
 * TTL: OpenAI's own ephemeral session tokens live ~60s; the profile
 * defaults to 60_000 ms and is still hard-capped by the engine's 1h
 * ceiling (MAX_TTL_MS).
 */

import { mint } from './ephemeral.js';

const OPENAI_REALTIME_URL = 'https://api.openai.com/v1/realtime/sessions';
const DEFAULT_REALTIME_MODEL = 'gpt-4o-realtime-preview';
const DEFAULT_REALTIME_TTL_MS = 60_000;

/**
 * Local minting profile — OpenAI-Realtime-compatible session shape,
 * powered by the JEXI ephemeral engine. No network, no provider key.
 */
export function mintRealtimeSession({ subject, ttlMs = DEFAULT_REALTIME_TTL_MS, model = DEFAULT_REALTIME_MODEL, voice } = {}) {
  const { token, expiresAt, scope } = mint({
    scope: ['realtime.session'],
    ttlMs,
    subject,
  });
  return {
    profile: 'jexi.ephemeral.v1',
    // OpenAI-compatible: client_secret.value is the short-lived bearer the
    // client presents when opening the realtime WebSocket.
    client_secret: {
      value: `ek_${token}`, // ek_ prefix mirrors OpenAI's ephemeral-key convention
      expires_at: Math.floor(expiresAt / 1000), // OpenAI uses unix SECONDS
    },
    session: {
      model,
      ...(voice ? { voice } : {}),
      expires_at: Math.floor(expiresAt / 1000),
    },
    token, // raw jexi_eph token (without the ek_ prefix) for ephemeral.verify()
    expiresAt, // unix ms (JEXI convention)
    scope,
    subject,
    verifiedRemotely: false,
  };
}

/**
 * REAL OpenAI realtime session mint. Requires the caller to pass the
 * long-lived key (the bridge owns it; this module neither reads nor
 * stores key material). Returns OpenAI's raw response object.
 *
 * NOT exercised in this sandbox (no provider key available) — the probe
 * reports it NOT VERIFIED rather than faking a response.
 */
export async function mintRemoteRealtimeSession({ apiKey, model = DEFAULT_REALTIME_MODEL, voice } = {}) {
  if (!apiKey) throw new Error('mintRemoteRealtimeSession: apiKey required (bridge-owned long-lived key)');
  const res = await fetch(OPENAI_REALTIME_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, ...(voice ? { voice } : {}) }),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok, response: json };
}
