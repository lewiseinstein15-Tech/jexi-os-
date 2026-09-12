/**
 * JEXI OS — Provider bridge — normalized tool call.
 *
 * Every adapter normalizes provider-specific tool-call payloads into this ONE
 * canonical shape (Hermes pattern). The agent loop never sees provider formats.
 *
 *   {
 *     id: 'call_abc',                      // unique per round
 *     name: 'read_file',                   // tool name
 *     arguments: { path: 'src/x.js' },     // already a plain object
 *     provider_data: { ... }               // escape hatch, passthrough
 *   }
 */

export class NormalizedToolCall {
  /**
   * @param {string} id
   * @param {string} name
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [providerData]
   */
  constructor(id, name, args, providerData) {
    this.id = id;
    this.name = name;
    this.arguments = args && typeof args === 'object' ? args : {};
    if (providerData !== undefined) this.provider_data = providerData;
  }

  static from(raw) {
    if (raw instanceof NormalizedToolCall) return raw;
    const args =
      raw?.arguments !== undefined && raw.arguments !== null
        ? (typeof raw.arguments === 'string' ? safeJson(raw.arguments, {}) : raw.arguments)
        : raw?.function?.arguments !== undefined
          ? safeJson(raw.function.arguments, {})
          : raw?.input !== undefined
            ? (typeof raw.input === 'string' ? safeJson(raw.input, {}) : raw.input)
            : {};
    return new NormalizedToolCall(
      raw?.id ?? raw?.call_id ?? '',
      raw?.name ?? raw?.function?.name ?? raw?.name ?? '',
      args,
      raw?.provider_data ?? undefined,
    );
  }

  toJSON() {
    const out = { id: this.id, name: this.name, arguments: this.arguments };
    if (this.provider_data) out.provider_data = this.provider_data;
    return out;
  }
}

function safeJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}