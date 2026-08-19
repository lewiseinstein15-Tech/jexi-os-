/**
 * B142 — AGENT LOOP TESTKIT (DeepSeek Harness
 * `packages/test-support/agent-loop-testkit` mirror, JEXI-branded).
 *
 * Mount the standard prerequisite services for an AgentLoop test: the
 * plugin seam (with the replay LLM provider), the tool registry/runtime,
 * and the prompt assembler — one call, offline, deterministic. The caller
 * retains ownership of the loop and teardown.
 *
 *   const kit = await mountAgentLoopTestKit({ script: [{ content: '...' }] });
 *   const res = await runAgentLoop({ query, sendEvent, opts: { ...kit.opts } });
 *   kit.provider.calls // assertions
 *   await kit.dispose();
 */

import { loadPlugins, setActivePluginContext } from '../src/services/PluginContext.js';
import { createReplayProvider } from './llm-replay.js';

/** Mount the test dependencies. Returns { ctx, provider, opts, dispose }. */
export async function mountAgentLoopTestKit({ script = [], mode = 'sequence', services = {} } = {}) {
  const provider = createReplayProvider({ script, mode });
  const { ctx: pluginCtx, failed } = await loadPlugins({ services: { ...services, generateContent: provider.generateContent } });
  setActivePluginContext(pluginCtx);
  if (failed.length > 0) throw new Error(`agent-loop-testkit: plugin load failures: ${failed.map((f) => f.file).join(', ')}`);
  return {
    ctx: pluginCtx,
    provider,
    opts: { convId: `testkit-${Date.now()}` },
    dispose: async () => {
      setActivePluginContext(null);
    },
  };
}
