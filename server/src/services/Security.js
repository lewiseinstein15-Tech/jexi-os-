import { lookup } from 'dns';
import { promisify } from 'util';
import { isIP } from 'net';
const lookupAsync = promisify(lookup);

/**
 * JEXI OS — SSRF guard (security hardening).
 *
 * The previous guard blocked a handful of hostnames and the common IPv4
 * private ranges, but missed the cloud-metadata link-local range
 * (169.254.0.0/16 — e.g. http://169.254.169.254/latest/meta-data on AWS,
 * GCE and Azure), IPv6 (::1, fc00::/7, fe80::/10), IPv4-mapped IPv6, and
 * multi-address DNS results (a hostname that resolves to one public and one
 * private address slipped through the single-address lookup).
 *
 * isSSRF(url)        → true when dangerous (fail-closed: parse/DNS errors
 *                      are treated as blocked).
 * assertSafeUrl(url) → throws with a clear message when dangerous.
 * safeFetchUrl()     → fetch that re-validates EVERY redirect hop, so a
 *                      public URL can never bounce the server onto
 *                      internal / cloud-metadata targets.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost', '127.0.0.1', '0.0.0.0', '::1',
  'metadata', 'metadata.google.internal', 'metadata.azure.internal',
  'metadata.aws.internal', 'instance-data', 'kubernetes.default.svc',
]);

function isPrivateIPv4(ip) {
  const parts = String(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const [a, b] = parts;
  if (a === 10) return true;                              // 10.0.0.0/8
  if (a === 127) return true;                             // loopback
  if (a === 0) return true;                               // 0.0.0.0/8 "this network"
  if (a === 100 && b >= 64 && b <= 127) return true;      // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true;                // 169.254.0.0/16 link-local (cloud metadata!)
  if (a === 172 && b >= 16 && b <= 31) return true;       // 172.16.0.0/12
  if (a === 192 && b === 168) return true;                // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true;   // 198.18.0.0/15 benchmarking
  if (a >= 224) return true;                              // multicast + reserved
  return false;
}

function isPrivateIPv6(ip) {
  const s = String(ip || '').toLowerCase();
  if (s === '::' || s === '::1') return true;
  if (s.includes('::ffff:')) {
    // IPv4-mapped: the URL parser normalizes the tail to hex words
    // (::ffff:7f00:1), so decode both the dotted and hex forms.
    const tail = s.split('::ffff:')[1] || '';
    if (tail.includes('.')) return isPrivateIPv4(tail);
    const words = tail.split(':');
    if (words.length === 2) {
      const a = parseInt(words[0], 16);
      const b = parseInt(words[1], 16);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        return isPrivateIPv4(`${(a >> 8) & 255}.${a & 255}.${(b >> 8) & 255}.${b & 255}`);
      }
    }
    return true; // malformed mapped address → fail closed
  }
  const group = s.split(':')[0] || '';
  if (/^fe[89ab]/.test(group)) return true;               // fe80::/10 link-local
  if (/^f[cd]/.test(group)) return true;                  // fc00::/7 unique local
  return false;
}

/**
 * SSRF guard. Returns true when the URL is dangerous (non-http(s), private,
 * link-local, metadata, loopback). Fail-closed: any parse/DNS error → true.
 */
export async function isSSRF(urlString) {
  try {
    const url = new URL(urlString);
    if (!['http:', 'https:'].includes(url.protocol)) return true;
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (BLOCKED_HOSTNAMES.has(host)) return true;
    if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
    const ipVersion = isIP(host);
    if (ipVersion) {
      return ipVersion === 4 ? isPrivateIPv4(host) : isPrivateIPv6(host);
    }
    // Resolve EVERY address the hostname maps to; if any is internal → block.
    const addrs = await lookupAsync(host, { all: true, verbatim: true });
    return addrs.some(({ address }) => {
      const v = isIP(address);
      return v === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address);
    });
  } catch {
    return true;
  }
}

/** Throw with a clear message when the URL is SSRF-dangerous. */
export async function assertSafeUrl(urlString) {
  if (await isSSRF(urlString)) {
    throw new Error(`Security blocked (SSRF): ${String(urlString).slice(0, 120)}`);
  }
}

/**
 * Fetch that re-validates every redirect hop against the SSRF guard.
 * `fetchImpl` defaults to the global fetch; pass a different implementation
 * (e.g. node-fetch) to keep the caller's transport and options.
 */
export async function safeFetchUrl(url, opts = {}, fetchImpl = fetch) {
  await assertSafeUrl(url);
  const maxRedirects = Number(opts.maxRedirects) || 5;
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetchImpl(current, { ...opts, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      const next = new URL(loc, current).toString();
      await assertSafeUrl(next);
      current = next;
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects (blocked by SSRF guard)');
}

export function isValidUrl(urlString) {
  try {
    new URL(urlString);
    return true;
  } catch (e) {
    return false;
  }
}
