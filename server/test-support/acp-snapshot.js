/**
 * B144 — ACP SNAPSHOT (DeepSeek Harness `packages/test-support/acp-snapshot`
 * mirror, JEXI-branded).
 *
 * Capture JSON-RPC request/response snapshots for ACP/MCP surfaces: wrap
 * any call fn and record { id, method, params, result|error, at } into a
 * bounded ring, then export as JSON for assertions or golden files.
 *
 *   const snap = createAcpSnapshot();
 *   const out = await snap.capture(() => call('tools/list'));
 *   snap.entries(); snap.export();
 */

export function createAcpSnapshot({ max = 100 } = {}) {
  const entries = [];
  let seq = 0;

  const capture = async (fn, { method = null, id = null } = {}) => {
    const started = Date.now();
    try {
      const result = await fn();
      const entry = { seq: seq++, at: started, durationMs: Date.now() - started, ...(method ? { method } : {}), ...(id !== null ? { id } : {}), result };
      entries.push(entry);
      if (entries.length > max) entries.shift();
      return result;
    } catch (e) {
      const entry = { seq: seq++, at: started, durationMs: Date.now() - started, ...(method ? { method } : {}), ...(id !== null ? { id } : {}), error: { code: (e && e.code) ?? -32603, message: (e && e.message) || String(e) } };
      entries.push(entry);
      if (entries.length > max) entries.shift();
      throw e;
    }
  };

  return {
    entries: () => [...entries],
    count: () => entries.length,
    export: () => JSON.stringify({ capturedAt: Date.now(), count: entries.length, entries }, null, 2),
    clear: () => { entries.length = 0; seq = 0; },
    capture,
  };
}
