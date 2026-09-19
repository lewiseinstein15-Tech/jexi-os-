/**
 * JEXI OS — Phase 9 Scope B — DNS guard (IP classification + verified resolution).
 *
 * Two responsibilities, both part of the SSRF shield doctrine:
 *
 * 1. IP classification. `classifyIp(ip)` maps ANY IPv4/IPv6 address to a
 *    type (public | loopback | link-local | multicast | private | metadata |
 *    reserved). `isPublicIP(ip)` is the policy predicate: ONLY `public`
 *    passes. Refused ranges include RFC1918, loopback (127/8, ::1),
 *    link-local (169.254/16, fe80::/10), multicast (224/4, ff00::/8),
 *    unique-local (fc00::/7), cloud metadata endpoints (169.254.169.254,
 *    169.254.170.2, fd00:ec2::254), CGNAT, benchmarking, TEST-NETs,
 *    reserved/broadcast, IPv4-mapped IPv6, and NAT64/transition prefixes.
 *
 * 2. Verified resolution. `resolveAndVerify(hostname)` resolves A + AAAA in
 *    ONE round and refuses if ANY resolved address is non-public (an
 *    attacker controlling one record must not win by mixing records). It
 *    returns the VERIFIED address set — callers MUST connect to exactly
 *    these addresses and MUST NOT re-resolve (TOCTOU / DNS-rebinding
 *    defense). A `prior` verified set can be supplied; any divergence for
 *    the same hostname is refused as E_DNS_REBINDING_REFUSED (the
 *    belt-and-braces second check for callers that did re-resolve).
 *
 * Refusals throw ShieldRefusedError — stable machine-readable `code` +
 * operator-facing `detail` (kept out of model-visible text). This module is
 * a leaf of the shield dependency DAG (ssrf.js imports and re-exports the
 * error + the policy predicate).
 */

import dns from 'node:dns';

/** Error thrown by every shield refusal. Stable `code` + operator `detail`. */
export class ShieldRefusedError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = 'ShieldRefusedError';
    this.code = code;
    this.detail = detail;
  }
}

/** IP type constants (classification vocabulary). */
export const IP_TYPES = Object.freeze([
  'public', 'loopback', 'link-local', 'multicast', 'private', 'metadata', 'reserved',
]);

/** Refusal code per non-public type (most specific wins in the mapping). */
export const TYPE_REFUSAL_CODES = Object.freeze({
  metadata: 'E_METADATA_ENDPOINT_REFUSED',
  loopback: 'E_LOOPBACK_REFUSED',
  'link-local': 'E_LINK_LOCAL_REFUSED',
  multicast: 'E_MULTICAST_REFUSED',
  private: 'E_PRIVATE_IP_REFUSED',
  reserved: 'E_NON_PUBLIC_IP_REFUSED',
});

/* ───────────────────────────── IPv4 math ──────────────────────────────── */

function parseIPv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const o = [m[1], m[2], m[3], m[4]].map(Number);
  if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return o;
}

/** Classify a dotted-quad IPv4 address. Returns { public, type, detail }. */
function classifyIPv4(o) {
  const [a, b, c] = o;
  if (a === 0) return { public: false, type: 'reserved', detail: '0.0.0.0/8 "this network"' };

  if (a === 10) return { public: false, type: 'private', detail: 'RFC1918 10.0.0.0/8' };
  if (a === 100 && b >= 64 && b <= 127) {
    return { public: false, type: 'reserved', detail: '100.64.0.0/10 CGNAT (RFC6598)' };
  }
  if (a === 127) return { public: false, type: 'loopback', detail: '127.0.0.0/8 loopback' };

  if (a === 169 && b === 254) {
    if (c === 169 && o[3] === 254) {
      return { public: false, type: 'metadata', detail: '169.254.169.254 cloud metadata (AWS/GCP/Azure IMDS)' };
    }
    if (c === 170 && o[3] === 2) {
      return { public: false, type: 'metadata', detail: '169.254.170.2 ECS task metadata' };
    }
    return { public: false, type: 'link-local', detail: '169.254.0.0/16 link-local (RFC3927)' };
  }

  if (a === 172 && b >= 16 && b <= 31) return { public: false, type: 'private', detail: 'RFC1918 172.16.0.0/12' };
  if (a === 192 && b === 168) return { public: false, type: 'private', detail: 'RFC1918 192.168.0.0/16' };

  if (a === 192 && b === 0) {
    if (c === 0) return { public: false, type: 'reserved', detail: '192.0.0.0/24 IETF protocol assignments' };
    if (c === 2) return { public: false, type: 'reserved', detail: '192.0.2.0/24 TEST-NET-1' };
  }
  if (a === 192 && b === 88 && c === 99) {
    return { public: false, type: 'reserved', detail: '192.88.99.0/24 deprecated 6to4 relay' };
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return { public: false, type: 'reserved', detail: '198.18.0.0/15 benchmarking' };
  }
  if (a === 198 && b === 51 && c === 100) {
    return { public: false, type: 'reserved', detail: '198.51.100.0/24 TEST-NET-2' };
  }
  if (a === 203 && b === 0 && c === 113) {
    return { public: false, type: 'reserved', detail: '203.0.113.0/24 TEST-NET-3' };
  }

  if (a >= 224 && a <= 239) return { public: false, type: 'multicast', detail: '224.0.0.0/4 multicast' };
  if (a >= 240) return { public: false, type: 'reserved', detail: '240.0.0.0/4 reserved (incl. broadcast)' };

  return { public: true, type: 'public', detail: 'global unicast' };
}

/* ───────────────────────────── IPv6 math ──────────────────────────────── */

/** Expand an IPv6 address to 8 lowercase hextets. Returns null if invalid. */
function expandIPv6(addr) {
  let s = String(addr).trim().toLowerCase();
  s = s.replace(/^\[|\]$/g, '');          // strip brackets
  s = s.replace(/%.*$/, '');              // strip zone index (fe80::1%eth0)
  if (s.includes(':::')) return null;

  // Embedded dotted-quad tail (canonical mapped form '::ffff:10.0.0.1')
  // → rewrite as two hextets before group parsing.
  const v4Tail = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (v4Tail) {
    const o = parseIPv4(v4Tail[2]);
    if (!o) return null;
    s = `${v4Tail[1]}${o[0].toString(16)}${(o[1]).toString(16).padStart(2, '0')}:` +
        `${o[2].toString(16)}${(o[3]).toString(16).padStart(2, '0')}`;
  }

  let head = s, tail = null;
  if (s.includes('::')) {
    const parts = s.split('::');
    if (parts.length !== 2) return null;  // only one "::" allowed
    head = parts[0]; tail = parts[1];
  }
  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = tail === null ? null : (tail === '' ? [] : tail.split(':'));
  if (tailGroups === null) {
    // no "::" — must be exactly 8 groups
    if (headGroups.length !== 8) return null;
    var groups = headGroups;
  } else {
    const fill = 8 - headGroups.length - tailGroups.length;
    if (fill < 0) return null;
    var groups = [...headGroups, ...Array(fill).fill('0'), ...tailGroups];
  }
  if (groups.length !== 8) return null;
  const out = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

const hex = (n) => n.toString(16);

/**
 * Classify any IP (v4, v6, mapped, NAT64). Returns { public, type, detail }.
 * IPv4-mapped (::ffff:0:0/96) and NAT64 (64:ff9b::/96) embed an IPv4 address
 * — the embedded v4 is classified; a non-public embedded v4 yields its
 * specific refusal type, a public one is still refused as a transition
 * prefix (conservative: the shield does not fetch through transition mechs).
 */
export function classifyIp(ip) {
  const raw = String(ip || '').trim();

  // Plain IPv4 (also accepts v4 after bracket/zone stripping).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) {
    const o = parseIPv4(raw);
    return o ? classifyIPv4(o) : { public: false, type: 'reserved', detail: 'malformed IPv4' };
  }

  const g = expandIPv6(raw);
  if (!g) return { public: false, type: 'reserved', detail: 'malformed IP address' };

  // ::/128 unspecified, ::1/128 loopback
  if (g.every((n) => n === 0)) return { public: false, type: 'reserved', detail: '::/128 unspecified address' };
  if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) {
    return { public: false, type: 'loopback', detail: '::1/128 loopback' };
  }

  // IPv4-mapped ::ffff:0:0/96 → classify embedded v4
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) {
    const v4 = [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff];
    const inner = classifyIPv4(v4);
    if (!inner.public) return inner;
    return { public: false, type: 'reserved', detail: `IPv4-mapped ::ffff:${v4.join('.')} (mapped form refused)` };
  }

  // NAT64 64:ff9b::/96 → classify embedded v4
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((n) => n === 0)) {
    const v4 = [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff];
    const inner = classifyIPv4(v4);
    if (!inner.public) {
      return { ...inner, detail: `NAT64 64:ff9b::/96 embedding ${v4.join('.')} — ${inner.detail}` };
    }
    return { public: false, type: 'reserved', detail: `NAT64 64:ff9b::/96 (transition prefix refused, embeds ${v4.join('.')})` };
  }

  // 100::/64 discard-only
  if (g[0] === 0x100 && g.slice(1, 4).every((n) => n === 0)) {
    return { public: false, type: 'reserved', detail: '100::/64 discard-only (RFC6666)' };
  }
  // 2001:db8::/32 documentation
  if (g[0] === 0x2001 && g[1] === 0x0db8) {
    return { public: false, type: 'reserved', detail: '2001:db8::/32 documentation' };
  }
  // 2001::/32 Teredo, 2002::/16 6to4 — transition mechanisms, refused conservatively
  if (g[0] === 0x2001 && g[1] === 0x0000) {
    return { public: false, type: 'reserved', detail: '2001::/32 Teredo (transition prefix refused)' };
  }
  if (g[0] === 0x2002) {
    return { public: false, type: 'reserved', detail: '2002::/16 6to4 (transition prefix refused)' };
  }
  // fc00::/7 unique local
  if ((g[0] & 0xfe00) === 0xfc00) {
    if (g[0] === 0xfd00 && g[1] === 0xec2 && g[2] === 0x0000 && g.slice(3, 6).every((n) => n === 0) && g[6] === 0x0000 && g[7] === 0x0254) {
      return { public: false, type: 'metadata', detail: 'fd00:ec2::254 AWS IMDS (IPv6 metadata endpoint)' };
    }
    return { public: false, type: 'private', detail: `fc00::/7 unique local (${hex(g[0])}:${hex(g[1])}::)` };
  }
  // fe80::/10 link local
  if ((g[0] & 0xffc0) === 0xfe80) {
    return { public: false, type: 'link-local', detail: 'fe80::/10 link-local' };
  }
  // ff00::/8 multicast
  if ((g[0] & 0xff00) === 0xff00) {
    return { public: false, type: 'multicast', detail: 'ff00::/8 multicast' };
  }
  // 2000::/3 global unicast → public; anything else → conservative refusal
  if ((g[0] & 0xe000) === 0x2000) {
    return { public: true, type: 'public', detail: 'global unicast' };
  }
  return { public: false, type: 'reserved', detail: `non-global IPv6 prefix (${hex(g[0])}:${hex(g[1])}::)` };
}

/**
 * Policy predicate: is this IP globally routable public space?
 * Rejects RFC1918, loopback, link-local, multicast, unique-local, metadata
 * endpoints, reserved ranges, and their IPv6 equivalents (incl. mapped forms).
 */
export function isPublicIP(ip) {
  return classifyIp(ip).public === true;
}

/** Refusal code for an IP (or null when public). */
export function refusalCodeForIp(ip) {
  const c = classifyIp(ip);
  return c.public ? null : TYPE_REFUSAL_CODES[c.type];
}

/* ─────────────────────── verified DNS resolution ──────────────────────── */

/** Default resolver: Node's DNS (A + AAAA). NXDOMAIN/ENODATA → empty set. */
export const defaultResolver = Object.freeze({
  async resolve4(hostname) {
    try {
      return await dns.promises.resolve4(hostname);
    } catch (err) {
      if (err && (err.code === 'ENODATA' || err.code === 'ENOTFOUND')) return [];
      throw err;
    }
  },
  async resolve6(hostname) {
    try {
      return await dns.promises.resolve6(hostname);
    } catch (err) {
      if (err && (err.code === 'ENODATA' || err.code === 'ENOTFOUND')) return [];
      throw err;
    }
  },
});

const normHost = (h) => String(h || '').toLowerCase().replace(/\.+$/, '');

/**
 * Resolve hostname (A + AAAA, ONE round) and refuse if ANY address is
 * non-public. Returns the verified set the caller MUST connect to:
 *   { hostname, addresses: [{ip, family}], v4: [], v6: [], classified, verifiedAt }
 *
 * @param {string} hostname
 * @param {{ resolver?: object, prior?: object }} [opts]
 *   resolver  — injectable DNS (labeled test doubles); default: node dns
 *   prior     — a previous verified result for the SAME hostname; any
 *               divergence is refused as E_DNS_REBINDING_REFUSED (this is
 *               the second-check that catches a rebinding after re-resolve)
 * @throws ShieldRefusedError
 *   E_DNS_REBINDING_REFUSED    — resolution diverged from `prior`
 *   E_METADATA_ENDPOINT_REFUSED|E_LOOPBACK_REFUSED|E_LINK_LOCAL_REFUSED|
 *   E_MULTICAST_REFUSED|E_PRIVATE_IP_REFUSED|E_NON_PUBLIC_IP_REFUSED
 *   E_DNS_NO_ADDRESS           — neither A nor AAAA returned records
 */
export async function resolveAndVerify(hostname, opts = {}) {
  const host = normHost(hostname);
  if (!host || host.includes('/')) {
    throw new ShieldRefusedError('E_DNS_NO_ADDRESS', `invalid hostname '${host}'`);
  }
  const resolver = opts.resolver || defaultResolver;

  // ONE resolution round: A + AAAA fetched together, then verified as a set.
  let v4 = [], v6 = [];
  try {
    const [a, aaaa] = await Promise.all([
      Promise.resolve(resolver.resolve4(host)),
      Promise.resolve(resolver.resolve6(host)),
    ]);
    v4 = (Array.isArray(a) ? a : []).map(String);
    v6 = (Array.isArray(aaaa) ? aaaa : []).map(String);
  } catch (err) {
    throw new ShieldRefusedError('E_DNS_NO_ADDRESS', `resolution failed for '${host}'`);
  }

  // Belt-and-braces rebinding check: divergence from a prior verified set.
  if (opts.prior) {
    const priorSet = new Set((opts.prior.addresses || []).map((x) => x.ip));
    const nowSet = new Set([...v4, ...v6]);
    const same = priorSet.size === nowSet.size && [...priorSet].every((ip) => nowSet.has(ip));
    if (!same) {
      throw new ShieldRefusedError(
        'E_DNS_REBINDING_REFUSED',
        `'${host}' re-resolved to a different address set than the verified one`,
      );
    }
  }

  if (v4.length === 0 && v6.length === 0) {
    throw new ShieldRefusedError('E_DNS_NO_ADDRESS', `no A/AAAA records for '${host}'`);
  }

  const classified = [
    ...v4.map((ip) => ({ ip, family: 4, ...classifyIp(ip) })),
    ...v6.map((ip) => ({ ip, family: 6, ...classifyIp(ip) })),
  ];

  // ANY non-public record refuses the WHOLE set — one bad record must not
  // win by mixing (the connection could be steered to the bad one).
  const bad = classified.find((c) => !c.public);
  if (bad) {
    const code = TYPE_REFUSAL_CODES[bad.type] || 'E_NON_PUBLIC_IP_REFUSED';
    throw new ShieldRefusedError(code, `'${host}' resolves to ${bad.ip} (${bad.detail})`);
  }

  return {
    hostname: host,
    addresses: classified.map(({ ip, family }) => ({ ip, family })),
    v4,
    v6,
    classified,
    verifiedAt: new Date().toISOString(),
  };
}
