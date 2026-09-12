/**
 * JEXI OS — Provider bridge — error classification.
 *
 * OpenCode error.ts pattern: every provider error is classified into a small
 * taxonomy so the router and the agent loop can act on it (retry, fallback,
 * surface to user). Context-overflow detection covers the common "context
 * length exceeded" phrasing across providers.
 */

export const ERROR_TYPES = [
  'context_overflow',
  'rate_limit',
  'auth',
  'transient',
  'invalid_request',
  'not_configured',
  'unsupported_capability',
  'unknown',
];

const RETRYABLE = new Set(['rate_limit', 'transient', 'context_overflow']);

export class ClassifiedError extends Error {
  /**
   * @param {string} type   one of ERROR_TYPES
   * @param {string} message
   * @param {object} [opts]
   * @param {string} [opts.provider]
   * @param {unknown} [opts.originalError]
   * @param {number} [opts.retryAfterMs]
   * @param {number} [opts.status]
   */
  constructor(type, message, opts = {}) {
    super(message);
    this.name = 'ClassifiedError';
    this.type = ERROR_TYPES.includes(type) ? type : 'unknown';
    this.retryable = RETRYABLE.has(this.type);
    this.provider = opts.provider ?? 'unknown';
    this.originalError = opts.originalError;
    this.retryAfterMs = opts.retryAfterMs;
    this.status = opts.status;
  }

  static contextOverflow(message, opts = {}) { return new ClassifiedError('context_overflow', message, opts); }
  static rateLimit(message, opts = {}) { return new ClassifiedError('rate_limit', message, opts); }
  static auth(message, opts = {}) { return new ClassifiedError('auth', message, opts); }
  static transient(message, opts = {}) { return new ClassifiedError('transient', message, opts); }
  static invalidRequest(message, opts = {}) { return new ClassifiedError('invalid_request', message, opts); }
  static notConfigured(message, opts = {}) { return new ClassifiedError('not_configured', message, opts); }
  static unsupportedCapability(message, opts = {}) { return new ClassifiedError('unsupported_capability', message, opts); }
  static unknown(message, opts = {}) { return new ClassifiedError('unknown', message, opts); }
}

/** Provider failure snippets keyed by type. */
const SIGNALS = {
  context_overflow: [
    'context_length_exceeded', 'context length exceeded', 'maximum context length',
    'token limit exceeded', 'input is too long', 'context window',
    'reduce the length of the messages', 'too many tokens', 'token_limit',
    'please reduce your prompt', 'exceeds the maximum', 'longer than the limit',
  ],
  rate_limit: [
    'rate limit', 'rate_limit', '429', 'too many requests', 'quota exceeded',
    'insufficient_quota', 'resource exhausted', 'retry after', 'try again in',
  ],
  auth: [
    'auth', 'authentication', '401', '403', 'unauthorized', 'invalid api key',
    'invalid key', 'api key', 'permission denied', 'forbidden', 'invalid_api_key',
    'authentication_error', 'access denied',
  ],
  transient: [
    'timeout', 'timed out', 'econnreset', '5', '502', '503', '504', 'service unavailable',
    'internal server error', 'overloaded', 'temporarily', 'upstream', 'try again later',
    'fetch failed', 'socket hang up', 'etimedout',
  ],
};

/** Normalize a thrown value from any provider into a ClassifiedError. */
export function classifyError(raw, provider = 'unknown') {
  if (raw instanceof ClassifiedError) return raw;

  const message = extractMessage(raw).toLowerCase();
  const status = extractStatus(raw);
  const providerName = raw?.provider ?? provider;

  for (const type of ['context_overflow', 'rate_limit', 'auth', 'transient']) {
    for (const sig of SIGNALS[type]) {
      if (message.includes(sig)) {
        return new ClassifiedError(type, extractMessage(raw), {
          provider: providerName,
          originalError: raw,
          retryAfterMs: raw?.retryAfterMs ?? (type === 'rate_limit' ? 15_000 : type === 'transient' ? 5_000 : undefined),
          status,
        });
      }
    }
  }

  if (status === 400 || status === 422) {
    return new ClassifiedError('invalid_request', extractMessage(raw), { provider: providerName, originalError: raw, status });
  }
  return new ClassifiedError('unknown', extractMessage(raw), { provider: providerName, originalError: raw, status });
}

function extractMessage(raw) {
  if (typeof raw === 'string') return raw;
  if (raw instanceof Error) return raw.message;
  const m = raw?.message ?? raw?.error?.message ?? raw?.error?.error?.message;
  return m != null ? String(m) : JSON.stringify(raw ?? {});
}

function extractStatus(raw) {
  return raw?.status ?? raw?.statusCode ?? raw?.response?.status ?? raw?.error?.status;
}