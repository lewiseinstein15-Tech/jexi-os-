/**
 * M8 — SETUP WIZARD PROBES (phone first-run: brain address + access key).
 *
 * Pure, fetch-injectable, no browser APIs at module scope — the wizard UI
 * and the node regression suite share this file. Every probe returns a
 * shaped result, never throws:
 *   { ok: true, ms } | { ok: false, error, status? }
 */

export function normalizeBase(raw) {
  const b = String(raw || '').trim().replace(/\/+$/, '');
  if (!b) return '';
  return /^https?:\/\//i.test(b) ? b : `https://${b}`;
}

async function withTimeout(promise, ms, fetchImpl) {
  const Fetcher = fetchImpl || fetch;
  void Fetcher;
  let timer = null;
  const gate = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, gate]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Probe GET <base>/api/health (open endpoint — no key needed).
 * 200 = a JEXI brain answers at this address.
 */
export async function probeHealth(base, { timeoutMs = 12000, fetchImpl = null } = {}) {
  const url = `${normalizeBase(base)}/api/health`;
  if (!normalizeBase(base)) return { ok: false, error: 'Enter the brain address first.' };
  const t0 = Date.now();
  try {
    const doFetch = fetchImpl || fetch;
    const res = await withTimeout(doFetch(url, { method: 'GET', cache: 'no-store' }), timeoutMs);
    const ms = Date.now() - t0;
    if (res && res.ok) return { ok: true, ms };
    return { ok: false, status: res ? res.status : 0, error: `Brain replied HTTP ${res ? res.status : '???'} — is this a JEXI server?` };
  } catch (e) {
    return { ok: false, error: /timed out/.test((e && e.message) || '') ? 'No answer — the address may be wrong or the server asleep.' : `Unreachable: ${(e && e.message) || e}` };
  }
}

/**
 * Verify GET <base>/api/key/verify with x-jexi-key.
 * 200 = key accepted · 401 = wrong key · anything else = server trouble.
 */
export async function verifyAccessKey(base, key, { timeoutMs = 12000, fetchImpl = null } = {}) {
  const clean = String(key || '').trim();
  if (!normalizeBase(base)) return { ok: false, error: 'Enter the brain address first.' };
  if (!clean) return { ok: false, error: 'Paste the access key first.' };
  const t0 = Date.now();
  try {
    const doFetch = fetchImpl || fetch;
    const res = await withTimeout(doFetch(`${normalizeBase(base)}/api/key/verify`, {
      method: 'GET',
      headers: { 'x-jexi-key': clean },
      cache: 'no-store',
    }), timeoutMs);
    const ms = Date.now() - t0;
    if (res && res.ok) return { ok: true, ms };
    if (res && res.status === 401) return { ok: false, status: 401, error: 'Wrong key — check Settings → System on the server (JEXI_API_KEY).' };
    return { ok: false, status: res ? res.status : 0, error: `Server trouble (HTTP ${res ? res.status : '???'}) — try again in a bit.` };
  } catch (e) {
    return { ok: false, error: /timed out/.test((e && e.message) || '') ? 'No answer — the brain may be asleep; try again.' : `Unreachable: ${(e && e.message) || e}` };
  }
}
