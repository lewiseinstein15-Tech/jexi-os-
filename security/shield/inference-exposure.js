/**
 * JEXI OS — Phase 17 Scope J — INFERENCE EXPOSURE GUARD.
 *
 * Why: `ollama serve` defaults to 0.0.0.0:11434. Users who do not change the
 * config end up with an unauthenticated inference server on every interface —
 * the SentinelOne SentinelLABS + Censys 2026 scan reported ~175,000 exposed
 * Ollama servers, with "LLMjacking" (stolen GPU compute) following. This
 * module classifies a (host, port) bind and backs the provider's
 * refuse-unless-explicit-opt-in rule (ALLOW_OLLAMA_EXPOSED=1).
 *
 * Zero dependencies, no I/O in checkBind — deterministic by design
 * (same inputs → same verdict, hashable probe evidence).
 *
 * Zone: security/shield/inference-exposure.js (Phase 17 Scope J — new file).
 * Sibling shield modules (agent-scanner, rules, …) belong to other phases
 * and are NOT modified here.
 */

/** Ollama's default inference port. */
export const OLLAMA_DEFAULT_PORT = 11434;

/** Normalize an IPv6 literal that arrives bracketed (e.g. '[::1]'). */
const stripBrackets = (h) => String(h || '').replace(/^\[/, '').replace(/\]$/, '');

/** Loopback = this machine only. 127.0.0.0/8, ::1, localhost, 0:0:…:1. */
export function isLoopbackHost(host) {
  const h = stripBrackets(host).toLowerCase();
  if (h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  if (/^127(\.\d{1,3}){3}$/.test(h)) return true; // 127.0.0.0/8
  return false;
}

/** Wildcard = every interface (IPv4 any, IPv6 any, or explicit '*'). */
export function isWildcardHost(host) {
  const h = stripBrackets(host).toLowerCase();
  return h === '0.0.0.0' || h === '::' || h === '0:0:0:0:0:0:0:0' || h === '*';
}

/**
 * Classify a bind target.
 * @param {string} host - bind address as configured ('127.0.0.1', '0.0.0.0', '::', a LAN IP, …)
 * @param {number} [port=OLLAMA_DEFAULT_PORT]
 * @returns {{ exposed: boolean, risk: 'low'|'medium'|'high', reason: string }}
 */
export function checkBind(host, port = OLLAMA_DEFAULT_PORT) {
  const p = Number(port);
  const h = String(host ?? '');
  const defaultPort = p === OLLAMA_DEFAULT_PORT;

  if (isLoopbackHost(h)) {
    return {
      exposed: false,
      risk: 'low',
      reason: `${h} is a loopback address — the port is reachable only from this machine`,
    };
  }
  if (isWildcardHost(h)) {
    return {
      exposed: true,
      risk: defaultPort ? 'high' : 'medium',
      reason: `${h} binds every network interface` +
        (defaultPort
          ? ` and port ${p} is the default Ollama inference port — reachable from any network this machine attaches to`
          : ` — the service on port ${p} is reachable from any network this machine attaches to`),
    };
  }
  // Any specific, non-loopback address (LAN IP, public IP, link-local, hostname).
  return {
    exposed: true,
    risk: defaultPort ? 'high' : 'medium',
    reason: `${h} is a non-loopback address` +
      (defaultPort
        ? ` and port ${p} is the default Ollama inference port — reachable from outside this machine`
        : ` — the service on port ${p} is reachable from outside this machine`),
  };
}

/** Strict opt-in: exactly the string '1'. Anything else is a refusal. */
export function isExposureAllowed(env = (typeof process !== 'undefined' ? process.env : {})) {
  return env && env.ALLOW_OLLAMA_EXPOSED === '1';
}

/** The exact startup line required by the scope. */
export function startupNotice(host) {
  return `Ollama is bound to ${host}. To expose, set ALLOW_OLLAMA_EXPOSED=1 and accept the risk.`;
}

export default { checkBind, isLoopbackHost, isWildcardHost, isExposureAllowed, startupNotice, OLLAMA_DEFAULT_PORT };
