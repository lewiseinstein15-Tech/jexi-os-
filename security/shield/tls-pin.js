/**
 * JEXI OS — Phase 9 Scope B — TLS pinning (post-connect certificate verification).
 *
 * The SSRF shield connects to a VERIFIED IP while keeping the ORIGINAL
 * hostname for SNI and certificate validation. This module performs the
 * explicit verification of what the socket actually presented:
 *
 *   1. certificate present (the handshake produced a leaf certificate)
 *   2. validity window (not expired, not before valid_from)
 *   3. hostname match: the ORIGINAL hostname must appear in the SAN
 *      (DNS entries; wildcard `*.zone` matches exactly one label) — the
 *      CN is only consulted when the certificate carries no DNS SANs
 *   4. explicit pins (optional): if a pin set is configured for the
 *      hostname, the certificate's SHA-256 fingerprint MUST be one of the
 *      pinned values — a valid CA chain alone is then not enough
 *
 * Node's own TLS handshake already runs checkServerIdentity against the
 * `servername` we pass (the original hostname, while the socket dials the
 * verified IP); this module is the shield's independent, auditable check —
 * its report is attached to every pinned response (see ssrf.js `meta.tls`).
 *
 * Leaf module: no shield-internal imports.
 */

/** Parse `cert.subjectaltname` ("DNS:host, DNS:*.zone, IP Address:1.2.3.4") → DNS entries. */
export function parseSanDns(cert) {
  const san = String((cert && cert.subjectaltname) || '');
  return san
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('DNS:'))
    .map((s) => s.slice(4).toLowerCase().replace(/\.+$/, ''));
}

const normHost = (h) => String(h || '').toLowerCase().replace(/\.+$/, '');

/** Wildcard/exact hostname-vs-certificate match (leftmost label wildcards only). */
export function hostMatchesCert(hostname, cert) {
  const host = normHost(hostname);
  if (!host) return false;
  const dnsNames = parseSanDns(cert);
  const candidates = dnsNames.length > 0
    ? dnsNames
    : [String(cert && cert.subject && cert.subject.CN || '').toLowerCase().replace(/\.+$/, '')]
        .filter(Boolean);

  return candidates.some((name) => {
    if (name.startsWith('*.')) {
      const suffix = name.slice(2); // e.g. '*.github.com' → 'github.com'
      if (!host.endsWith('.' + suffix)) return false;
      const label = host.slice(0, host.length - suffix.length - 1);
      return label.length > 0 && !label.includes('.'); // one label only
    }
    return name === host;
  });
}

function parseCertDate(s) {
  // Node certs: "Nov  1 12:00:00 2025 GMT" — normalize inner whitespace.
  const t = Date.parse(String(s || '').replace(/\s+/g, ' ').trim());
  return Number.isFinite(t) ? new Date(t) : null;
}

/**
 * Verify the certificate the socket presented against the pinned hostname
 * (and, when configured, the pinned fingerprints).
 *
 * @param {{ hostname: string, cert: object|null, pins?: string[]|Map, now?: Date }} args
 *   cert — tls.TLSSocket.getPeerCertificate(true) leaf (has subject,
 *          subjectaltname, valid_from, valid_to, fingerprint256)
 *   pins — optional map/object hostname → array of SHA-256 cert
 *          fingerprints (hex, colon-less, case-insensitive)
 * @returns {{ ok: true, checks: object, report: object } |
 *           { ok: false, code: string, detail: string, checks: object, report: object }}
 */
export function verifyPinnedCert({ hostname, cert, pins = null, now = new Date() } = {}) {
  const checks = { certPresent: false, validity: false, hostnameMatch: false, pin: null };
  const base = {
    hostname: normHost(hostname),
    checkedAt: now.toISOString(),
    subject: (cert && cert.subject && cert.subject.CN) || null,
    san: (cert && cert.subjectaltname) || null,
    issuer: (cert && cert.issuer && (cert.issuer.O || cert.issuer.CN)) || null,
    validFrom: (cert && cert.valid_from) || null,
    validTo: (cert && cert.valid_to) || null,
    fingerprint256: (cert && cert.fingerprint256) || null,
  };

  if (!cert || !cert.valid_to) {
    return { ok: false, code: 'E_TLS_NO_CERT', detail: 'no certificate presented', checks, report: base };
  }
  checks.certPresent = true;

  // 2. validity window
  const from = parseCertDate(cert.valid_from);
  const to = parseCertDate(cert.valid_to);
  if (!from || !to) {
    return { ok: false, code: 'E_TLS_BAD_DATES', detail: 'certificate has unparsable validity dates', checks, report: base };
  }
  if (now < from) {
    return { ok: false, code: 'E_CERT_NOT_YET_VALID', detail: `certificate valid from ${cert.valid_from}`, checks, report: base };
  }
  if (now > to) {
    return { ok: false, code: 'E_CERT_EXPIRED', detail: `certificate expired ${cert.valid_to}`, checks, report: base };
  }
  checks.validity = true;

  // 3. hostname match (original hostname, not the IP we dialed)
  if (!hostMatchesCert(hostname, cert)) {
    return {
      ok: false,
      code: 'E_CERT_HOSTNAME_MISMATCH',
      detail: `certificate does not cover '${normHost(hostname)}'`,
      checks,
      report: base,
    };
  }
  checks.hostnameMatch = true;

  // 4. explicit pins (when configured for this hostname)
  if (pins) {
    const pinned = typeof pins.get === 'function'
      ? (pins.get(normHost(hostname)) || null)
      : (pins[normHost(hostname)] || null);
    if (Array.isArray(pinned) && pinned.length > 0) {
      const fp = String(cert.fingerprint256 || '').toLowerCase().replace(/:/g, '');
      const wanted = pinned.map((p) => String(p).toLowerCase().replace(/:/g, ''));
      if (!wanted.includes(fp)) {
        return {
          ok: false,
          code: 'E_TLS_PIN_MISMATCH',
          detail: `certificate fingerprint ${cert.fingerprint256} is not pinned for '${normHost(hostname)}'`,
          checks,
          report: base,
        };
      }
      checks.pin = true;
    } else {
      checks.pin = false; // no pins configured → hostname+validity is the pinning basis
    }
  }

  return { ok: true, checks, report: base };
}
