/**
 * B137 — LLM REPLAY (DeepSeek Harness `packages/test-support/llm-replay` +
 * `llm-mock-server` mirror, JEXI-branded).
 *
 * A deterministic, offline LLM provider for tests: feed it a script of canned
 * outputs and it answers generateContent / chatWithToolsOnce calls in order
 * (optionally keyed by a substring matcher), recording every call for
 * assertions. Zero network, zero keys.
 *
 *   const provider = createReplayProvider({ script: [{ content: 'It is 21C.' }] });
 *   await provider.generateContent('...', '...', null, {});
 *   provider.calls // [{ kind, prompt, system, options }]
 */

/** Build a replay provider. */
export function createReplayProvider({ script = [], mode = 'sequence' } = {}) {
  const calls = [];
  let cursor = 0;

  const pick = (prompt) => {
    if (mode === 'match') {
      const entry = script.find((s) => s.match && s.match.test(String(prompt)));
      if (!entry) throw new Error(`replay provider: no script entry matches prompt "${String(prompt).slice(0, 80)}"`);
      return entry;
    }
    const entry = script[cursor];
    if (!entry) throw new Error(`replay provider: script exhausted (${script.length} entries, call #${calls.length + 1})`);
    cursor += 1;
    return entry;
  };

  const record = (kind, prompt, system, options) => {
    calls.push({ kind, prompt: String(prompt || ''), system: String(system || ''), options: options || {}, at: Date.now() });
  };

  return {
    calls,
    name: 'replay-provider',

    /** Deterministic single-shot generation. */
    async generateContent(prompt, system, image, options = {}) {
      record('generateContent', prompt, system, options);
      const entry = pick(prompt);
      if (entry.throwError) throw new Error(entry.throwError);
      return entry.content;
    },

    /** Deterministic tool-calling turn: returns a canned message. */
    async chatWithToolsOnce(prompt, system, tools, options = {}) {
      record('chatWithToolsOnce', prompt, system, options);
      const entry = pick(prompt);
      if (entry.throwError) throw new Error(entry.throwError);
      if (entry.message) return entry.message;
      return {
        role: 'assistant',
        content: typeof entry.content === 'string' ? entry.content : '',
        ...(entry.toolCalls ? { tool_calls: entry.toolCalls } : {}),
      };
    },

    /** Reset the script cursor and call log. */
    reset() {
      cursor = 0;
      calls.length = 0;
    },
  };
}

/** Assertion helper: one call log entry summarized for failure messages. */
export function callSummary(calls) {
  return calls.map((c) => `${c.kind}: ${String(c.prompt).slice(0, 60)}`).join('\n');
}
