# JEXI OS — STAGE 3B-2b — EDIT LOG (source imports for moved dirs)

**Branch:** `restructure/file-structure` · **Base:** `feaefa1` (3B-2a) · **Mode:** computed rewrites (no sed) · **Companion to:** the Stage 3B-2b probe report

| metric | value |
| --- | --- |
| refs rewritten | **657** (relative 547 · literal 98 · root-constant depth 12) |
| files edited | **329** |
| refs skipped as false positives | **73** (server-internal 40 · temp/fixture/bundle/content 33) |
| refs UNRESOLVABLE (→ 3B-3) | 84 |
| `npm run build` | **GREEN** — 0 unresolved imports |

## Method (every ref, per file)

1. resolve the OLD ref against the file's **pre-move** location (current path minus the new container prefix);
2. map that target through the Stage-1/2 rename map;
3. compute the NEW ref as a relative path **from the file's current location**;
4. accept only if (a) the ref is broken today, (b) the mapped target **exists on disk**, and (c) recomputing the new ref lands exactly on that target. Otherwise the ref is skipped/unresolvable.

**Hard exclusions** (never rewritten): any ref whose target resolves inside `server/` (`server/src/{memory,context,kernel,scheduler,workgraph,tools,lsp,capability,workforce,providers}/` — false friends), server-relative helper arguments (`serverMod(...)`), temp/fixture roots (`tmp`, `RT`, `fixtureRoot`, `MINI_REPO`, `ws`, `DATA_DIR`, `SERVER_ROOT`, `SRC_DIR`, `__d`), bundle-internal paths (`phase22-*` plugin bundles), and content assertions in tests.

---

## Group summary

| group | files_edited | refs_fixed | refs_skipped_false_positive | refs_unresolvable |
| --- | ---: | ---: | ---: | ---: |
| 1. server/ | 30 | 76 | 18 | 14 |
| 2. scripts/ | 156 | 413 | 0 | 22 |
| 3. interfaces/ | — | — | — | — (fixed in 3B-2a) |
| 4. capabilities/ + services/ | 14 | 22 | 18 | 11 |
| 5. mind/ + runtime/ + agents/ | 86 | 88 | 4 | 25 |
| 6. integrations/ + infra/ + tests/ | 6 | 10 | 0 | 3 |
| 7. skills/ + harness/ + benchmarks/ + security/ | 37 | 48 | 0 | 9 |
| 8. root-level files | 0 | 0 | 0 | 0 |
| **TOTAL** | **329** | **657** | **73** | **84** |

---

## 1. server/ — 30 files, 76 refs

| file | old_ref | old_target | new_target | new_ref |
| --- | --- | --- | --- | --- |
| `server/src/context/sources/index.js` | `../../../../learning/index.js` | `learning/index.js` | `mind/learning/index.js` | `../../../../mind/learning/index.js` |
| `server/src/kernel/hooks/runner.js` | `hooks` | `hooks` | `infra/hooks` | `infra/hooks` |
| `server/src/memory/index.js` | `../../../memory/confidence.js` | `memory/confidence.js` | `mind/memory/confidence.js` | `../../../mind/memory/confidence.js` |
| `server/src/memory/index.js` | `../../../memory/hybrid-search.js` | `memory/hybrid-search.js` | `mind/memory/hybrid-search.js` | `../../../mind/memory/hybrid-search.js` |
| `server/src/memory/index.js` | `../../../memory/lifecycle.js` | `memory/lifecycle.js` | `mind/memory/lifecycle.js` | `../../../mind/memory/lifecycle.js` |
| `server/src/providers/runtime/LLMClient.js` | `../../../../providers/cost/caps.js` | `providers/cost/caps.js` | `integrations/providers/cost/caps.js` | `../../../../integrations/providers/cost/caps.js` |
| `server/src/routes/tokens.js` | `../../../providers/tokens/ephemeral.js` | `providers/tokens/ephemeral.js` | `integrations/providers/tokens/ephemeral.js` | `../../../integrations/providers/tokens/ephemeral.js` |
| `server/src/services/JexiIdentity.js` | `../../../brain/self/index.js` | `brain/self/index.js` | `mind/brain/self/index.js` | `../../../mind/brain/self/index.js` |
| `server/src/wiring/phase31-bootstrap.js` | `../../../brain/cycle/index.js` | `brain/cycle/index.js` | `mind/brain/cycle/index.js` | `../../../mind/brain/cycle/index.js` |
| `server/src/wiring/phase31-bootstrap.js` | `../../../brain/hot/index.js` | `brain/hot/index.js` | `mind/brain/hot/index.js` | `../../../mind/brain/hot/index.js` |
| `server/src/wiring/phase31-bootstrap.js` | `../../../brain/hot/mcp-meta.js` | `brain/hot/mcp-meta.js` | `mind/brain/hot/mcp-meta.js` | `../../../mind/brain/hot/mcp-meta.js` |
| `server/src/wiring/phase31-bootstrap.js` | `../../../brain/index/index.js` | `brain/index/index.js` | `mind/brain/index/index.js` | `../../../mind/brain/index/index.js` |
| `server/src/wiring/phase31-bootstrap.js` | `../../../brain/protocol/index.js` | `brain/protocol/index.js` | `mind/brain/protocol/index.js` | `../../../mind/brain/protocol/index.js` |
| `server/src/wiring/phase31-bootstrap.js` | `../../../brain/repo/index.js` | `brain/repo/index.js` | `mind/brain/repo/index.js` | `../../../mind/brain/repo/index.js` |
| `server/src/wiring/phase31-bootstrap.js` | `../../../brain/search/index.js` | `brain/search/index.js` | `mind/brain/search/index.js` | `../../../mind/brain/search/index.js` |
| `server/src/wiring/phase31-bootstrap.js` | `../../../brain/self/index.js` | `brain/self/index.js` | `mind/brain/self/index.js` | `../../../mind/brain/self/index.js` |
| `server/src/wiring/phase31-bootstrap.js` | `../../../capability/code/graph-first.js` | `capability/code/graph-first.js` | `capabilities/graph/code/graph-first.js` | `../../../capabilities/graph/code/graph-first.js` |
| `server/src/wiring/phase31-bootstrap.js` | `../../../context/offload/index.js` | `context/offload/index.js` | `runtime/context/offload/index.js` | `../../../runtime/context/offload/index.js` |
| `server/src/wiring/phase31-bootstrap.js` | `../../../context/viking/filesystem.js` | `context/viking/filesystem.js` | `runtime/context/viking/filesystem.js` | `../../../runtime/context/viking/filesystem.js` |
| `server/src/wiring/phase31-bootstrap.js` | `../../../instincts/observe/index.js` | `instincts/observe/index.js` | `mind/instincts/observe/index.js` | `../../../mind/instincts/observe/index.js` |
| `server/src/wiring/phase31-bootstrap.js` | `../../../rlm/kernel/index.js` | `rlm/kernel/index.js` | `runtime/rlm/kernel/index.js` | `../../../runtime/rlm/kernel/index.js` |
| `server/src/wiring/phase31-bootstrap.js` | `../../../scheduler/autonomous/index.js` | `scheduler/autonomous/index.js` | `runtime/scheduler/autonomous/index.js` | `../../../runtime/scheduler/autonomous/index.js` |
| `server/src/wiring/phase31-bootstrap.js` | `../../../semantica/graph/index.js` | `semantica/graph/index.js` | `services/semantica/graph/index.js` | `../../../services/semantica/graph/index.js` |
| `server/src/wiring/phase31-bootstrap.js` | `../../../session/fleet/index.js` | `session/fleet/index.js` | `runtime/session/fleet/index.js` | `../../../runtime/session/fleet/index.js` |
| `server/src/wiring/phase31-bootstrap.js` | `../../../swarm/loops/looper.js` | `swarm/loops/looper.js` | `agents/swarm/loops/looper.js` | `../../../agents/swarm/loops/looper.js` |
| `server/src/wiring/phase31-bootstrap.js` | `../../../swarm/loops/ralph.js` | `swarm/loops/ralph.js` | `agents/swarm/loops/ralph.js` | `../../../agents/swarm/loops/ralph.js` |
| `server/src/wiring/phase31-bootstrap.js` | `../../../verification/visual/scene-qa.js` | `verification/visual/scene-qa.js` | `tests/verification/visual/scene-qa.js` | `../../../tests/verification/visual/scene-qa.js` |
| `server/src/wiring/phase31-bootstrap.js` | `../../../workgraph/phases/gsd/index.js` | `workgraph/phases/gsd/index.js` | `runtime/workgraph/phases/gsd/index.js` | `../../../runtime/workgraph/phases/gsd/index.js` |
| `server/src/wiring/phase31-providers.js` | `../../../providers/profiles/index.js` | `providers/profiles/index.js` | `integrations/providers/profiles/index.js` | `../../../integrations/providers/profiles/index.js` |
| `server/src/wiring/phase31-repoctx.js` | `../../../semantica/repo-map/index.js` | `semantica/repo-map/index.js` | `services/semantica/repo-map/index.js` | `../../../services/semantica/repo-map/index.js` |
| `server/src/wiring/phase31-self-evolve.js` | `../../../semantica/decisions/index.js` | `semantica/decisions/index.js` | `services/semantica/decisions/index.js` | `../../../services/semantica/decisions/index.js` |
| `server/src/wiring/phase31-wa4-topology.js` | `../../../swarm/topologies/index.js` | `swarm/topologies/index.js` | `agents/swarm/topologies/index.js` | `../../../agents/swarm/topologies/index.js` |
| `server/test-api-surface.js` | `src` | `src` | `interfaces/console` | `interfaces/console` |
| `server/test-b197.js` | `src` | `src` | `interfaces/console` | `interfaces/console` |
| `server/test-b200.js` | `src/components/ChatWindow.jsx` | `src/components/ChatWindow.jsx` | `interfaces/console/components/ChatWindow.jsx` | `interfaces/console/components/ChatWindow.jsx` |
| `server/test-b200.js` | `src/components/NarrationFeed.jsx` | `src/components/NarrationFeed.jsx` | `interfaces/console/components/NarrationFeed.jsx` | `interfaces/console/components/NarrationFeed.jsx` |
| `server/test-b200.js` | `src/hooks/useJexiEngine.js` | `src/hooks/useJexiEngine.js` | `interfaces/console/hooks/useJexiEngine.js` | `interfaces/console/hooks/useJexiEngine.js` |
| `server/test-b205.js` | `../src/utils/agentStream.js` | `src/utils/agentStream.js` | `interfaces/console/utils/agentStream.js` | `../interfaces/console/utils/agentStream.js` |
| `server/test-b206.js` | `../src/utils/agentStream.js` | `src/utils/agentStream.js` | `interfaces/console/utils/agentStream.js` | `../interfaces/console/utils/agentStream.js` |
| `server/test-commands.js` | `commands` | `commands` | `capabilities/commands` | `capabilities/commands` |
| `server/test-dsh-batch14.js` | `src/brand/official.jsx` | `src/brand/official.jsx` | `interfaces/console/brand/official.jsx` | `interfaces/console/brand/official.jsx` |
| `server/test-dsh-batch14.js` | `src/main.jsx` | `src/main.jsx` | `interfaces/console/main.jsx` | `interfaces/console/main.jsx` |
| `server/test-dsh-batch14.js` | `src/utils/referenceSource.js` | `src/utils/referenceSource.js` | `interfaces/console/utils/referenceSource.js` | `interfaces/console/utils/referenceSource.js` |
| `server/test-dsh-batch14.js` | `src/utils/uiRenderer.jsx` | `src/utils/uiRenderer.jsx` | `interfaces/console/utils/uiRenderer.jsx` | `interfaces/console/utils/uiRenderer.jsx` |
| `server/test-hud.js` | `../events/hud/index.js` | `events/hud/index.js` | `runtime/events/hud/index.js` | `../runtime/events/hud/index.js` |
| `server/test-hud.js` | `../events/hud/schema.js` | `events/hud/schema.js` | `runtime/events/hud/schema.js` | `../runtime/events/hud/schema.js` |
| `server/test-hud.js` | `../events/hud/validator.js` | `events/hud/validator.js` | `runtime/events/hud/validator.js` | `../runtime/events/hud/validator.js` |
| `server/test-identity.js` | `../brain/self/index.js` | `brain/self/index.js` | `mind/brain/self/index.js` | `../mind/brain/self/index.js` |
| `server/test-learning.js` | `../learning/analyzer.js` | `learning/analyzer.js` | `mind/learning/analyzer.js` | `../mind/learning/analyzer.js` |
| `server/test-learning.js` | `../learning/index.js` | `learning/index.js` | `mind/learning/index.js` | `../mind/learning/index.js` |
| `server/test-learning.js` | `../learning/instinct.js` | `learning/instinct.js` | `mind/learning/instinct.js` | `../mind/learning/instinct.js` |
| `server/test-learning.js` | `../learning/observer.js` | `learning/observer.js` | `mind/learning/observer.js` | `../mind/learning/observer.js` |
| `server/test-learning.js` | `../learning/promoter.js` | `learning/promoter.js` | `mind/learning/promoter.js` | `../mind/learning/promoter.js` |
| `server/test-learning.js` | `../learning/store.js` | `learning/store.js` | `mind/learning/store.js` | `../mind/learning/store.js` |
| `server/test-math-stream.js` | `src/components/MarkdownRenderer.jsx` | `src/components/MarkdownRenderer.jsx` | `interfaces/console/components/MarkdownRenderer.jsx` | `interfaces/console/components/MarkdownRenderer.jsx` |
| `server/test-math-stream.js` | `src/hooks/useTypewriter.js` | `src/hooks/useTypewriter.js` | `interfaces/console/hooks/useTypewriter.js` | `interfaces/console/hooks/useTypewriter.js` |
| `server/test-math-stream.js` | `src/index.css` | `src/index.css` | `interfaces/console/index.css` | `interfaces/console/index.css` |
| `server/test-math-stream.js` | `src/utils/mathPreprocess.js` | `src/utils/mathPreprocess.js` | `interfaces/console/utils/mathPreprocess.js` | `interfaces/console/utils/mathPreprocess.js` |
| `server/test-model-coworkers.js` | `src/components/AgentThinking.jsx` | `src/components/AgentThinking.jsx` | `interfaces/console/components/AgentThinking.jsx` | `interfaces/console/components/AgentThinking.jsx` |
| `server/test-model-coworkers.js` | `src/components/ChatWindow.jsx` | `src/components/ChatWindow.jsx` | `interfaces/console/components/ChatWindow.jsx` | `interfaces/console/components/ChatWindow.jsx` |
| `server/test-model-coworkers.js` | `src/components/SettingsView.jsx` | `src/components/SettingsView.jsx` | `interfaces/console/components/SettingsView.jsx` | `interfaces/console/components/SettingsView.jsx` |
| `server/test-model-coworkers.js` | `src/hooks/useJexiEngine.js` | `src/hooks/useJexiEngine.js` | `interfaces/console/hooks/useJexiEngine.js` | `interfaces/console/hooks/useJexiEngine.js` |
| `server/test-phone-notify.js` | `../src/utils/phoneNotify.js` | `src/utils/phoneNotify.js` | `interfaces/console/utils/phoneNotify.js` | `../interfaces/console/utils/phoneNotify.js` |
| `server/test-presenter.js` | `../src/utils/chartSvg.js` | `src/utils/chartSvg.js` | `interfaces/console/utils/chartSvg.js` | `../interfaces/console/utils/chartSvg.js` |
| `server/test-presenter.js` | `src/components/MarkdownRenderer.jsx` | `src/components/MarkdownRenderer.jsx` | `interfaces/console/components/MarkdownRenderer.jsx` | `interfaces/console/components/MarkdownRenderer.jsx` |
| `server/test-rich-render.js` | `src` | `src` | `interfaces/console` | `interfaces/console` |
| `server/test-setup-wizard.js` | `src` | `src` | `interfaces/console` | `interfaces/console` |
| `server/test-team-router.js` | `src/components/ChatWindow.jsx` | `src/components/ChatWindow.jsx` | `interfaces/console/components/ChatWindow.jsx` | `interfaces/console/components/ChatWindow.jsx` |
| `server/test-team-router.js` | `src/index.css` | `src/index.css` | `interfaces/console/index.css` | `interfaces/console/index.css` |
| `server/test-thinking.js` | `src/components/AgentPipeline.jsx` | `src/components/AgentPipeline.jsx` | `interfaces/console/components/AgentPipeline.jsx` | `interfaces/console/components/AgentPipeline.jsx` |
| `server/test-thinking.js` | `src/components/ChatWindow.jsx` | `src/components/ChatWindow.jsx` | `interfaces/console/components/ChatWindow.jsx` | `interfaces/console/components/ChatWindow.jsx` |
| `server/test-thinking.js` | `src/components/ThinkRow.jsx` | `src/components/ThinkRow.jsx` | `interfaces/console/components/ThinkRow.jsx` | `interfaces/console/components/ThinkRow.jsx` |
| `server/test-thinking.js` | `src/hooks/useJexiEngine.js` | `src/hooks/useJexiEngine.js` | `interfaces/console/hooks/useJexiEngine.js` | `interfaces/console/hooks/useJexiEngine.js` |
| `server/test-web-search.js` | `src/components/ChatWindow.jsx` | `src/components/ChatWindow.jsx` | `interfaces/console/components/ChatWindow.jsx` | `interfaces/console/components/ChatWindow.jsx` |
| `server/test-web-search.js` | `src/components/StepRow.jsx` | `src/components/StepRow.jsx` | `interfaces/console/components/StepRow.jsx` | `interfaces/console/components/StepRow.jsx` |
| `server/test-web-search.js` | `src/index.css` | `src/index.css` | `interfaces/console/index.css` | `interfaces/console/index.css` |

## 2. scripts/ — 156 files, 413 refs

| file | old_ref | old_target | new_target | new_ref |
| --- | --- | --- | --- | --- |
| `scripts/generate-divisions.js` | `agents` | `agents` | `agents/catalog` | `agents/catalog` |
| `scripts/generate-divisions.js` | `workforce` | `workforce` | `agents/workforce` | `agents/workforce` |
| `scripts/phase10-a-probe.mjs` | `../rlm/kernel/index.js` | `rlm/kernel/index.js` | `runtime/rlm/kernel/index.js` | `../runtime/rlm/kernel/index.js` |
| `scripts/phase10-c-probe.mjs` | `../commands/refine.command.js` | `commands/refine.command.js` | `capabilities/commands/refine.command.js` | `../capabilities/commands/refine.command.js` |
| `scripts/phase10-d-probe.mjs` | `../rlm/daemon/index.js` | `rlm/daemon/index.js` | `runtime/rlm/daemon/index.js` | `../runtime/rlm/daemon/index.js` |
| `scripts/phase10-d-probe.mjs` | `../rlm/daemon/recovery.js` | `rlm/daemon/recovery.js` | `runtime/rlm/daemon/recovery.js` | `../runtime/rlm/daemon/recovery.js` |
| `scripts/phase10-e-probe.mjs` | `../workgraph/session/index.js` | `workgraph/session/index.js` | `runtime/workgraph/session/index.js` | `../runtime/workgraph/session/index.js` |
| `scripts/phase10-f-probe.mjs` | `../workforce/subagent/index.js` | `workforce/subagent/index.js` | `agents/workforce/subagent/index.js` | `../agents/workforce/subagent/index.js` |
| `scripts/phase10-g-probe.mjs` | `../commands/index.js` | `commands/index.js` | `capabilities/commands/index.js` | `../capabilities/commands/index.js` |
| `scripts/phase10-g-probe.mjs` | `../scheduler/autonomous/index.js` | `scheduler/autonomous/index.js` | `runtime/scheduler/autonomous/index.js` | `../runtime/scheduler/autonomous/index.js` |
| `scripts/phase10-g-probe.mjs` | `commands` | `commands` | `capabilities/commands` | `capabilities/commands` |
| `scripts/phase10-i-probe.mjs` | `context/offload/file.js` | `context/offload/file.js` | `runtime/context/offload/file.js` | `runtime/context/offload/file.js` |
| `scripts/phase10-i-probe.mjs` | `context/offload/history.js` | `context/offload/history.js` | `runtime/context/offload/history.js` | `runtime/context/offload/history.js` |
| `scripts/phase10-i-probe.mjs` | `workgraph/session/index.js` | `workgraph/session/index.js` | `runtime/workgraph/session/index.js` | `runtime/workgraph/session/index.js` |
| `scripts/phase10-j-probe.mjs` | `src/styles/jexi-theme.css` | `src/styles/jexi-theme.css` | `interfaces/console/styles/jexi-theme.css` | `interfaces/console/styles/jexi-theme.css` |
| `scripts/phase10-j-probe.mjs` | `ui/preview` | `ui/preview` | `interfaces/ui/preview` | `interfaces/ui/preview` |
| `scripts/phase10-j-probe.mjs` | `ui/preview/agents-view.html` | `ui/preview/agents-view.html` | `interfaces/ui/preview/agents-view.html` | `interfaces/ui/preview/agents-view.html` |
| `scripts/phase11-index.mjs` | `../capability/code/graph/index.js` | `capability/code/graph/index.js` | `capabilities/graph/code/graph/index.js` | `../capabilities/graph/code/graph/index.js` |
| `scripts/phase11-index.mjs` | `../capability/code/graph/store.js` | `capability/code/graph/store.js` | `capabilities/graph/code/graph/store.js` | `../capabilities/graph/code/graph/store.js` |
| `scripts/phase11-probe-a.mjs` | `../capability/code/graph/store.js` | `capability/code/graph/store.js` | `capabilities/graph/code/graph/store.js` | `../capabilities/graph/code/graph/store.js` |
| `scripts/phase11-probe-b.mjs` | `../tools/domains/lsp/_graph.js` | `tools/domains/lsp/_graph.js` | `capabilities/tools/domains/lsp/_graph.js` | `../capabilities/tools/domains/lsp/_graph.js` |
| `scripts/phase11-probe-b.mjs` | `../tools/domains/lsp/index.js` | `tools/domains/lsp/index.js` | `capabilities/tools/domains/lsp/index.js` | `../capabilities/tools/domains/lsp/index.js` |
| `scripts/phase11-probe-c.mjs` | `../kernel/daemon/client.js` | `kernel/daemon/client.js` | `runtime/kernel/daemon/client.js` | `../runtime/kernel/daemon/client.js` |
| `scripts/phase11-probe-d.mjs` | `../capability/internet/reach/channels/base.channel.js` | `capability/internet/reach/channels/base.channel.js` | `capabilities/graph/internet/reach/channels/base.channel.js` | `../capabilities/graph/internet/reach/channels/base.channel.js` |
| `scripts/phase11-probe-d.mjs` | `../capability/internet/reach/channels/index.js` | `capability/internet/reach/channels/index.js` | `capabilities/graph/internet/reach/channels/index.js` | `../capabilities/graph/internet/reach/channels/index.js` |
| `scripts/phase11-probe-d.mjs` | `../capability/internet/reach/channels/web.channel.js` | `capability/internet/reach/channels/web.channel.js` | `capabilities/graph/internet/reach/channels/web.channel.js` | `../capabilities/graph/internet/reach/channels/web.channel.js` |
| `scripts/phase11-probe-d.mjs` | `../capability/internet/reach/config.js` | `capability/internet/reach/config.js` | `capabilities/graph/internet/reach/config.js` | `../capabilities/graph/internet/reach/config.js` |
| `scripts/phase11-probe-d.mjs` | `../capability/internet/reach/core.js` | `capability/internet/reach/core.js` | `capabilities/graph/internet/reach/core.js` | `../capabilities/graph/internet/reach/core.js` |
| `scripts/phase11-probe-d.mjs` | `../capability/internet/reach/doctor.js` | `capability/internet/reach/doctor.js` | `capabilities/graph/internet/reach/doctor.js` | `../capabilities/graph/internet/reach/doctor.js` |
| `scripts/phase11-probe-d.mjs` | `capability/internet/reach/doctor.js` | `capability/internet/reach/doctor.js` | `capabilities/graph/internet/reach/doctor.js` | `capabilities/graph/internet/reach/doctor.js` |
| `scripts/phase11-probe-e.mjs` | `../capability/internet/reach/channels/index.js` | `capability/internet/reach/channels/index.js` | `capabilities/graph/internet/reach/channels/index.js` | `../capabilities/graph/internet/reach/channels/index.js` |
| `scripts/phase11-probe-e.mjs` | `../capability/internet/reach/config.js` | `capability/internet/reach/config.js` | `capabilities/graph/internet/reach/config.js` | `../capabilities/graph/internet/reach/config.js` |
| `scripts/phase11-probe-e.mjs` | `../capability/internet/reach/core.js` | `capability/internet/reach/core.js` | `capabilities/graph/internet/reach/core.js` | `../capabilities/graph/internet/reach/core.js` |
| `scripts/phase11-probe-e.mjs` | `../capability/internet/reach/doctor.js` | `capability/internet/reach/doctor.js` | `capabilities/graph/internet/reach/doctor.js` | `../capabilities/graph/internet/reach/doctor.js` |
| `scripts/phase11-probe-e.mjs` | `capability/internet/reach/doctor.js` | `capability/internet/reach/doctor.js` | `capabilities/graph/internet/reach/doctor.js` | `capabilities/graph/internet/reach/doctor.js` |
| `scripts/phase11-probe-f.mjs` | `../capability/internet/reach/channels/base.channel.js` | `capability/internet/reach/channels/base.channel.js` | `capabilities/graph/internet/reach/channels/base.channel.js` | `../capabilities/graph/internet/reach/channels/base.channel.js` |
| `scripts/phase11-probe-f.mjs` | `../capability/internet/reach/channels/index.js` | `capability/internet/reach/channels/index.js` | `capabilities/graph/internet/reach/channels/index.js` | `../capabilities/graph/internet/reach/channels/index.js` |
| `scripts/phase11-probe-f.mjs` | `../capability/internet/reach/config.js` | `capability/internet/reach/config.js` | `capabilities/graph/internet/reach/config.js` | `../capabilities/graph/internet/reach/config.js` |
| `scripts/phase11-probe-f.mjs` | `../capability/internet/reach/core.js` | `capability/internet/reach/core.js` | `capabilities/graph/internet/reach/core.js` | `../capabilities/graph/internet/reach/core.js` |
| `scripts/phase11-probe-g.mjs` | `capability/code/mcp-server.js` | `capability/code/mcp-server.js` | `capabilities/graph/code/mcp-server.js` | `capabilities/graph/code/mcp-server.js` |
| `scripts/phase11-probe-g.mjs` | `capability/internet/reach/mcp-server.js` | `capability/internet/reach/mcp-server.js` | `capabilities/graph/internet/reach/mcp-server.js` | `capabilities/graph/internet/reach/mcp-server.js` |
| `scripts/phase11-probe-h.mjs` | `capability/doctor/cli.js` | `capability/doctor/cli.js` | `capabilities/graph/doctor/cli.js` | `capabilities/graph/doctor/cli.js` |
| `scripts/phase11-probe-h.mjs` | `commands` | `commands` | `capabilities/commands` | `capabilities/commands` |
| `scripts/phase11-probe-h.mjs` | `commands/doctor.command.js` | `commands/doctor.command.js` | `capabilities/commands/doctor.command.js` | `capabilities/commands/doctor.command.js` |
| `scripts/phase11-probe-h.mjs` | `kernel/daemon/client.js` | `kernel/daemon/client.js` | `runtime/kernel/daemon/client.js` | `runtime/kernel/daemon/client.js` |
| `scripts/phase11-probe-h.mjs` | `tools/domains/lsp/index-repository.tool.js` | `tools/domains/lsp/index-repository.tool.js` | `capabilities/tools/domains/lsp/index-repository.tool.js` | `capabilities/tools/domains/lsp/index-repository.tool.js` |
| `scripts/phase11-probe-i.mjs` | `capability/code/graph-first.js` | `capability/code/graph-first.js` | `capabilities/graph/code/graph-first.js` | `capabilities/graph/code/graph-first.js` |
| `scripts/phase11-probe-i.mjs` | `capability/context-hook.js` | `capability/context-hook.js` | `capabilities/graph/context-hook.js` | `capabilities/graph/context-hook.js` |
| `scripts/phase13-scope-a.mjs` | `../workforce/agents/index.js` | `workforce/agents/index.js` | `agents/workforce/agents/index.js` | `../agents/workforce/agents/index.js` |
| `scripts/phase13-scope-b.mjs` | `../workforce/agents/index.js` | `workforce/agents/index.js` | `agents/workforce/agents/index.js` | `../agents/workforce/agents/index.js` |
| `scripts/phase13-scope-b.mjs` | `../workforce/divisions/index.js` | `workforce/divisions/index.js` | `agents/workforce/divisions/index.js` | `../agents/workforce/divisions/index.js` |
| `scripts/phase13-scope-c-fix-2.mjs` | `../workforce/agents/index.js` | `workforce/agents/index.js` | `agents/workforce/agents/index.js` | `../agents/workforce/agents/index.js` |
| `scripts/phase13-scope-c-fix-2.mjs` | `../workforce/nexus/index.js` | `workforce/nexus/index.js` | `agents/workforce/nexus/index.js` | `../agents/workforce/nexus/index.js` |
| `scripts/phase13-scope-c-fix-2.mjs` | `workforce/agents` | `workforce/agents` | `agents/workforce/agents` | `agents/workforce/agents` |
| `scripts/phase13-scope-c-fix-2.mjs` | `workforce/divisions.json` | `workforce/divisions.json` | `agents/workforce/divisions.json` | `agents/workforce/divisions.json` |
| `scripts/phase13-scope-c-fix-2.mjs` | `workforce/nexus/vendor/agency-agents.strategies.json` | `workforce/nexus/vendor/agency-agents.strategies.json` | `agents/workforce/nexus/vendor/agency-agents.strategies.json` | `agents/workforce/nexus/vendor/agency-agents.strategies.json` |
| `scripts/phase13-scope-c-fix.mjs` | `../workforce/nexus/index.js` | `workforce/nexus/index.js` | `agents/workforce/nexus/index.js` | `../agents/workforce/nexus/index.js` |
| `scripts/phase13-scope-c-fix.mjs` | `workforce/agents` | `workforce/agents` | `agents/workforce/agents` | `agents/workforce/agents` |
| `scripts/phase13-scope-c-fix.mjs` | `workforce/divisions.json` | `workforce/divisions.json` | `agents/workforce/divisions.json` | `agents/workforce/divisions.json` |
| `scripts/phase13-scope-c-fix.mjs` | `workforce/nexus/vendor/agency-agents.strategies.json` | `workforce/nexus/vendor/agency-agents.strategies.json` | `agents/workforce/nexus/vendor/agency-agents.strategies.json` | `agents/workforce/nexus/vendor/agency-agents.strategies.json` |
| `scripts/phase13-scope-c.mjs` | `../workforce/agents/index.js` | `workforce/agents/index.js` | `agents/workforce/agents/index.js` | `../agents/workforce/agents/index.js` |
| `scripts/phase13-scope-c.mjs` | `../workforce/nexus/index.js` | `workforce/nexus/index.js` | `agents/workforce/nexus/index.js` | `../agents/workforce/nexus/index.js` |
| `scripts/phase13-scope-d.mjs` | `../workforce/agents/index.js` | `workforce/agents/index.js` | `agents/workforce/agents/index.js` | `../agents/workforce/agents/index.js` |
| `scripts/phase13-scope-d.mjs` | `../workforce/identity/index.js` | `workforce/identity/index.js` | `agents/workforce/identity/index.js` | `../agents/workforce/identity/index.js` |
| `scripts/phase13-scope-e.mjs` | `../workforce/agents/index.js` | `workforce/agents/index.js` | `agents/workforce/agents/index.js` | `../agents/workforce/agents/index.js` |
| `scripts/phase13-scope-e.mjs` | `../workforce/nexus/strategy.js` | `workforce/nexus/strategy.js` | `agents/workforce/nexus/strategy.js` | `../agents/workforce/nexus/strategy.js` |
| `scripts/phase13-scope-e.mjs` | `../workforce/trust/index.js` | `workforce/trust/index.js` | `agents/workforce/trust/index.js` | `../agents/workforce/trust/index.js` |
| `scripts/phase13-scope-e.mjs` | `../workforce/trust/scoring.js` | `workforce/trust/scoring.js` | `agents/workforce/trust/scoring.js` | `../agents/workforce/trust/scoring.js` |
| `scripts/phase13-vendor-agency.mjs` | `../workforce/agents/capabilities.js` | `workforce/agents/capabilities.js` | `agents/workforce/agents/capabilities.js` | `../agents/workforce/agents/capabilities.js` |
| `scripts/phase13-vendor-agency.mjs` | `../workforce/agents/infer.js` | `workforce/agents/infer.js` | `agents/workforce/agents/infer.js` | `../agents/workforce/agents/infer.js` |
| `scripts/phase13-vendor-agency.mjs` | `workforce/agents/vendor/agency-agents.specs.json` | `workforce/agents/vendor/agency-agents.specs.json` | `agents/workforce/agents/vendor/agency-agents.specs.json` | `agents/workforce/agents/vendor/agency-agents.specs.json` |
| `scripts/phase13-vendor-nexus.mjs` | `workforce/nexus/vendor/agency-agents.strategies.json` | `workforce/nexus/vendor/agency-agents.strategies.json` | `agents/workforce/nexus/vendor/agency-agents.strategies.json` | `agents/workforce/nexus/vendor/agency-agents.strategies.json` |
| `scripts/phase14-a-probe.mjs` | `../semantica/graph/index.js` | `semantica/graph/index.js` | `services/semantica/graph/index.js` | `../services/semantica/graph/index.js` |
| `scripts/phase14-b-probe.mjs` | `../semantica/graph/index.js` | `semantica/graph/index.js` | `services/semantica/graph/index.js` | `../services/semantica/graph/index.js` |
| `scripts/phase14-b-probe.mjs` | `../semantica/provenance/index.js` | `semantica/provenance/index.js` | `services/semantica/provenance/index.js` | `../services/semantica/provenance/index.js` |
| `scripts/phase14-c-probe.mjs` | `../semantica/decisions/index.js` | `semantica/decisions/index.js` | `services/semantica/decisions/index.js` | `../services/semantica/decisions/index.js` |
| `scripts/phase14-c-probe.mjs` | `../semantica/provenance/index.js` | `semantica/provenance/index.js` | `services/semantica/provenance/index.js` | `../services/semantica/provenance/index.js` |
| `scripts/phase14-d-probe.mjs` | `../semantica/ontology/index.js` | `semantica/ontology/index.js` | `services/semantica/ontology/index.js` | `../services/semantica/ontology/index.js` |
| `scripts/phase14-d-probe.mjs` | `../semantica/provenance/index.js` | `semantica/provenance/index.js` | `services/semantica/provenance/index.js` | `../services/semantica/provenance/index.js` |
| `scripts/phase14-e-probe.mjs` | `../semantica/graph/index.js` | `semantica/graph/index.js` | `services/semantica/graph/index.js` | `../services/semantica/graph/index.js` |
| `scripts/phase14-e-probe.mjs` | `../semantica/provenance/index.js` | `semantica/provenance/index.js` | `services/semantica/provenance/index.js` | `../services/semantica/provenance/index.js` |
| `scripts/phase14-e-probe.mjs` | `../semantica/reasoning/index.js` | `semantica/reasoning/index.js` | `services/semantica/reasoning/index.js` | `../services/semantica/reasoning/index.js` |
| `scripts/phase14-f-probe.mjs` | `../semantica/repo-map/index.js` | `semantica/repo-map/index.js` | `services/semantica/repo-map/index.js` | `../services/semantica/repo-map/index.js` |
| `scripts/phase15-a-probe.mjs` | `../omnia/vault/index.js` | `omnia/vault/index.js` | `services/omnia/vault/index.js` | `../services/omnia/vault/index.js` |
| `scripts/phase15-b-probe.mjs` | `../omnia/relay/index.js` | `omnia/relay/index.js` | `services/omnia/relay/index.js` | `../services/omnia/relay/index.js` |
| `scripts/phase15-c-probe.mjs` | `../omnia/council/index.js` | `omnia/council/index.js` | `services/omnia/council/index.js` | `../services/omnia/council/index.js` |
| `scripts/phase15-d-probe.mjs` | `../evomap/gep/index.js` | `evomap/gep/index.js` | `services/evomap/gep/index.js` | `../services/evomap/gep/index.js` |
| `scripts/phase15-e-probe.mjs` | `../evomap/index.js` | `evomap/index.js` | `services/evomap/index.js` | `../services/evomap/index.js` |
| `scripts/phase16-a-probe.mjs` | `../events/chat/taxonomy.js` | `events/chat/taxonomy.js` | `runtime/events/chat/taxonomy.js` | `../runtime/events/chat/taxonomy.js` |
| `scripts/phase16-b-probe.mjs` | `../events/chat/taxonomy.js` | `events/chat/taxonomy.js` | `runtime/events/chat/taxonomy.js` | `../runtime/events/chat/taxonomy.js` |
| `scripts/phase16-b-probe.mjs` | `../workforce/narration/index.js` | `workforce/narration/index.js` | `agents/workforce/narration/index.js` | `../agents/workforce/narration/index.js` |
| `scripts/phase16-c-probe.mjs` | `../events/chat/taxonomy.js` | `events/chat/taxonomy.js` | `runtime/events/chat/taxonomy.js` | `../runtime/events/chat/taxonomy.js` |
| `scripts/phase16-c-probe.mjs` | `../ui/web/console/chat/rows/index.js` | `ui/web/console/chat/rows/index.js` | `interfaces/ui/web/console/chat/rows/index.js` | `../interfaces/ui/web/console/chat/rows/index.js` |
| `scripts/phase16-d-probe.mjs` | `../ui/web/console/chat/progress-draft.js` | `ui/web/console/chat/progress-draft.js` | `interfaces/ui/web/console/chat/progress-draft.js` | `../interfaces/ui/web/console/chat/progress-draft.js` |
| `scripts/phase16-e-probe.mjs` | `../ui/web/console/chat/dual-pane.js` | `ui/web/console/chat/dual-pane.js` | `interfaces/ui/web/console/chat/dual-pane.js` | `../interfaces/ui/web/console/chat/dual-pane.js` |
| `scripts/phase16-f-probe.mjs` | `../ui/web/console/chat/disclosure.js` | `ui/web/console/chat/disclosure.js` | `interfaces/ui/web/console/chat/disclosure.js` | `../interfaces/ui/web/console/chat/disclosure.js` |
| `scripts/phase16-g-probe.mjs` | `../events/chat/taxonomy.js` | `events/chat/taxonomy.js` | `runtime/events/chat/taxonomy.js` | `../runtime/events/chat/taxonomy.js` |
| `scripts/phase16-g-probe.mjs` | `../ui/web/console/chat/approvals.js` | `ui/web/console/chat/approvals.js` | `interfaces/ui/web/console/chat/approvals.js` | `../interfaces/ui/web/console/chat/approvals.js` |
| `scripts/phase16-h-probe.mjs` | `../ui/web/console/chat/modes.js` | `ui/web/console/chat/modes.js` | `interfaces/ui/web/console/chat/modes.js` | `../interfaces/ui/web/console/chat/modes.js` |
| `scripts/phase16-h-probe.mjs` | `../ui/web/console/chat/rows/index.js` | `ui/web/console/chat/rows/index.js` | `interfaces/ui/web/console/chat/rows/index.js` | `../interfaces/ui/web/console/chat/rows/index.js` |
| `scripts/phase16-i-probe.mjs` | `../events/chat/taxonomy.js` | `events/chat/taxonomy.js` | `runtime/events/chat/taxonomy.js` | `../runtime/events/chat/taxonomy.js` |
| `scripts/phase16-i-probe.mjs` | `../ui/web/console/chat/modes.js` | `ui/web/console/chat/modes.js` | `interfaces/ui/web/console/chat/modes.js` | `../interfaces/ui/web/console/chat/modes.js` |
| `scripts/phase16-i-probe.mjs` | `../ui/web/console/chat/router.js` | `ui/web/console/chat/router.js` | `interfaces/ui/web/console/chat/router.js` | `../interfaces/ui/web/console/chat/router.js` |
| `scripts/phase16-j-probe.mjs` | `../ui/web/console/chat/approvals.js` | `ui/web/console/chat/approvals.js` | `interfaces/ui/web/console/chat/approvals.js` | `../interfaces/ui/web/console/chat/approvals.js` |
| `scripts/phase16-j-probe.mjs` | `../ui/web/console/chat/modes.js` | `ui/web/console/chat/modes.js` | `interfaces/ui/web/console/chat/modes.js` | `../interfaces/ui/web/console/chat/modes.js` |
| `scripts/phase16-j-probe.mjs` | `../ui/web/console/chat/progress-draft.js` | `ui/web/console/chat/progress-draft.js` | `interfaces/ui/web/console/chat/progress-draft.js` | `../interfaces/ui/web/console/chat/progress-draft.js` |
| `scripts/phase16-j-probe.mjs` | `../ui/web/console/chat/router.js` | `ui/web/console/chat/router.js` | `interfaces/ui/web/console/chat/router.js` | `../interfaces/ui/web/console/chat/router.js` |
| `scripts/phase16-j-probe.mjs` | `../ui/web/console/chat/runtime.js` | `ui/web/console/chat/runtime.js` | `interfaces/ui/web/console/chat/runtime.js` | `../interfaces/ui/web/console/chat/runtime.js` |
| `scripts/phase16-k-probe.mjs` | `../events/chat/taxonomy.js` | `events/chat/taxonomy.js` | `runtime/events/chat/taxonomy.js` | `../runtime/events/chat/taxonomy.js` |
| `scripts/phase16-k-probe.mjs` | `../ui/web/console/chat/approvals.js` | `ui/web/console/chat/approvals.js` | `interfaces/ui/web/console/chat/approvals.js` | `../interfaces/ui/web/console/chat/approvals.js` |
| `scripts/phase16-k-probe.mjs` | `../ui/web/console/chat/modes.js` | `ui/web/console/chat/modes.js` | `interfaces/ui/web/console/chat/modes.js` | `../interfaces/ui/web/console/chat/modes.js` |
| `scripts/phase16-k-probe.mjs` | `../ui/web/console/chat/progress-draft.js` | `ui/web/console/chat/progress-draft.js` | `interfaces/ui/web/console/chat/progress-draft.js` | `../interfaces/ui/web/console/chat/progress-draft.js` |
| `scripts/phase16-k-probe.mjs` | `../ui/web/console/chat/router.js` | `ui/web/console/chat/router.js` | `interfaces/ui/web/console/chat/router.js` | `../interfaces/ui/web/console/chat/router.js` |
| `scripts/phase16-k-probe.mjs` | `../ui/web/console/chat/runtime.js` | `ui/web/console/chat/runtime.js` | `interfaces/ui/web/console/chat/runtime.js` | `../interfaces/ui/web/console/chat/runtime.js` |
| `scripts/phase16-k-probe.mjs` | `../ui/web/console/chat/toolcards.js` | `ui/web/console/chat/toolcards.js` | `interfaces/ui/web/console/chat/toolcards.js` | `../interfaces/ui/web/console/chat/toolcards.js` |
| `scripts/phase16-l-probe.mjs` | `../events/chat/taxonomy.js` | `events/chat/taxonomy.js` | `runtime/events/chat/taxonomy.js` | `../runtime/events/chat/taxonomy.js` |
| `scripts/phase16-l-probe.mjs` | `../ui/web/console/chat/approvals.js` | `ui/web/console/chat/approvals.js` | `interfaces/ui/web/console/chat/approvals.js` | `../interfaces/ui/web/console/chat/approvals.js` |
| `scripts/phase16-l-probe.mjs` | `../ui/web/console/chat/artifacts.js` | `ui/web/console/chat/artifacts.js` | `interfaces/ui/web/console/chat/artifacts.js` | `../interfaces/ui/web/console/chat/artifacts.js` |
| `scripts/phase16-l-probe.mjs` | `../ui/web/console/chat/modes.js` | `ui/web/console/chat/modes.js` | `interfaces/ui/web/console/chat/modes.js` | `../interfaces/ui/web/console/chat/modes.js` |
| `scripts/phase16-l-probe.mjs` | `../ui/web/console/chat/progress-draft.js` | `ui/web/console/chat/progress-draft.js` | `interfaces/ui/web/console/chat/progress-draft.js` | `../interfaces/ui/web/console/chat/progress-draft.js` |
| `scripts/phase16-l-probe.mjs` | `../ui/web/console/chat/router.js` | `ui/web/console/chat/router.js` | `interfaces/ui/web/console/chat/router.js` | `../interfaces/ui/web/console/chat/router.js` |
| `scripts/phase16-l-probe.mjs` | `../ui/web/console/chat/runtime.js` | `ui/web/console/chat/runtime.js` | `interfaces/ui/web/console/chat/runtime.js` | `../interfaces/ui/web/console/chat/runtime.js` |
| `scripts/phase16-l-probe.mjs` | `../ui/web/console/chat/toolcards.js` | `ui/web/console/chat/toolcards.js` | `interfaces/ui/web/console/chat/toolcards.js` | `../interfaces/ui/web/console/chat/toolcards.js` |
| `scripts/phase16-l-shots.mjs` | `../ui/web/console/chat/approvals.js` | `ui/web/console/chat/approvals.js` | `interfaces/ui/web/console/chat/approvals.js` | `../interfaces/ui/web/console/chat/approvals.js` |
| `scripts/phase16-l-shots.mjs` | `../ui/web/console/chat/artifacts.js` | `ui/web/console/chat/artifacts.js` | `interfaces/ui/web/console/chat/artifacts.js` | `../interfaces/ui/web/console/chat/artifacts.js` |
| `scripts/phase16-l-shots.mjs` | `../ui/web/console/chat/modes.js` | `ui/web/console/chat/modes.js` | `interfaces/ui/web/console/chat/modes.js` | `../interfaces/ui/web/console/chat/modes.js` |
| `scripts/phase16-l-shots.mjs` | `../ui/web/console/chat/progress-draft.js` | `ui/web/console/chat/progress-draft.js` | `interfaces/ui/web/console/chat/progress-draft.js` | `../interfaces/ui/web/console/chat/progress-draft.js` |
| `scripts/phase16-l-shots.mjs` | `../ui/web/console/chat/router.js` | `ui/web/console/chat/router.js` | `interfaces/ui/web/console/chat/router.js` | `../interfaces/ui/web/console/chat/router.js` |
| `scripts/phase16-l-shots.mjs` | `../ui/web/console/chat/runtime.js` | `ui/web/console/chat/runtime.js` | `interfaces/ui/web/console/chat/runtime.js` | `../interfaces/ui/web/console/chat/runtime.js` |
| `scripts/phase16-l-shots.mjs` | `../ui/web/console/chat/toolcards.js` | `ui/web/console/chat/toolcards.js` | `interfaces/ui/web/console/chat/toolcards.js` | `../interfaces/ui/web/console/chat/toolcards.js` |
| `scripts/phase16-m-probe.mjs` | `../events/chat/taxonomy.js` | `events/chat/taxonomy.js` | `runtime/events/chat/taxonomy.js` | `../runtime/events/chat/taxonomy.js` |
| `scripts/phase16-m-probe.mjs` | `../ui/web/console/chat/approvals.js` | `ui/web/console/chat/approvals.js` | `interfaces/ui/web/console/chat/approvals.js` | `../interfaces/ui/web/console/chat/approvals.js` |
| `scripts/phase16-m-probe.mjs` | `../ui/web/console/chat/modes.js` | `ui/web/console/chat/modes.js` | `interfaces/ui/web/console/chat/modes.js` | `../interfaces/ui/web/console/chat/modes.js` |
| `scripts/phase16-m-probe.mjs` | `../ui/web/console/chat/progress-draft.js` | `ui/web/console/chat/progress-draft.js` | `interfaces/ui/web/console/chat/progress-draft.js` | `../interfaces/ui/web/console/chat/progress-draft.js` |
| `scripts/phase16-m-probe.mjs` | `../ui/web/console/chat/queue.js` | `ui/web/console/chat/queue.js` | `interfaces/ui/web/console/chat/queue.js` | `../interfaces/ui/web/console/chat/queue.js` |
| `scripts/phase16-m-probe.mjs` | `../ui/web/console/chat/router.js` | `ui/web/console/chat/router.js` | `interfaces/ui/web/console/chat/router.js` | `../interfaces/ui/web/console/chat/router.js` |
| `scripts/phase16-m-probe.mjs` | `../ui/web/console/chat/runtime.js` | `ui/web/console/chat/runtime.js` | `interfaces/ui/web/console/chat/runtime.js` | `../interfaces/ui/web/console/chat/runtime.js` |
| `scripts/phase16-m-probe.mjs` | `../ui/web/console/chat/steer.js` | `ui/web/console/chat/steer.js` | `interfaces/ui/web/console/chat/steer.js` | `../interfaces/ui/web/console/chat/steer.js` |
| `scripts/phase16-m-shots.mjs` | `../ui/web/console/chat/approvals.js` | `ui/web/console/chat/approvals.js` | `interfaces/ui/web/console/chat/approvals.js` | `../interfaces/ui/web/console/chat/approvals.js` |
| `scripts/phase16-m-shots.mjs` | `../ui/web/console/chat/modes.js` | `ui/web/console/chat/modes.js` | `interfaces/ui/web/console/chat/modes.js` | `../interfaces/ui/web/console/chat/modes.js` |
| `scripts/phase16-m-shots.mjs` | `../ui/web/console/chat/progress-draft.js` | `ui/web/console/chat/progress-draft.js` | `interfaces/ui/web/console/chat/progress-draft.js` | `../interfaces/ui/web/console/chat/progress-draft.js` |
| `scripts/phase16-m-shots.mjs` | `../ui/web/console/chat/queue.js` | `ui/web/console/chat/queue.js` | `interfaces/ui/web/console/chat/queue.js` | `../interfaces/ui/web/console/chat/queue.js` |
| `scripts/phase16-m-shots.mjs` | `../ui/web/console/chat/router.js` | `ui/web/console/chat/router.js` | `interfaces/ui/web/console/chat/router.js` | `../interfaces/ui/web/console/chat/router.js` |
| `scripts/phase16-m-shots.mjs` | `../ui/web/console/chat/runtime.js` | `ui/web/console/chat/runtime.js` | `interfaces/ui/web/console/chat/runtime.js` | `../interfaces/ui/web/console/chat/runtime.js` |
| `scripts/phase16-m-shots.mjs` | `../ui/web/console/chat/steer.js` | `ui/web/console/chat/steer.js` | `interfaces/ui/web/console/chat/steer.js` | `../interfaces/ui/web/console/chat/steer.js` |
| `scripts/phase16-n-probe.mjs` | `../events/chat/taxonomy.js` | `events/chat/taxonomy.js` | `runtime/events/chat/taxonomy.js` | `../runtime/events/chat/taxonomy.js` |
| `scripts/phase16-n-probe.mjs` | `../ui/web/console/chat/approvals.js` | `ui/web/console/chat/approvals.js` | `interfaces/ui/web/console/chat/approvals.js` | `../interfaces/ui/web/console/chat/approvals.js` |
| `scripts/phase16-n-probe.mjs` | `../ui/web/console/chat/checkpoints.js` | `ui/web/console/chat/checkpoints.js` | `interfaces/ui/web/console/chat/checkpoints.js` | `../interfaces/ui/web/console/chat/checkpoints.js` |
| `scripts/phase16-n-probe.mjs` | `../ui/web/console/chat/modes.js` | `ui/web/console/chat/modes.js` | `interfaces/ui/web/console/chat/modes.js` | `../interfaces/ui/web/console/chat/modes.js` |
| `scripts/phase16-n-probe.mjs` | `../ui/web/console/chat/progress-draft.js` | `ui/web/console/chat/progress-draft.js` | `interfaces/ui/web/console/chat/progress-draft.js` | `../interfaces/ui/web/console/chat/progress-draft.js` |
| `scripts/phase16-n-probe.mjs` | `../ui/web/console/chat/queue.js` | `ui/web/console/chat/queue.js` | `interfaces/ui/web/console/chat/queue.js` | `../interfaces/ui/web/console/chat/queue.js` |
| `scripts/phase16-n-probe.mjs` | `../ui/web/console/chat/router.js` | `ui/web/console/chat/router.js` | `interfaces/ui/web/console/chat/router.js` | `../interfaces/ui/web/console/chat/router.js` |
| `scripts/phase16-n-probe.mjs` | `../ui/web/console/chat/runtime.js` | `ui/web/console/chat/runtime.js` | `interfaces/ui/web/console/chat/runtime.js` | `../interfaces/ui/web/console/chat/runtime.js` |
| `scripts/phase16-n-probe.mjs` | `../ui/web/console/chat/steer.js` | `ui/web/console/chat/steer.js` | `interfaces/ui/web/console/chat/steer.js` | `../interfaces/ui/web/console/chat/steer.js` |
| `scripts/phase16-n-shots.mjs` | `../ui/web/console/chat/approvals.js` | `ui/web/console/chat/approvals.js` | `interfaces/ui/web/console/chat/approvals.js` | `../interfaces/ui/web/console/chat/approvals.js` |
| `scripts/phase16-n-shots.mjs` | `../ui/web/console/chat/checkpoints.js` | `ui/web/console/chat/checkpoints.js` | `interfaces/ui/web/console/chat/checkpoints.js` | `../interfaces/ui/web/console/chat/checkpoints.js` |
| `scripts/phase16-n-shots.mjs` | `../ui/web/console/chat/modes.js` | `ui/web/console/chat/modes.js` | `interfaces/ui/web/console/chat/modes.js` | `../interfaces/ui/web/console/chat/modes.js` |
| `scripts/phase16-n-shots.mjs` | `../ui/web/console/chat/progress-draft.js` | `ui/web/console/chat/progress-draft.js` | `interfaces/ui/web/console/chat/progress-draft.js` | `../interfaces/ui/web/console/chat/progress-draft.js` |
| `scripts/phase16-n-shots.mjs` | `../ui/web/console/chat/queue.js` | `ui/web/console/chat/queue.js` | `interfaces/ui/web/console/chat/queue.js` | `../interfaces/ui/web/console/chat/queue.js` |
| `scripts/phase16-n-shots.mjs` | `../ui/web/console/chat/router.js` | `ui/web/console/chat/router.js` | `interfaces/ui/web/console/chat/router.js` | `../interfaces/ui/web/console/chat/router.js` |
| `scripts/phase16-n-shots.mjs` | `../ui/web/console/chat/runtime.js` | `ui/web/console/chat/runtime.js` | `interfaces/ui/web/console/chat/runtime.js` | `../interfaces/ui/web/console/chat/runtime.js` |
| `scripts/phase16-n-shots.mjs` | `../ui/web/console/chat/steer.js` | `ui/web/console/chat/steer.js` | `interfaces/ui/web/console/chat/steer.js` | `../interfaces/ui/web/console/chat/steer.js` |
| `scripts/phase16-o-probe.mjs` | `../ui/web/console/chat/approvals.js` | `ui/web/console/chat/approvals.js` | `interfaces/ui/web/console/chat/approvals.js` | `../interfaces/ui/web/console/chat/approvals.js` |
| `scripts/phase16-o-probe.mjs` | `../ui/web/console/chat/checkpoints.js` | `ui/web/console/chat/checkpoints.js` | `interfaces/ui/web/console/chat/checkpoints.js` | `../interfaces/ui/web/console/chat/checkpoints.js` |
| `scripts/phase16-o-probe.mjs` | `../ui/web/console/chat/modes.js` | `ui/web/console/chat/modes.js` | `interfaces/ui/web/console/chat/modes.js` | `../interfaces/ui/web/console/chat/modes.js` |
| `scripts/phase16-o-probe.mjs` | `../ui/web/console/chat/multiagent.js` | `ui/web/console/chat/multiagent.js` | `interfaces/ui/web/console/chat/multiagent.js` | `../interfaces/ui/web/console/chat/multiagent.js` |
| `scripts/phase16-o-probe.mjs` | `../ui/web/console/chat/progress-draft.js` | `ui/web/console/chat/progress-draft.js` | `interfaces/ui/web/console/chat/progress-draft.js` | `../interfaces/ui/web/console/chat/progress-draft.js` |
| `scripts/phase16-o-probe.mjs` | `../ui/web/console/chat/queue.js` | `ui/web/console/chat/queue.js` | `interfaces/ui/web/console/chat/queue.js` | `../interfaces/ui/web/console/chat/queue.js` |
| `scripts/phase16-o-probe.mjs` | `../ui/web/console/chat/router.js` | `ui/web/console/chat/router.js` | `interfaces/ui/web/console/chat/router.js` | `../interfaces/ui/web/console/chat/router.js` |
| `scripts/phase16-o-probe.mjs` | `../ui/web/console/chat/runtime.js` | `ui/web/console/chat/runtime.js` | `interfaces/ui/web/console/chat/runtime.js` | `../interfaces/ui/web/console/chat/runtime.js` |
| `scripts/phase16-o-probe.mjs` | `../ui/web/console/chat/steer.js` | `ui/web/console/chat/steer.js` | `interfaces/ui/web/console/chat/steer.js` | `../interfaces/ui/web/console/chat/steer.js` |
| `scripts/phase16-o-shots.mjs` | `../ui/web/console/chat/modes.js` | `ui/web/console/chat/modes.js` | `interfaces/ui/web/console/chat/modes.js` | `../interfaces/ui/web/console/chat/modes.js` |
| `scripts/phase16-o-shots.mjs` | `../ui/web/console/chat/multiagent.js` | `ui/web/console/chat/multiagent.js` | `interfaces/ui/web/console/chat/multiagent.js` | `../interfaces/ui/web/console/chat/multiagent.js` |
| `scripts/phase16-o-shots.mjs` | `../ui/web/console/chat/router.js` | `ui/web/console/chat/router.js` | `interfaces/ui/web/console/chat/router.js` | `../interfaces/ui/web/console/chat/router.js` |
| `scripts/phase16-o-shots.mjs` | `../ui/web/console/chat/runtime.js` | `ui/web/console/chat/runtime.js` | `interfaces/ui/web/console/chat/runtime.js` | `../interfaces/ui/web/console/chat/runtime.js` |
| `scripts/phase17-a-probe.mjs` | `../runtimes/browser/index.js` | `runtimes/browser/index.js` | `runtime/runtimes/browser/index.js` | `../runtime/runtimes/browser/index.js` |
| `scripts/phase17-a-probe.mjs` | `../runtimes/browser/stealth.js` | `runtimes/browser/stealth.js` | `runtime/runtimes/browser/stealth.js` | `../runtime/runtimes/browser/stealth.js` |
| `scripts/phase17-b-probe.mjs` | `../runtimes/browser/actions/index.js` | `runtimes/browser/actions/index.js` | `runtime/runtimes/browser/actions/index.js` | `../runtime/runtimes/browser/actions/index.js` |
| `scripts/phase17-b-probe.mjs` | `../runtimes/browser/agent-loop.js` | `runtimes/browser/agent-loop.js` | `runtime/runtimes/browser/agent-loop.js` | `../runtime/runtimes/browser/agent-loop.js` |
| `scripts/phase17-b-probe.mjs` | `../runtimes/browser/cdp.js` | `runtimes/browser/cdp.js` | `runtime/runtimes/browser/cdp.js` | `../runtime/runtimes/browser/cdp.js` |
| `scripts/phase17-b-probe.mjs` | `../runtimes/browser/dom-service.js` | `runtimes/browser/dom-service.js` | `runtime/runtimes/browser/dom-service.js` | `../runtime/runtimes/browser/dom-service.js` |
| `scripts/phase17-b-probe.mjs` | `../runtimes/browser/index.js` | `runtimes/browser/index.js` | `runtime/runtimes/browser/index.js` | `../runtime/runtimes/browser/index.js` |
| `scripts/phase17-c-probe.mjs` | `../runtimes/browser/actions/index.js` | `runtimes/browser/actions/index.js` | `runtime/runtimes/browser/actions/index.js` | `../runtime/runtimes/browser/actions/index.js` |
| `scripts/phase17-c-probe.mjs` | `../runtimes/browser/agent-loop.js` | `runtimes/browser/agent-loop.js` | `runtime/runtimes/browser/agent-loop.js` | `../runtime/runtimes/browser/agent-loop.js` |
| `scripts/phase17-c-probe.mjs` | `../runtimes/browser/cdp.js` | `runtimes/browser/cdp.js` | `runtime/runtimes/browser/cdp.js` | `../runtime/runtimes/browser/cdp.js` |
| `scripts/phase17-c-probe.mjs` | `../runtimes/browser/dom-service.js` | `runtimes/browser/dom-service.js` | `runtime/runtimes/browser/dom-service.js` | `../runtime/runtimes/browser/dom-service.js` |
| `scripts/phase17-c-probe.mjs` | `../runtimes/browser/vision/index.js` | `runtimes/browser/vision/index.js` | `runtime/runtimes/browser/vision/index.js` | `../runtime/runtimes/browser/vision/index.js` |
| `scripts/phase17-d-probe.mjs` | `../memory/confidence.js` | `memory/confidence.js` | `mind/memory/confidence.js` | `../mind/memory/confidence.js` |
| `scripts/phase17-d-probe.mjs` | `../memory/hybrid-search.js` | `memory/hybrid-search.js` | `mind/memory/hybrid-search.js` | `../mind/memory/hybrid-search.js` |
| `scripts/phase17-d-probe.mjs` | `../memory/knowledge-graph.js` | `memory/knowledge-graph.js` | `mind/memory/knowledge-graph.js` | `../mind/memory/knowledge-graph.js` |
| `scripts/phase17-d-probe.mjs` | `../memory/lifecycle.js` | `memory/lifecycle.js` | `mind/memory/lifecycle.js` | `../mind/memory/lifecycle.js` |
| `scripts/phase17-e-probe.mjs` | `../context/viking/compile.js` | `context/viking/compile.js` | `runtime/context/viking/compile.js` | `../runtime/context/viking/compile.js` |
| `scripts/phase17-e-probe.mjs` | `../context/viking/filesystem.js` | `context/viking/filesystem.js` | `runtime/context/viking/filesystem.js` | `../runtime/context/viking/filesystem.js` |
| `scripts/phase17-e-probe.mjs` | `../context/viking/layers.js` | `context/viking/layers.js` | `runtime/context/viking/layers.js` | `../runtime/context/viking/layers.js` |
| `scripts/phase17-e-probe.mjs` | `../context/viking/session.js` | `context/viking/session.js` | `runtime/context/viking/session.js` | `../runtime/context/viking/session.js` |
| `scripts/phase17-e-probe.mjs` | `../context/viking/uri.js` | `context/viking/uri.js` | `runtime/context/viking/uri.js` | `../runtime/context/viking/uri.js` |
| `scripts/phase19-scope-a.mjs` | `../surfsense/connectors/_connector.js` | `surfsense/connectors/_connector.js` | `services/surfsense/connectors/_connector.js` | `../services/surfsense/connectors/_connector.js` |
| `scripts/phase19-scope-a.mjs` | `../surfsense/connectors/index.js` | `surfsense/connectors/index.js` | `services/surfsense/connectors/index.js` | `../services/surfsense/connectors/index.js` |
| `scripts/phase19-scope-b.mjs` | `../capability/rag/graph-rag.js` | `capability/rag/graph-rag.js` | `capabilities/graph/rag/graph-rag.js` | `../capabilities/graph/rag/graph-rag.js` |
| `scripts/phase19-scope-b.mjs` | `../surfsense/connectors/_internal.js` | `surfsense/connectors/_internal.js` | `services/surfsense/connectors/_internal.js` | `../services/surfsense/connectors/_internal.js` |
| `scripts/phase19-scope-b.mjs` | `../surfsense/search/index.js` | `surfsense/search/index.js` | `services/surfsense/search/index.js` | `../services/surfsense/search/index.js` |
| `scripts/phase19-scope-c.mjs` | `../surfsense/connectors/_internal.js` | `surfsense/connectors/_internal.js` | `services/surfsense/connectors/_internal.js` | `../services/surfsense/connectors/_internal.js` |
| `scripts/phase19-scope-c.mjs` | `../surfsense/output/index.js` | `surfsense/output/index.js` | `services/surfsense/output/index.js` | `../services/surfsense/output/index.js` |
| `scripts/phase19-scope-c.mjs` | `../surfsense/search/index.js` | `surfsense/search/index.js` | `services/surfsense/search/index.js` | `../services/surfsense/search/index.js` |
| `scripts/phase19-scope-d.mjs` | `../surfsense/connectors/_internal.js` | `surfsense/connectors/_internal.js` | `services/surfsense/connectors/_internal.js` | `../services/surfsense/connectors/_internal.js` |
| `scripts/phase19-scope-d.mjs` | `../surfsense/podcast/index.js` | `surfsense/podcast/index.js` | `services/surfsense/podcast/index.js` | `../services/surfsense/podcast/index.js` |
| `scripts/phase20-scope-a.mjs` | `../swarm/topologies/_internal.js` | `swarm/topologies/_internal.js` | `agents/swarm/topologies/_internal.js` | `../agents/swarm/topologies/_internal.js` |
| `scripts/phase20-scope-a.mjs` | `../swarm/topologies/index.js` | `swarm/topologies/index.js` | `agents/swarm/topologies/index.js` | `../agents/swarm/topologies/index.js` |
| `scripts/phase20-scope-b.mjs` | `../swarm/hive/index.js` | `swarm/hive/index.js` | `agents/swarm/hive/index.js` | `../agents/swarm/hive/index.js` |
| `scripts/phase20-scope-b.mjs` | `../swarm/topologies/_internal.js` | `swarm/topologies/_internal.js` | `agents/swarm/topologies/_internal.js` | `../agents/swarm/topologies/_internal.js` |
| `scripts/phase20-scope-c.mjs` | `../swarm/consensus/_internal.js` | `swarm/consensus/_internal.js` | `agents/swarm/consensus/_internal.js` | `../agents/swarm/consensus/_internal.js` |
| `scripts/phase20-scope-c.mjs` | `../swarm/consensus/index.js` | `swarm/consensus/index.js` | `agents/swarm/consensus/index.js` | `../agents/swarm/consensus/index.js` |
| `scripts/phase20-scope-d.mjs` | `../swarm/loops/looper.js` | `swarm/loops/looper.js` | `agents/swarm/loops/looper.js` | `../agents/swarm/loops/looper.js` |
| `scripts/phase20-scope-d.mjs` | `../swarm/topologies/_internal.js` | `swarm/topologies/_internal.js` | `agents/swarm/topologies/_internal.js` | `../agents/swarm/topologies/_internal.js` |
| `scripts/phase20-scope-e.mjs` | `../swarm/loops/clotho.js` | `swarm/loops/clotho.js` | `agents/swarm/loops/clotho.js` | `../agents/swarm/loops/clotho.js` |
| `scripts/phase20-scope-e.mjs` | `../swarm/topologies/_internal.js` | `swarm/topologies/_internal.js` | `agents/swarm/topologies/_internal.js` | `../agents/swarm/topologies/_internal.js` |
| `scripts/phase20-scope-f.mjs` | `../swarm/loops/ralph.js` | `swarm/loops/ralph.js` | `agents/swarm/loops/ralph.js` | `../agents/swarm/loops/ralph.js` |
| `scripts/phase20-scope-f.mjs` | `../swarm/topologies/_internal.js` | `swarm/topologies/_internal.js` | `agents/swarm/topologies/_internal.js` | `../agents/swarm/topologies/_internal.js` |
| `scripts/phase21-a-loop.mjs` | `../research/loop/experiment-loop.js` | `research/loop/experiment-loop.js` | `services/research/loop/experiment-loop.js` | `../services/research/loop/experiment-loop.js` |
| `scripts/phase21-a-loop.mjs` | `../research/loop/lifecycle.js` | `research/loop/lifecycle.js` | `services/research/loop/lifecycle.js` | `../services/research/loop/lifecycle.js` |
| `scripts/phase21-a-loop.mjs` | `../research/loop/scheduler.js` | `research/loop/scheduler.js` | `services/research/loop/scheduler.js` | `../services/research/loop/scheduler.js` |
| `scripts/phase21-b-constraints.mjs` | `../research/constraints/guards.js` | `research/constraints/guards.js` | `services/research/constraints/guards.js` | `../services/research/constraints/guards.js` |
| `scripts/phase21-b-constraints.mjs` | `../research/constraints/mutable.js` | `research/constraints/mutable.js` | `services/research/constraints/mutable.js` | `../services/research/constraints/mutable.js` |
| `scripts/phase21-b-constraints.mjs` | `../research/constraints/read-only.js` | `research/constraints/read-only.js` | `services/research/constraints/read-only.js` | `../services/research/constraints/read-only.js` |
| `scripts/phase21-c-program.mjs` | `../research/constraints/guards.js` | `research/constraints/guards.js` | `services/research/constraints/guards.js` | `../services/research/constraints/guards.js` |
| `scripts/phase21-c-program.mjs` | `../research/program/load.js` | `research/program/load.js` | `services/research/program/load.js` | `../services/research/program/load.js` |
| `scripts/phase21-d-budget.mjs` | `../research/budget/cost.js` | `research/budget/cost.js` | `services/research/budget/cost.js` | `../services/research/budget/cost.js` |
| `scripts/phase21-d-budget.mjs` | `../research/budget/wall-clock.js` | `research/budget/wall-clock.js` | `services/research/budget/wall-clock.js` | `../services/research/budget/wall-clock.js` |
| `scripts/phase21-e-tracking.mjs` | `../research/tracking/dual.js` | `research/tracking/dual.js` | `services/research/tracking/dual.js` | `../services/research/tracking/dual.js` |
| `scripts/phase21-f-workgraph.mjs` | `../research/workgraph/experiment-node.js` | `research/workgraph/experiment-node.js` | `services/research/workgraph/experiment-node.js` | `../services/research/workgraph/experiment-node.js` |
| `scripts/phase21-g-simplicity.mjs` | `../research/simplicity/scorer.js` | `research/simplicity/scorer.js` | `services/research/simplicity/scorer.js` | `../services/research/simplicity/scorer.js` |
| `scripts/phase21-h-swarm.mjs` | `../research/swarm/research-swarm.js` | `research/swarm/research-swarm.js` | `services/research/swarm/research-swarm.js` | `../services/research/swarm/research-swarm.js` |
| `scripts/phase21-i-templates.mjs` | `../research/constraints/guards.js` | `research/constraints/guards.js` | `services/research/constraints/guards.js` | `../services/research/constraints/guards.js` |
| `scripts/phase21-i-templates.mjs` | `../research/templates/registry.js` | `research/templates/registry.js` | `services/research/templates/registry.js` | `../services/research/templates/registry.js` |
| `scripts/phase21-i-templates.mjs` | `../research/templates/template.skill.js` | `research/templates/template.skill.js` | `services/research/templates/template.skill.js` | `../services/research/templates/template.skill.js` |
| `scripts/phase21-j-overnight.mjs` | `../research/overnight.js` | `research/overnight.js` | `services/research/overnight.js` | `../services/research/overnight.js` |
| `scripts/phase22-a-probe.mjs` | `../memory/session-compress.js` | `memory/session-compress.js` | `mind/memory/session-compress.js` | `../mind/memory/session-compress.js` |
| `scripts/phase22-a-probe.mjs` | `../memory/session-inject.js` | `memory/session-inject.js` | `mind/memory/session-inject.js` | `../mind/memory/session-inject.js` |
| `scripts/phase22-c-probe.mjs` | `../capability/rag/index.js` | `capability/rag/index.js` | `capabilities/graph/rag/index.js` | `../capabilities/graph/rag/index.js` |
| `scripts/phase22-e-probe.mjs` | `workgraph/phases/gsd/index.js` | `workgraph/phases/gsd/index.js` | `runtime/workgraph/phases/gsd/index.js` | `runtime/workgraph/phases/gsd/index.js` |
| `scripts/phase24-palette-render.mjs` | `ui/web/console/_palette-preview.html` | `ui/web/console/_palette-preview.html` | `interfaces/ui/web/console/_palette-preview.html` | `interfaces/ui/web/console/_palette-preview.html` |
| `scripts/phase25-scope-a.mjs` | `../prompt/assembly/order.js` | `prompt/assembly/order.js` | `capabilities/prompts/assembly/order.js` | `../capabilities/prompts/assembly/order.js` |
| `scripts/phase25-scope-a.mjs` | `../prompt/assembly/registry.js` | `prompt/assembly/registry.js` | `capabilities/prompts/assembly/registry.js` | `../capabilities/prompts/assembly/registry.js` |
| `scripts/phase25-scope-b.mjs` | `../prompt/assembly/boundary.js` | `prompt/assembly/boundary.js` | `capabilities/prompts/assembly/boundary.js` | `../capabilities/prompts/assembly/boundary.js` |
| `scripts/phase25-scope-b.mjs` | `../prompt/assembly/errors.js` | `prompt/assembly/errors.js` | `capabilities/prompts/assembly/errors.js` | `../capabilities/prompts/assembly/errors.js` |
| `scripts/phase25-scope-b.mjs` | `../prompt/assembly/order.js` | `prompt/assembly/order.js` | `capabilities/prompts/assembly/order.js` | `../capabilities/prompts/assembly/order.js` |
| `scripts/phase25-scope-b.mjs` | `../prompt/assembly/registry.js` | `prompt/assembly/registry.js` | `capabilities/prompts/assembly/registry.js` | `../capabilities/prompts/assembly/registry.js` |
| `scripts/phase25-scope-c.mjs` | `../prompt/assembly/boundary.js` | `prompt/assembly/boundary.js` | `capabilities/prompts/assembly/boundary.js` | `../capabilities/prompts/assembly/boundary.js` |
| `scripts/phase25-scope-c.mjs` | `../prompt/assembly/errors.js` | `prompt/assembly/errors.js` | `capabilities/prompts/assembly/errors.js` | `../capabilities/prompts/assembly/errors.js` |
| `scripts/phase25-scope-c.mjs` | `../prompt/assembly/order.js` | `prompt/assembly/order.js` | `capabilities/prompts/assembly/order.js` | `../capabilities/prompts/assembly/order.js` |
| `scripts/phase25-scope-c.mjs` | `../prompt/assembly/registry.js` | `prompt/assembly/registry.js` | `capabilities/prompts/assembly/registry.js` | `../capabilities/prompts/assembly/registry.js` |
| `scripts/phase25-scope-c.mjs` | `../prompt/constitution/index.js` | `prompt/constitution/index.js` | `capabilities/prompts/constitution/index.js` | `../capabilities/prompts/constitution/index.js` |
| `scripts/phase25-scope-d.mjs` | `../prompt/assembly/boundary.js` | `prompt/assembly/boundary.js` | `capabilities/prompts/assembly/boundary.js` | `../capabilities/prompts/assembly/boundary.js` |
| `scripts/phase25-scope-d.mjs` | `../prompt/assembly/errors.js` | `prompt/assembly/errors.js` | `capabilities/prompts/assembly/errors.js` | `../capabilities/prompts/assembly/errors.js` |
| `scripts/phase25-scope-d.mjs` | `../prompt/assembly/order.js` | `prompt/assembly/order.js` | `capabilities/prompts/assembly/order.js` | `../capabilities/prompts/assembly/order.js` |
| `scripts/phase25-scope-d.mjs` | `../prompt/assembly/registry.js` | `prompt/assembly/registry.js` | `capabilities/prompts/assembly/registry.js` | `../capabilities/prompts/assembly/registry.js` |
| `scripts/phase25-scope-d.mjs` | `../prompt/tools/index.js` | `prompt/tools/index.js` | `capabilities/prompts/tools/index.js` | `../capabilities/prompts/tools/index.js` |
| `scripts/phase25-scope-d.mjs` | `prompt/tools/index.js` | `prompt/tools/index.js` | `capabilities/prompts/tools/index.js` | `capabilities/prompts/tools/index.js` |
| `scripts/phase25-scope-e.mjs` | `../prompt/memory-fs/index.js` | `prompt/memory-fs/index.js` | `capabilities/prompts/memory-fs/index.js` | `../capabilities/prompts/memory-fs/index.js` |
| `scripts/phase25-scope-e.mjs` | `prompt/memory-fs/index.js` | `prompt/memory-fs/index.js` | `capabilities/prompts/memory-fs/index.js` | `capabilities/prompts/memory-fs/index.js` |
| `scripts/phase25-scope-f.mjs` | `../prompt/memory-fs/index.js` | `prompt/memory-fs/index.js` | `capabilities/prompts/memory-fs/index.js` | `../capabilities/prompts/memory-fs/index.js` |
| `scripts/phase25-scope-f.mjs` | `prompt/memory-fs/index.js` | `prompt/memory-fs/index.js` | `capabilities/prompts/memory-fs/index.js` | `capabilities/prompts/memory-fs/index.js` |
| `scripts/phase25-scope-g.mjs` | `../prompt/memory-fs/index.js` | `prompt/memory-fs/index.js` | `capabilities/prompts/memory-fs/index.js` | `../capabilities/prompts/memory-fs/index.js` |
| `scripts/phase25-scope-g.mjs` | `prompt/memory-fs/index.js` | `prompt/memory-fs/index.js` | `capabilities/prompts/memory-fs/index.js` | `capabilities/prompts/memory-fs/index.js` |
| `scripts/phase25-scope-h.mjs` | `../prompt/assembly/order.js` | `prompt/assembly/order.js` | `capabilities/prompts/assembly/order.js` | `../capabilities/prompts/assembly/order.js` |
| `scripts/phase25-scope-h.mjs` | `../prompt/assembly/registry.js` | `prompt/assembly/registry.js` | `capabilities/prompts/assembly/registry.js` | `../capabilities/prompts/assembly/registry.js` |
| `scripts/phase25-scope-h.mjs` | `../prompt/incidents/index.js` | `prompt/incidents/index.js` | `capabilities/prompts/incidents/index.js` | `../capabilities/prompts/incidents/index.js` |
| `scripts/phase25-scope-h.mjs` | `prompt/incidents/index.js` | `prompt/incidents/index.js` | `capabilities/prompts/incidents/index.js` | `capabilities/prompts/incidents/index.js` |
| `scripts/phase25-scope-k.mjs` | `../prompt/testing/index.js` | `prompt/testing/index.js` | `capabilities/prompts/testing/index.js` | `../capabilities/prompts/testing/index.js` |
| `scripts/phase25-scope-k.mjs` | `../prompt/versioning/index.js` | `prompt/versioning/index.js` | `capabilities/prompts/versioning/index.js` | `../capabilities/prompts/versioning/index.js` |
| `scripts/phase25-scope-l.mjs` | `../prompt/anti-patterns/index.js` | `prompt/anti-patterns/index.js` | `capabilities/prompts/anti-patterns/index.js` | `../capabilities/prompts/anti-patterns/index.js` |
| `scripts/phase25-scope-l.mjs` | `prompt` | `prompt` | `capabilities/prompts` | `capabilities/prompts` |
| `scripts/phase25-scope-m.mjs` | `../prompt/sections/08-instructions.js` | `prompt/sections/08-instructions.js` | `capabilities/prompts/sections/08-instructions.js` | `../capabilities/prompts/sections/08-instructions.js` |
| `scripts/phase26-a-probe.mjs` | `../instincts/observe/index.js` | `instincts/observe/index.js` | `mind/instincts/observe/index.js` | `../mind/instincts/observe/index.js` |
| `scripts/phase26-b-probe.mjs` | `../instincts/core/index.js` | `instincts/core/index.js` | `mind/instincts/core/index.js` | `../mind/instincts/core/index.js` |
| `scripts/phase26-c-probe.mjs` | `../instincts/core/index.js` | `instincts/core/index.js` | `mind/instincts/core/index.js` | `../mind/instincts/core/index.js` |
| `scripts/phase26-c-probe.mjs` | `../instincts/observe/index.js` | `instincts/observe/index.js` | `mind/instincts/observe/index.js` | `../mind/instincts/observe/index.js` |
| `scripts/phase26-c-probe.mjs` | `../instincts/store/index.js` | `instincts/store/index.js` | `mind/instincts/store/index.js` | `../mind/instincts/store/index.js` |
| `scripts/phase26-d-probe.mjs` | `../instincts/core/index.js` | `instincts/core/index.js` | `mind/instincts/core/index.js` | `../mind/instincts/core/index.js` |
| `scripts/phase26-d-probe.mjs` | `../instincts/evolve/index.js` | `instincts/evolve/index.js` | `mind/instincts/evolve/index.js` | `../mind/instincts/evolve/index.js` |
| `scripts/phase26-e-probe.mjs` | `../instincts/core/index.js` | `instincts/core/index.js` | `mind/instincts/core/index.js` | `../mind/instincts/core/index.js` |
| `scripts/phase26-e-probe.mjs` | `../instincts/io/index.js` | `instincts/io/index.js` | `mind/instincts/io/index.js` | `../mind/instincts/io/index.js` |
| `scripts/phase26-e-probe.mjs` | `../instincts/store/index.js` | `instincts/store/index.js` | `mind/instincts/store/index.js` | `../mind/instincts/store/index.js` |
| `scripts/phase26-f-probe.mjs` | `../instincts/core/index.js` | `instincts/core/index.js` | `mind/instincts/core/index.js` | `../mind/instincts/core/index.js` |
| `scripts/phase26-f-probe.mjs` | `../instincts/observe/index.js` | `instincts/observe/index.js` | `mind/instincts/observe/index.js` | `../mind/instincts/observe/index.js` |
| `scripts/phase26-f-probe.mjs` | `../instincts/prune/index.js` | `instincts/prune/index.js` | `mind/instincts/prune/index.js` | `../mind/instincts/prune/index.js` |
| `scripts/phase26-f-probe.mjs` | `../instincts/store/index.js` | `instincts/store/index.js` | `mind/instincts/store/index.js` | `../mind/instincts/store/index.js` |
| `scripts/phase26-g-probe.mjs` | `../instincts/core/index.js` | `instincts/core/index.js` | `mind/instincts/core/index.js` | `../mind/instincts/core/index.js` |
| `scripts/phase26-g-probe.mjs` | `../instincts/evolve/index.js` | `instincts/evolve/index.js` | `mind/instincts/evolve/index.js` | `../mind/instincts/evolve/index.js` |
| `scripts/phase26-g-probe.mjs` | `../instincts/io/index.js` | `instincts/io/index.js` | `mind/instincts/io/index.js` | `../mind/instincts/io/index.js` |
| `scripts/phase26-g-probe.mjs` | `../instincts/observe/index.js` | `instincts/observe/index.js` | `mind/instincts/observe/index.js` | `../mind/instincts/observe/index.js` |
| `scripts/phase26-g-probe.mjs` | `../instincts/store/index.js` | `instincts/store/index.js` | `mind/instincts/store/index.js` | `../mind/instincts/store/index.js` |
| `scripts/phase27-scope-a.mjs` | `../session/fleet/index.js` | `session/fleet/index.js` | `runtime/session/fleet/index.js` | `../runtime/session/fleet/index.js` |
| `scripts/phase27-scope-a.mjs` | `session/fleet/index.js` | `session/fleet/index.js` | `runtime/session/fleet/index.js` | `runtime/session/fleet/index.js` |
| `scripts/phase27-scope-b.mjs` | `../providers/routing/repo-context.js` | `providers/routing/repo-context.js` | `integrations/providers/routing/repo-context.js` | `../integrations/providers/routing/repo-context.js` |
| `scripts/phase27-scope-c.mjs` | `../providers/routing/index.js` | `providers/routing/index.js` | `integrations/providers/routing/index.js` | `../integrations/providers/routing/index.js` |
| `scripts/phase27-scope-c.mjs` | `providers/routing/index.js` | `providers/routing/index.js` | `integrations/providers/routing/index.js` | `integrations/providers/routing/index.js` |
| `scripts/phase27-scope-d.mjs` | `../providers/profiles/_internal.js` | `providers/profiles/_internal.js` | `integrations/providers/profiles/_internal.js` | `../integrations/providers/profiles/_internal.js` |
| `scripts/phase27-scope-d.mjs` | `../providers/profiles/index.js` | `providers/profiles/index.js` | `integrations/providers/profiles/index.js` | `../integrations/providers/profiles/index.js` |
| `scripts/phase28-ambient-probe.mjs` | `../brain/ambient/index.js` | `brain/ambient/index.js` | `mind/brain/ambient/index.js` | `../mind/brain/ambient/index.js` |
| `scripts/phase28-ambient-probe.mjs` | `../brain/kg/index.js` | `brain/kg/index.js` | `mind/brain/kg/index.js` | `../mind/brain/kg/index.js` |
| `scripts/phase28-ambient-probe.mjs` | `../brain/repo/index.js` | `brain/repo/index.js` | `mind/brain/repo/index.js` | `../mind/brain/repo/index.js` |
| `scripts/phase28-cycle-probe.mjs` | `../brain/cycle/index.js` | `brain/cycle/index.js` | `mind/brain/cycle/index.js` | `../mind/brain/cycle/index.js` |
| `scripts/phase28-cycle-probe.mjs` | `../brain/hot/index.js` | `brain/hot/index.js` | `mind/brain/hot/index.js` | `../mind/brain/hot/index.js` |
| `scripts/phase28-cycle-probe.mjs` | `../brain/index/index.js` | `brain/index/index.js` | `mind/brain/index/index.js` | `../mind/brain/index/index.js` |
| `scripts/phase28-cycle-probe.mjs` | `../brain/repo/index.js` | `brain/repo/index.js` | `mind/brain/repo/index.js` | `../mind/brain/repo/index.js` |
| `scripts/phase28-cycle-probe.mjs` | `../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../services/semantica/_internal.js` |
| `scripts/phase28-cycle-probe.mjs` | `brain` | `brain` | `mind/brain` | `mind/brain` |
| `scripts/phase28-evals-publish-probe.mjs` | `../brain/evals/index.js` | `brain/evals/index.js` | `mind/brain/evals/index.js` | `../mind/brain/evals/index.js` |
| `scripts/phase28-evals-publish-probe.mjs` | `../brain/publish/index.js` | `brain/publish/index.js` | `mind/brain/publish/index.js` | `../mind/brain/publish/index.js` |
| `scripts/phase28-evals-publish-probe.mjs` | `../brain/repo/index.js` | `brain/repo/index.js` | `mind/brain/repo/index.js` | `../mind/brain/repo/index.js` |
| `scripts/phase28-hot-probe.mjs` | `../brain/hot/index.js` | `brain/hot/index.js` | `mind/brain/hot/index.js` | `../mind/brain/hot/index.js` |
| `scripts/phase28-index-probe.mjs` | `../brain/index/index.js` | `brain/index/index.js` | `mind/brain/index/index.js` | `../mind/brain/index/index.js` |
| `scripts/phase28-index-probe.mjs` | `../brain/repo/index.js` | `brain/repo/index.js` | `mind/brain/repo/index.js` | `../mind/brain/repo/index.js` |
| `scripts/phase28-kg-probe.mjs` | `../brain/kg/index.js` | `brain/kg/index.js` | `mind/brain/kg/index.js` | `../mind/brain/kg/index.js` |
| `scripts/phase28-kg-probe.mjs` | `../brain/repo/index.js` | `brain/repo/index.js` | `mind/brain/repo/index.js` | `../mind/brain/repo/index.js` |
| `scripts/phase28-kg-probe.mjs` | `brain/kg` | `brain/kg` | `mind/brain/kg` | `mind/brain/kg` |
| `scripts/phase28-multi-probe.mjs` | `../brain/multi/index.js` | `brain/multi/index.js` | `mind/brain/multi/index.js` | `../mind/brain/multi/index.js` |
| `scripts/phase28-protocol-probe.mjs` | `../brain/hot/index.js` | `brain/hot/index.js` | `mind/brain/hot/index.js` | `../mind/brain/hot/index.js` |
| `scripts/phase28-protocol-probe.mjs` | `../brain/index/index.js` | `brain/index/index.js` | `mind/brain/index/index.js` | `../mind/brain/index/index.js` |
| `scripts/phase28-protocol-probe.mjs` | `../brain/kg/index.js` | `brain/kg/index.js` | `mind/brain/kg/index.js` | `../mind/brain/kg/index.js` |
| `scripts/phase28-protocol-probe.mjs` | `../brain/protocol/index.js` | `brain/protocol/index.js` | `mind/brain/protocol/index.js` | `../mind/brain/protocol/index.js` |
| `scripts/phase28-protocol-probe.mjs` | `../brain/repo/index.js` | `brain/repo/index.js` | `mind/brain/repo/index.js` | `../mind/brain/repo/index.js` |
| `scripts/phase28-protocol-probe.mjs` | `../brain/search/index.js` | `brain/search/index.js` | `mind/brain/search/index.js` | `../mind/brain/search/index.js` |
| `scripts/phase28-repo-probe.mjs` | `../brain/repo/index.js` | `brain/repo/index.js` | `mind/brain/repo/index.js` | `../mind/brain/repo/index.js` |
| `scripts/phase28-rerank-probe.mjs` | `../brain/search/rerank/index.js` | `brain/search/rerank/index.js` | `mind/brain/search/rerank/index.js` | `../mind/brain/search/rerank/index.js` |
| `scripts/phase28-search-probe.mjs` | `../brain/index/index.js` | `brain/index/index.js` | `mind/brain/index/index.js` | `../mind/brain/index/index.js` |
| `scripts/phase28-search-probe.mjs` | `../brain/kg/index.js` | `brain/kg/index.js` | `mind/brain/kg/index.js` | `../mind/brain/kg/index.js` |
| `scripts/phase28-search-probe.mjs` | `../brain/repo/index.js` | `brain/repo/index.js` | `mind/brain/repo/index.js` | `../mind/brain/repo/index.js` |
| `scripts/phase28-search-probe.mjs` | `../brain/search/index.js` | `brain/search/index.js` | `mind/brain/search/index.js` | `../mind/brain/search/index.js` |
| `scripts/phase29-scope-a-probe.mjs` | `../computer/action/index.js` | `computer/action/index.js` | `services/computer/action/index.js` | `../services/computer/action/index.js` |
| `scripts/phase29-scope-b-probe.mjs` | `../computer/action/index.js` | `computer/action/index.js` | `services/computer/action/index.js` | `../services/computer/action/index.js` |
| `scripts/phase29-scope-b-probe.mjs` | `../computer/errors.js` | `computer/errors.js` | `services/computer/errors.js` | `../services/computer/errors.js` |
| `scripts/phase29-scope-b-probe.mjs` | `../computer/operators/index.js` | `computer/operators/index.js` | `services/computer/operators/index.js` | `../services/computer/operators/index.js` |
| `scripts/phase29-scope-c-probe.mjs` | `../computer/action/index.js` | `computer/action/index.js` | `services/computer/action/index.js` | `../services/computer/action/index.js` |
| `scripts/phase29-scope-c-probe.mjs` | `../computer/errors.js` | `computer/errors.js` | `services/computer/errors.js` | `../services/computer/errors.js` |
| `scripts/phase29-scope-c-probe.mjs` | `../computer/operators/browser-modes.js` | `computer/operators/browser-modes.js` | `services/computer/operators/browser-modes.js` | `../services/computer/operators/browser-modes.js` |
| `scripts/phase29-scope-c-probe.mjs` | `../computer/operators/index.js` | `computer/operators/index.js` | `services/computer/operators/index.js` | `../services/computer/operators/index.js` |
| `scripts/phase29-scope-d-probe.mjs` | `../computer/action/coordinate.js` | `computer/action/coordinate.js` | `services/computer/action/coordinate.js` | `../services/computer/action/coordinate.js` |
| `scripts/phase29-scope-d-probe.mjs` | `../computer/errors.js` | `computer/errors.js` | `services/computer/errors.js` | `../services/computer/errors.js` |
| `scripts/phase29-scope-d-probe.mjs` | `../computer/screenshot/index.js` | `computer/screenshot/index.js` | `services/computer/screenshot/index.js` | `../services/computer/screenshot/index.js` |
| `scripts/phase29-scope-e-probe.mjs` | `../computer/action/space.js` | `computer/action/space.js` | `services/computer/action/space.js` | `../services/computer/action/space.js` |
| `scripts/phase29-scope-e-probe.mjs` | `../computer/errors.js` | `computer/errors.js` | `services/computer/errors.js` | `../services/computer/errors.js` |
| `scripts/phase29-scope-e-probe.mjs` | `../computer/vlm/index.js` | `computer/vlm/index.js` | `services/computer/vlm/index.js` | `../services/computer/vlm/index.js` |
| `scripts/phase29-scope-f-probe.mjs` | `../computer/errors.js` | `computer/errors.js` | `services/computer/errors.js` | `../services/computer/errors.js` |
| `scripts/phase29-scope-f-probe.mjs` | `../computer/loop/index.js` | `computer/loop/index.js` | `services/computer/loop/index.js` | `../services/computer/loop/index.js` |
| `scripts/phase29-scope-f-probe.mjs` | `../computer/operators/index.js` | `computer/operators/index.js` | `services/computer/operators/index.js` | `../services/computer/operators/index.js` |
| `scripts/phase29-scope-f-probe.mjs` | `../computer/vlm/index.js` | `computer/vlm/index.js` | `services/computer/vlm/index.js` | `../services/computer/vlm/index.js` |
| `scripts/phase29-scope-g-probe.mjs` | `../computer/errors.js` | `computer/errors.js` | `services/computer/errors.js` | `../services/computer/errors.js` |
| `scripts/phase29-scope-g-probe.mjs` | `../computer/modes/index.js` | `computer/modes/index.js` | `services/computer/modes/index.js` | `../services/computer/modes/index.js` |
| `scripts/phase29-scope-h-probe.mjs` | `../computer/errors.js` | `computer/errors.js` | `services/computer/errors.js` | `../services/computer/errors.js` |
| `scripts/phase29-scope-h-probe.mjs` | `../computer/tool-call/index.js` | `computer/tool-call/index.js` | `services/computer/tool-call/index.js` | `../services/computer/tool-call/index.js` |
| `scripts/phase29-scope-i-probe.mjs` | `../computer/errors.js` | `computer/errors.js` | `services/computer/errors.js` | `../services/computer/errors.js` |
| `scripts/phase29-scope-i-probe.mjs` | `../computer/sandbox/index.js` | `computer/sandbox/index.js` | `services/computer/sandbox/index.js` | `../services/computer/sandbox/index.js` |
| `scripts/phase29-scope-j-probe.mjs` | `../computer/errors.js` | `computer/errors.js` | `services/computer/errors.js` | `../services/computer/errors.js` |
| `scripts/phase29-scope-j-probe.mjs` | `../computer/operators/desktop.js` | `computer/operators/desktop.js` | `services/computer/operators/desktop.js` | `../services/computer/operators/desktop.js` |
| `scripts/phase29-scope-j-probe.mjs` | `../computer/operators/interface.js` | `computer/operators/interface.js` | `services/computer/operators/interface.js` | `../services/computer/operators/interface.js` |
| `scripts/phase29-scope-j-probe.mjs` | `../computer/remote/index.js` | `computer/remote/index.js` | `services/computer/remote/index.js` | `../services/computer/remote/index.js` |
| `scripts/phase29-scope-k-probe.mjs` | `../computer/errors.js` | `computer/errors.js` | `services/computer/errors.js` | `../services/computer/errors.js` |
| `scripts/phase29-scope-k-probe.mjs` | `../computer/events/index.js` | `computer/events/index.js` | `services/computer/events/index.js` | `../services/computer/events/index.js` |
| `scripts/phase29-scope-k-probe.mjs` | `../computer/loop/index.js` | `computer/loop/index.js` | `services/computer/loop/index.js` | `../services/computer/loop/index.js` |
| `scripts/phase29-scope-k-probe.mjs` | `../computer/operators/index.js` | `computer/operators/index.js` | `services/computer/operators/index.js` | `../services/computer/operators/index.js` |
| `scripts/phase29-scope-k-probe.mjs` | `../computer/vlm/index.js` | `computer/vlm/index.js` | `services/computer/vlm/index.js` | `../services/computer/vlm/index.js` |
| `scripts/phase29-scope-k-probe.mjs` | `../events/chat/taxonomy.js` | `events/chat/taxonomy.js` | `runtime/events/chat/taxonomy.js` | `../runtime/events/chat/taxonomy.js` |
| `scripts/phase29-scope-k-probe.mjs` | `../ui/web/console/chat/router.js` | `ui/web/console/chat/router.js` | `interfaces/ui/web/console/chat/router.js` | `../interfaces/ui/web/console/chat/router.js` |
| `scripts/phase30-lifecycle-probe.mjs` | `../ui/web/console/chat/approvals.js` | `ui/web/console/chat/approvals.js` | `interfaces/ui/web/console/chat/approvals.js` | `../interfaces/ui/web/console/chat/approvals.js` |
| `scripts/phase30-worktree-probe.mjs` | `../session/fleet/index.js` | `session/fleet/index.js` | `runtime/session/fleet/index.js` | `../runtime/session/fleet/index.js` |
| `scripts/phase30-worktree-probe.mjs` | `../workgraph/session/index.js` | `workgraph/session/index.js` | `runtime/workgraph/session/index.js` | `../runtime/workgraph/session/index.js` |
| `scripts/phase31-scope-1-probe.mjs` | `instincts` | `instincts` | `mind/instincts` | `mind/instincts` |
| `scripts/phase31-scope-10-probe.mjs` | `ui/web/console/shell/Header.jsx` | `ui/web/console/shell/Header.jsx` | `interfaces/ui/web/console/shell/Header.jsx` | `interfaces/ui/web/console/shell/Header.jsx` |
| `scripts/phase31-scope-19-probe.mjs` | `brain/self/index.js` | `brain/self/index.js` | `mind/brain/self/index.js` | `mind/brain/self/index.js` |
| `scripts/phase31-scope-2-probe.mjs` | `computer` | `computer` | `services/computer` | `services/computer` |
| `scripts/phase31-scope-2-probe.mjs` | `swarm` | `swarm` | `agents/swarm` | `agents/swarm` |
| `scripts/phase31-scope-3-probe.mjs` | `workgraph/session/index.js` | `workgraph/session/index.js` | `runtime/workgraph/session/index.js` | `runtime/workgraph/session/index.js` |
| `scripts/phase31-scope-6-probe.mjs` | `commands/registry.js` | `commands/registry.js` | `capabilities/commands/registry.js` | `capabilities/commands/registry.js` |
| `scripts/phase31-scope-6-probe.mjs` | `ui/web/console/chat/approvals.js` | `ui/web/console/chat/approvals.js` | `interfaces/ui/web/console/chat/approvals.js` | `interfaces/ui/web/console/chat/approvals.js` |
| `scripts/phase8-e-probe.mjs` | `../runtimes/sandbox/index.js` | `runtimes/sandbox/index.js` | `runtime/runtimes/sandbox/index.js` | `../runtime/runtimes/sandbox/index.js` |
| `scripts/phase8-e-probe.mjs` | `runtimes/sandbox/dual-network.js` | `runtimes/sandbox/dual-network.js` | `runtime/runtimes/sandbox/dual-network.js` | `runtime/runtimes/sandbox/dual-network.js` |
| `scripts/phase8-g-probe.mjs` | `../knowledge/index.js` | `knowledge/index.js` | `mind/knowledge/index.js` | `../mind/knowledge/index.js` |
| `scripts/phase8-g-probe.mjs` | `../verification/verifiers/index.js` | `verification/verifiers/index.js` | `tests/verification/verifiers/index.js` | `../tests/verification/verifiers/index.js` |
| `scripts/phase9-a-probe.mjs` | `../intelligence/trust-pipeline/broker.js` | `intelligence/trust-pipeline/broker.js` | `mind/intelligence/trust-pipeline/broker.js` | `../mind/intelligence/trust-pipeline/broker.js` |
| `scripts/phase9-a-probe.mjs` | `../intelligence/trust-pipeline/registered-urls.js` | `intelligence/trust-pipeline/registered-urls.js` | `mind/intelligence/trust-pipeline/registered-urls.js` | `../mind/intelligence/trust-pipeline/registered-urls.js` |
| `scripts/phase9-a-probe.mjs` | `../intelligence/trust-pipeline/sanitize.js` | `intelligence/trust-pipeline/sanitize.js` | `mind/intelligence/trust-pipeline/sanitize.js` | `../mind/intelligence/trust-pipeline/sanitize.js` |
| `scripts/phase9-b-probe.mjs` | `../intelligence/trust-pipeline/allowlist.js` | `intelligence/trust-pipeline/allowlist.js` | `mind/intelligence/trust-pipeline/allowlist.js` | `../mind/intelligence/trust-pipeline/allowlist.js` |
| `scripts/phase9-b-probe.mjs` | `../intelligence/trust-pipeline/broker.js` | `intelligence/trust-pipeline/broker.js` | `mind/intelligence/trust-pipeline/broker.js` | `../mind/intelligence/trust-pipeline/broker.js` |
| `scripts/phase9-c-probe.mjs` | `../tools/registry/governance.js` | `tools/registry/governance.js` | `capabilities/tools/registry/governance.js` | `../capabilities/tools/registry/governance.js` |
| `scripts/phase9-d-probe.mjs` | `../providers/tokens/ephemeral.js` | `providers/tokens/ephemeral.js` | `integrations/providers/tokens/ephemeral.js` | `../integrations/providers/tokens/ephemeral.js` |
| `scripts/phase9-d-probe.mjs` | `../providers/tokens/realtime.js` | `providers/tokens/realtime.js` | `integrations/providers/tokens/realtime.js` | `../integrations/providers/tokens/realtime.js` |
| `scripts/phase9-e-probe.mjs` | `../providers/cost/caps.js` | `providers/cost/caps.js` | `integrations/providers/cost/caps.js` | `../integrations/providers/cost/caps.js` |
| `scripts/phase9-e-probe.mjs` | `../providers/cost/tracker.js` | `providers/cost/tracker.js` | `integrations/providers/cost/tracker.js` | `../integrations/providers/cost/tracker.js` |
| `scripts/phase9-g-probe.mjs` | `../events/provenance/label.js` | `events/provenance/label.js` | `runtime/events/provenance/label.js` | `../runtime/events/provenance/label.js` |
| `scripts/phase9-g-probe.mjs` | `../events/provenance/schema.js` | `events/provenance/schema.js` | `runtime/events/provenance/schema.js` | `../runtime/events/provenance/schema.js` |
| `scripts/phase9-g-probe.mjs` | `../intelligence/trust-pipeline/broker.js` | `intelligence/trust-pipeline/broker.js` | `mind/intelligence/trust-pipeline/broker.js` | `../mind/intelligence/trust-pipeline/broker.js` |
| `scripts/phase9-h-probe.mjs` | `../verification/visual/puppeteer-runner.js` | `verification/visual/puppeteer-runner.js` | `tests/verification/visual/puppeteer-runner.js` | `../tests/verification/visual/puppeteer-runner.js` |
| `scripts/phase9-h-probe.mjs` | `../verification/visual/scene-qa.js` | `verification/visual/scene-qa.js` | `tests/verification/visual/scene-qa.js` | `../tests/verification/visual/scene-qa.js` |
| `scripts/phase9-h-probe.mjs` | `../verification/visual/screenshot-diff.js` | `verification/visual/screenshot-diff.js` | `tests/verification/visual/screenshot-diff.js` | `../tests/verification/visual/screenshot-diff.js` |
| `scripts/phase9-i-probe.mjs` | `../events/provenance/label.js` | `events/provenance/label.js` | `runtime/events/provenance/label.js` | `../runtime/events/provenance/label.js` |
| `scripts/phase9-i-probe.mjs` | `../intelligence/layers/_shared.js` | `intelligence/layers/_shared.js` | `mind/intelligence/layers/_shared.js` | `../mind/intelligence/layers/_shared.js` |
| `scripts/phase9-i-probe.mjs` | `../intelligence/layers/index.js` | `intelligence/layers/index.js` | `mind/intelligence/layers/index.js` | `../mind/intelligence/layers/index.js` |
| `scripts/phase9-j-probe.mjs` | `../intelligence/layers/index.js` | `intelligence/layers/index.js` | `mind/intelligence/layers/index.js` | `../mind/intelligence/layers/index.js` |
| `scripts/phase9-j-probe.mjs` | `../verification/visual/puppeteer-runner.js` | `verification/visual/puppeteer-runner.js` | `tests/verification/visual/puppeteer-runner.js` | `../tests/verification/visual/puppeteer-runner.js` |
| `scripts/regenerate-capabilities.mjs` | `../brain/protocol/verbs.js` | `brain/protocol/verbs.js` | `mind/brain/protocol/verbs.js` | `../mind/brain/protocol/verbs.js` |
| `scripts/regenerate-capabilities.mjs` | `../surfsense/connectors/index.js` | `surfsense/connectors/index.js` | `services/surfsense/connectors/index.js` | `../services/surfsense/connectors/index.js` |
| `scripts/regenerate-capabilities.mjs` | `../surfsense/output/formats.js` | `surfsense/output/formats.js` | `services/surfsense/output/formats.js` | `../services/surfsense/output/formats.js` |
| `scripts/regenerate-capabilities.mjs` | `../ui/web/console/shell/routes.js` | `ui/web/console/shell/routes.js` | `interfaces/ui/web/console/shell/routes.js` | `../interfaces/ui/web/console/shell/routes.js` |
| `scripts/regenerate-capabilities.mjs` | `../workforce/agents/index.js` | `workforce/agents/index.js` | `agents/workforce/agents/index.js` | `../agents/workforce/agents/index.js` |
| `scripts/zone-owner-item10-probe.mjs` | `../verification/visual/puppeteer-runner.js` | `verification/visual/puppeteer-runner.js` | `tests/verification/visual/puppeteer-runner.js` | `../tests/verification/visual/puppeteer-runner.js` |
| `scripts/zone-owner-item3-probe.mjs` | `../memory/confidence.js` | `memory/confidence.js` | `mind/memory/confidence.js` | `../mind/memory/confidence.js` |
| `scripts/zone-owner-item3-probe.mjs` | `../memory/hybrid-search.js` | `memory/hybrid-search.js` | `mind/memory/hybrid-search.js` | `../mind/memory/hybrid-search.js` |
| `scripts/zone-owner-item4-probe.mjs` | `../events/provenance/label.js` | `events/provenance/label.js` | `runtime/events/provenance/label.js` | `../runtime/events/provenance/label.js` |
| `scripts/zone-owner-item4-probe.mjs` | `../intelligence/trust-pipeline/broker.js` | `intelligence/trust-pipeline/broker.js` | `mind/intelligence/trust-pipeline/broker.js` | `../mind/intelligence/trust-pipeline/broker.js` |
| `scripts/zone-owner-item5-probe.mjs` | `../providers/cost/caps.js` | `providers/cost/caps.js` | `integrations/providers/cost/caps.js` | `../integrations/providers/cost/caps.js` |
| `scripts/zone-owner-item7-probe.mjs` | `../events/hud/index.js` | `events/hud/index.js` | `runtime/events/hud/index.js` | `../runtime/events/hud/index.js` |

## 4. capabilities/ + services/ — 14 files, 22 refs

| file | old_ref | old_target | new_target | new_ref |
| --- | --- | --- | --- | --- |
| `capabilities/commands/refine.command.js` | `../harness/refine/index.js` | `harness/refine/index.js` | `harness/refine/index.js` | `../../harness/refine/index.js` |
| `capabilities/graph/doctor/index.js` | `capability/internet/reach/channels/index.js` | `capability/internet/reach/channels/index.js` | `capabilities/graph/internet/reach/channels/index.js` | `capabilities/graph/internet/reach/channels/index.js` |
| `capabilities/graph/doctor/index.js` | `capability/internet/reach/config.js` | `capability/internet/reach/config.js` | `capabilities/graph/internet/reach/config.js` | `capabilities/graph/internet/reach/config.js` |
| `capabilities/graph/doctor/index.js` | `capability/internet/reach/doctor.js` | `capability/internet/reach/doctor.js` | `capabilities/graph/internet/reach/doctor.js` | `capabilities/graph/internet/reach/doctor.js` |
| `capabilities/graph/doctor/index.js` | `kernel/daemon/client.js` | `kernel/daemon/client.js` | `runtime/kernel/daemon/client.js` | `runtime/kernel/daemon/client.js` |
| `capabilities/graph/doctor/index.js` | `tools/domains/lsp/_graph.js` | `tools/domains/lsp/_graph.js` | `capabilities/tools/domains/lsp/_graph.js` | `capabilities/tools/domains/lsp/_graph.js` |
| `capabilities/graph/doctor/index.js` | `tools/domains/lsp/check-index-coverage.tool.js` | `tools/domains/lsp/check-index-coverage.tool.js` | `capabilities/tools/domains/lsp/check-index-coverage.tool.js` | `capabilities/tools/domains/lsp/check-index-coverage.tool.js` |
| `capabilities/tools/domains/lsp/_graph.js` | `../../../capability/code/graph/pipeline/tree-sitter.js` | `capability/code/graph/pipeline/tree-sitter.js` | `capabilities/graph/code/graph/pipeline/tree-sitter.js` | `../../../graph/code/graph/pipeline/tree-sitter.js` |
| `capabilities/tools/domains/lsp/_graph.js` | `../../../capability/code/graph/store.js` | `capability/code/graph/store.js` | `capabilities/graph/code/graph/store.js` | `../../../graph/code/graph/store.js` |
| `capabilities/tools/domains/lsp/get-graph-schema.tool.js` | `../../../capability/code/graph/edges/index.js` | `capability/code/graph/edges/index.js` | `capabilities/graph/code/graph/edges/index.js` | `../../../graph/code/graph/edges/index.js` |
| `capabilities/tools/domains/lsp/get-graph-schema.tool.js` | `../../../capability/code/graph/nodes/index.js` | `capability/code/graph/nodes/index.js` | `capabilities/graph/code/graph/nodes/index.js` | `../../../graph/code/graph/nodes/index.js` |
| `capabilities/tools/domains/lsp/index-repository.tool.js` | `../../../capability/code/graph/index.js` | `capability/code/graph/index.js` | `capabilities/graph/code/graph/index.js` | `../../../graph/code/graph/index.js` |
| `services/computer/events/emit.js` | `../../ui/web/console/chat/router.js` | `ui/web/console/chat/router.js` | `interfaces/ui/web/console/chat/router.js` | `../../../interfaces/ui/web/console/chat/router.js` |
| `services/computer/events/index.js` | `../../events/chat/taxonomy.js` | `events/chat/taxonomy.js` | `runtime/events/chat/taxonomy.js` | `../../../runtime/events/chat/taxonomy.js` |
| `services/computer/events/map.js` | `../../events/chat/taxonomy.js` | `events/chat/taxonomy.js` | `runtime/events/chat/taxonomy.js` | `../../../runtime/events/chat/taxonomy.js` |
| `services/surfsense/search/hybrid.js` | `../../capability/rag/graph-rag.js` | `capability/rag/graph-rag.js` | `capabilities/graph/rag/graph-rag.js` | `../../../capabilities/graph/rag/graph-rag.js` |

**root-constant depth fixes** (constant pointed at the repo root pre-move; the file moved deeper):

| file | constant | old `..` count | new | resolves to |
| --- | --- | ---: | ---: | --- |
| `capabilities/graph/code/graph-first.js:37` | `ROOT` | 2 | 3 | repo root (`.`) |
| `capabilities/graph/doctor/index.js:26` | `ROOT` | 2 | 3 | repo root (`.`) |
| `capabilities/graph/rag/graph-rag.js:37` | `REPO_ROOT` | 2 | 3 | repo root (`.`) |
| `capabilities/prompts/incidents/log.js:41` | `PROJECT_ROOT` | 2 | 3 | repo root (`.`) |
| `capabilities/prompts/versioning/snapshot.js:41` | `PROJECT_ROOT` | 2 | 3 | repo root (`.`) |
| `capabilities/tools/registry/governance.js:41` | `REPO_ROOT` | 2 | 3 | repo root (`.`) |

## 5. mind/ + runtime/ + agents/ — 86 files, 88 refs

| file | old_ref | old_target | new_target | new_ref |
| --- | --- | --- | --- | --- |
| `agents/swarm/loops/ralph.js` | `../../harness/hardening/ralph/diagnostics.js` | `harness/hardening/ralph/diagnostics.js` | `harness/hardening/ralph/diagnostics.js` | `../../../harness/hardening/ralph/diagnostics.js` |
| `agents/workforce/narration/index.js` | `../../events/chat/taxonomy.js` | `events/chat/taxonomy.js` | `runtime/events/chat/taxonomy.js` | `../../../runtime/events/chat/taxonomy.js` |
| `agents/workforce/registry/catalog.js` | `agents` | `agents` | `agents/catalog` | `agents/catalog` |
| `agents/workforce/trust/index.js` | `workforce` | `workforce` | `agents/workforce` | `agents/workforce` |
| `mind/brain/ambient/ambient/boundary.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../../services/semantica/_internal.js` |
| `mind/brain/ambient/ambient/context-pack.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../../services/semantica/_internal.js` |
| `mind/brain/ambient/ambient/delta.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../../services/semantica/_internal.js` |
| `mind/brain/ambient/reflex/pointer.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../../services/semantica/_internal.js` |
| `mind/brain/cycle/budget.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/cycle/cycle.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/cycle/phases/lint.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../../services/semantica/_internal.js` |
| `mind/brain/evals/brainbench.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/evals/corpus.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/evals/metrics.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/hot/decay.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/hot/extract-facts.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/hot/index.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/hot/kinds.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/hot/mcp-meta.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/hot/recall.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/hot/supersession.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/index/backends/provider.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../../services/semantica/_internal.js` |
| `mind/brain/index/backends/rule-based.js` | `../../../surfsense/connectors/local-search.js` | `surfsense/connectors/local-search.js` | `services/surfsense/connectors/local-search.js` | `../../../../services/surfsense/connectors/local-search.js` |
| `mind/brain/index/chunker.js` | `../../surfsense/connectors/local-search.js` | `surfsense/connectors/local-search.js` | `services/surfsense/connectors/local-search.js` | `../../../services/surfsense/connectors/local-search.js` |
| `mind/brain/index/embedder.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/index/index.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/index/vector-store.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/kg/extractor.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/kg/frontmatter.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/kg/verb-inference.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/kg/watermark.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/multi/acl.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/multi/index.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/multi/isolation.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/multi/soft-delete.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/multi/source.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/protocol/conformance.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/protocol/errors.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/protocol/index.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/publish/html.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/publish/index.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/repo/compiled-truth.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/repo/index.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/repo/layout.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/repo/page.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/repo/schema.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/repo/timeline.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/search/hybrid.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/search/keyword.js` | `../../surfsense/search/keyword.js` | `surfsense/search/keyword.js` | `services/surfsense/search/keyword.js` | `../../../services/surfsense/search/keyword.js` |
| `mind/brain/search/recency-decay.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/search/rerank/backends/cross-encoder.js` | `../../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../../../services/semantica/_internal.js` |
| `mind/brain/search/rerank/budget.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../../services/semantica/_internal.js` |
| `mind/brain/search/rerank/index.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../../services/semantica/_internal.js` |
| `mind/brain/search/rerank/interface.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../../services/semantica/_internal.js` |
| `mind/brain/self/composer.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/self/guard.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/self/reflex.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/brain/self/validate.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/instincts/core/confidence.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/instincts/core/index.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/instincts/core/schema.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/instincts/evolve/cluster.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/instincts/evolve/evolve.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/instincts/evolve/index.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/instincts/io/import.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/instincts/io/index.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/instincts/observe/hook.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/instincts/observe/index.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/instincts/observe/queue.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/instincts/observe/scope.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/instincts/prune/index.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/instincts/prune/ttl.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/instincts/store/index.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/instincts/store/query.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/instincts/store/store.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `mind/intelligence/layers/_shared.js` | `../../events/provenance/label.js` | `events/provenance/label.js` | `runtime/events/provenance/label.js` | `../../../runtime/events/provenance/label.js` |
| `mind/intelligence/trust-pipeline/broker.js` | `../../events/provenance/label.js` | `events/provenance/label.js` | `runtime/events/provenance/label.js` | `../../../runtime/events/provenance/label.js` |
| `mind/intelligence/trust-pipeline/broker.js` | `../../security/shield/ssrf.js` | `security/shield/ssrf.js` | `security/shield/ssrf.js` | `../../../security/shield/ssrf.js` |
| `runtime/context/viking/compile.js` | `../../memory/knowledge-graph.js` | `memory/knowledge-graph.js` | `mind/memory/knowledge-graph.js` | `../../../mind/memory/knowledge-graph.js` |
| `runtime/kernel/daemon/client.js` | `kernel/daemon/codegraph-daemon.js` | `kernel/daemon/codegraph-daemon.js` | `runtime/kernel/daemon/codegraph-daemon.js` | `runtime/kernel/daemon/codegraph-daemon.js` |
| `runtime/kernel/daemon/codegraph-daemon.js` | `../../capability/code/graph/store.js` | `capability/code/graph/store.js` | `capabilities/graph/code/graph/store.js` | `../../../capabilities/graph/code/graph/store.js` |
| `runtime/router/resolve.js` | `../workforce/registry/index.js` | `workforce/registry/index.js` | `agents/workforce/registry/index.js` | `../../agents/workforce/registry/index.js` |
| `runtime/runtimes/sandbox/dual-network.js` | `../../security/exec-bridge/allowlist.js` | `security/exec-bridge/allowlist.js` | `security/exec-bridge/allowlist.js` | `../../../security/exec-bridge/allowlist.js` |
| `runtime/runtimes/sandbox/exec-bridge.js` | `../../security/exec-bridge/auth.js` | `security/exec-bridge/auth.js` | `security/exec-bridge/auth.js` | `../../../security/exec-bridge/auth.js` |
| `runtime/runtimes/sandbox/index.js` | `../../security/exec-bridge/allowlist.js` | `security/exec-bridge/allowlist.js` | `security/exec-bridge/allowlist.js` | `../../../security/exec-bridge/allowlist.js` |
| `runtime/runtimes/sandbox/index.js` | `../../security/exec-bridge/index.js` | `security/exec-bridge/index.js` | `security/exec-bridge/index.js` | `../../../security/exec-bridge/index.js` |

**root-constant depth fixes** (constant pointed at the repo root pre-move; the file moved deeper):

| file | constant | old `..` count | new | resolves to |
| --- | --- | ---: | ---: | --- |
| `mind/learning/store.js:22` | `REPO_ROOT` | 1 | 2 | repo root (`.`) |
| `mind/memory/session-compress.js:34` | `REPO_ROOT` | 1 | 2 | repo root (`.`) |

## 6. integrations/ + infra/ + tests/ — 6 files, 10 refs

| file | old_ref | old_target | new_target | new_ref |
| --- | --- | --- | --- | --- |
| `infra/hooks/scripts/pre-compact/save-checkpoint.js` | `hooks` | `hooks` | `infra/hooks` | `infra/hooks` |
| `infra/hooks/scripts/session-end/persist-memory.js` | `hooks` | `hooks` | `infra/hooks` | `infra/hooks` |
| `infra/hooks/scripts/session-start/restore-memory.js` | `hooks` | `hooks` | `infra/hooks` | `infra/hooks` |
| `infra/hooks/scripts/stop/evaluate-session.js` | `hooks` | `hooks` | `infra/hooks` | `infra/hooks` |
| `tests/verification/verifiers/exploit.verifier.js` | `../../knowledge/index.js` | `knowledge/index.js` | `mind/knowledge/index.js` | `../../../mind/knowledge/index.js` |
| `tests/verification/verifiers/roi.verifier.js` | `../../security/engagements/validator.js` | `security/engagements/validator.js` | `security/engagements/validator.js` | `../../../security/engagements/validator.js` |

**root-constant depth fixes** (constant pointed at the repo root pre-move; the file moved deeper):

| file | constant | old `..` count | new | resolves to |
| --- | --- | ---: | ---: | --- |
| `infra/hooks/scripts/pre-compact/save-checkpoint.js:14` | `REPO_ROOT` | 3 | 4 | repo root (`.`) |
| `infra/hooks/scripts/session-end/persist-memory.js:14` | `REPO_ROOT` | 3 | 4 | repo root (`.`) |
| `infra/hooks/scripts/session-start/restore-memory.js:14` | `REPO_ROOT` | 3 | 4 | repo root (`.`) |
| `infra/hooks/scripts/stop/evaluate-session.js:13` | `REPO_ROOT` | 3 | 4 | repo root (`.`) |

## 7. skills/ + harness/ + benchmarks/ + security/ — 37 files, 48 refs

| file | old_ref | old_target | new_target | new_ref |
| --- | --- | --- | --- | --- |
| `benchmarks/_meta/cost.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../services/semantica/_internal.js` |
| `benchmarks/_meta/index.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../services/semantica/_internal.js` |
| `benchmarks/_meta/manifest.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../services/semantica/_internal.js` |
| `benchmarks/_meta/result.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../services/semantica/_internal.js` |
| `benchmarks/_meta/trace.js` | `../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../services/semantica/_internal.js` |
| `harness/adapters/_convert.js` | `agents` | `agents` | `agents/catalog` | `agents/catalog` |
| `harness/adapters/_convert.js` | `commands/index.js` | `commands/index.js` | `capabilities/commands/index.js` | `capabilities/commands/index.js` |
| `harness/adapters/_convert.js` | `hooks/hooks.json` | `hooks/hooks.json` | `infra/hooks/hooks.json` | `infra/hooks/hooks.json` |
| `harness/adapters/_convert.js` | `jexi-agents/coworkers` | `jexi-agents/coworkers` | `agents/jexi/coworkers` | `agents/jexi/coworkers` |
| `harness/hardening/forgejo/taxonomy.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `harness/hardening/forgejo/transport.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `harness/hardening/madtea/atomic-finish.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `harness/hardening/madtea/credentials.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `harness/hardening/madtea/gates.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `harness/hardening/ralph/add-context.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `harness/hardening/ralph/ci-doctor.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `harness/hardening/ralph/diagnostics.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `harness/parity/hooks/registry.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `harness/parity/lifecycle/permission-denied.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `harness/parity/lifecycle/permission-denied.js` | `../../../ui/web/console/chat/approvals.js` | `ui/web/console/chat/approvals.js` | `interfaces/ui/web/console/chat/approvals.js` | `../../../interfaces/ui/web/console/chat/approvals.js` |
| `harness/parity/lifecycle/post-tool-batch.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `harness/parity/lifecycle/prompt-expansion.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `harness/parity/rules/injection.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `harness/parity/rules/rules.js` | `../../../prompt/sections/08-instructions.js` | `prompt/sections/08-instructions.js` | `capabilities/prompts/sections/08-instructions.js` | `../../../capabilities/prompts/sections/08-instructions.js` |
| `harness/parity/rules/rules.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `harness/parity/self-evolve/audit.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `harness/parity/self-evolve/audit.js` | `../../../semantica/decisions/index.js` | `semantica/decisions/index.js` | `services/semantica/decisions/index.js` | `../../../services/semantica/decisions/index.js` |
| `harness/parity/self-evolve/audit.js` | `../../../semantica/provenance/index.js` | `semantica/provenance/index.js` | `services/semantica/provenance/index.js` | `../../../services/semantica/provenance/index.js` |
| `harness/parity/self-evolve/evolve.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `harness/parity/self-evolve/guardrail.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `harness/parity/skills/enforcement.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `harness/parity/skills/scoping.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `harness/parity/subagent/contract.js` | `../../../workforce/agents/agent-spec.js` | `workforce/agents/agent-spec.js` | `agents/workforce/agents/agent-spec.js` | `../../../agents/workforce/agents/agent-spec.js` |
| `harness/parity/subagent/enforcement.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `harness/parity/worktree/cleanup.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `harness/parity/worktree/create.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `harness/parity/worktree/create.js` | `../../../session/fleet/index.js` | `session/fleet/index.js` | `runtime/session/fleet/index.js` | `../../../runtime/session/fleet/index.js` |
| `harness/parity/worktree/create.js` | `../../../workgraph/session/index.js` | `workgraph/session/index.js` | `runtime/workgraph/session/index.js` | `../../../runtime/workgraph/session/index.js` |
| `harness/parity/worktree/hooks.js` | `../../../semantica/_internal.js` | `semantica/_internal.js` | `services/semantica/_internal.js` | `../../../services/semantica/_internal.js` |
| `security/exec-bridge/audit.js` | `../../runtimes/sandbox/audit.js` | `runtimes/sandbox/audit.js` | `runtime/runtimes/sandbox/audit.js` | `../../runtime/runtimes/sandbox/audit.js` |
| `security/exec-bridge/index.js` | `../../runtimes/sandbox/index.js` | `runtimes/sandbox/index.js` | `runtime/runtimes/sandbox/index.js` | `../../runtime/runtimes/sandbox/index.js` |
| `security/pipeline/phases/exploitation.phase.js` | `../../../knowledge/index.js` | `knowledge/index.js` | `mind/knowledge/index.js` | `../../../mind/knowledge/index.js` |
| `security/pipeline/phases/recon.phase.js` | `../../../knowledge/index.js` | `knowledge/index.js` | `mind/knowledge/index.js` | `../../../mind/knowledge/index.js` |
| `security/pipeline/phases/reporting.phase.js` | `../../../knowledge/index.js` | `knowledge/index.js` | `mind/knowledge/index.js` | `../../../mind/knowledge/index.js` |
| `security/pipeline/phases/reporting.phase.js` | `../../../verification/verifiers/index.js` | `verification/verifiers/index.js` | `tests/verification/verifiers/index.js` | `../../../tests/verification/verifiers/index.js` |
| `security/pipeline/phases/verification.phase.js` | `../../../knowledge/index.js` | `knowledge/index.js` | `mind/knowledge/index.js` | `../../../mind/knowledge/index.js` |
| `security/pipeline/phases/verification.phase.js` | `../../../verification/verifiers/index.js` | `verification/verifiers/index.js` | `tests/verification/verifiers/index.js` | `../../../tests/verification/verifiers/index.js` |
| `skills/design/diagram-design/brand.js` | `src` | `src` | `interfaces/console` | `interfaces/console` |

---

## Skipped — false positives (refs that must NOT change)

| file | ref | reason |
| --- | --- | --- |
| `capabilities/tools/domains/lsp/check-index-coverage.tool.js` | `../../../server/src/tools/interface/ToolDefinition.js` | server-internal (false friend) |
| `capabilities/tools/domains/lsp/delete-project.tool.js` | `../../../server/src/tools/interface/ToolDefinition.js` | server-internal (false friend) |
| `capabilities/tools/domains/lsp/detect-changes.tool.js` | `../../../server/src/tools/interface/ToolDefinition.js` | server-internal (false friend) |
| `capabilities/tools/domains/lsp/get-architecture.tool.js` | `../../../server/src/tools/interface/ToolDefinition.js` | server-internal (false friend) |
| `capabilities/tools/domains/lsp/get-code-snippet.tool.js` | `../../../server/src/tools/interface/ToolDefinition.js` | server-internal (false friend) |
| `capabilities/tools/domains/lsp/get-graph-schema.tool.js` | `../../../server/src/tools/interface/ToolDefinition.js` | server-internal (false friend) |
| `capabilities/tools/domains/lsp/index-repository.tool.js` | `../../../server/src/tools/interface/ToolDefinition.js` | server-internal (false friend) |
| `capabilities/tools/domains/lsp/index-status.tool.js` | `../../../server/src/tools/interface/ToolDefinition.js` | server-internal (false friend) |
| `capabilities/tools/domains/lsp/index.js` | `../../../server/src/tools/registry/ToolRegistry.js` | server-internal (false friend) |
| `capabilities/tools/domains/lsp/ingest-traces.tool.js` | `../../../server/src/tools/interface/ToolDefinition.js` | server-internal (false friend) |
| `capabilities/tools/domains/lsp/list-projects.tool.js` | `../../../server/src/tools/interface/ToolDefinition.js` | server-internal (false friend) |
| `capabilities/tools/domains/lsp/manage-adr.tool.js` | `../../../server/src/tools/interface/ToolDefinition.js` | server-internal (false friend) |
| `capabilities/tools/domains/lsp/query-graph.tool.js` | `../../../server/src/tools/interface/ToolDefinition.js` | server-internal (false friend) |
| `capabilities/tools/domains/lsp/search-code.tool.js` | `../../../server/src/tools/interface/ToolDefinition.js` | server-internal (false friend) |
| `capabilities/tools/domains/lsp/search-graph.tool.js` | `../../../server/src/tools/interface/ToolDefinition.js` | server-internal (false friend) |
| `capabilities/tools/domains/lsp/trace-path.tool.js` | `../../../server/src/tools/interface/ToolDefinition.js` | server-internal (false friend) |
| `capabilities/tools/registry/governance.js` | `../../server/src/services/ToolRegistry.js` | server-internal (false friend) |
| `capabilities/tools/registry/governance.js` | `../../server/src/tools/registry/ToolRegistry.js` | server-internal (false friend) |
| `runtime/events/hud/consumer.js` | `../../server/src/services/Observer.js` | server-internal (false friend) |
| `runtime/events/hud/producer.js` | `../../server/src/services/director/Mission.js` | server-internal (false friend) |
| `runtime/events/hud/producer.js` | `../../server/src/services/director/Mission.js` | server-internal (false friend) |
| `runtime/events/hud/producer.js` | `../../server/src/services/director/Mission.js` | server-internal (false friend) |
| `server/scripts/scope-b-probe.mjs` | `./add.js` | server-internal (false friend) |
| `server/sdk/client.js` | `./sdk/client.js` | server-internal (false friend) |
| `server/src/memory/index.js` | `./memory/index.js` | server-internal (false friend) |
| `server/src/services/AgentGateway.js` | `./Emailer.js` | server-internal (false friend) |
| `server/src/skills/catalog.js` | `./skills/catalog.js` | server-internal (false friend) |
| `server/src/skills/executor.js` | `./skills/executor.js` | server-internal (false friend) |
| `server/src/skills/index.js` | `./skills/index.js` | server-internal (false friend) |
| `server/test-audit-b48.js` | `./JexiIdentity.js` | server-internal (false friend) |
| `server/test-b212.js` | `./calc.js` | server-internal (false friend) |
| `server/test-code-intel.js` | `./lib.js` | server-internal (false friend) |
| `server/test-everything.js` | `./lib/math` | server-internal (false friend) |
| `server/test-lsp.js` | `./lib.js` | server-internal (false friend) |
| `server/test-roster-registry.js` | `./src/services/AgentRoster.js` | server-internal (false friend) |
| `server/tests/agi/test-verification-spawn.js` | `./add.js` | server-internal (false friend) |
| `server/tests/agi/test-verification-spawn.js` | `./add.js` | server-internal (false friend) |
| `server/tests/agi/test-verification-spawn.js` | `./add.js` | server-internal (false friend) |
| `server/tests/agi/test-verification-spawn.js` | `./add.js` | server-internal (false friend) |
| `server/tests/autonomy/long-horizon-mission.js` | `./server.js` | server-internal (false friend) |

Additional false positives rejected during manual root-variable review (temp/fixture/bundle/content roots):

| file | literal | root variable | why skipped |
| --- | --- | --- | --- |
| `agents/workforce/agents/loader.js` | `agents / jexi-agents` | `root` (param) | walk root is ambiguous — could be the NEW `agents/` parent (see report note) |
| `scripts/phase13-scope-a.mjs` | `agents` | `tmpDir` | mkdtemp fixture |
| `scripts/phase13-scope-c-fix*.mjs` | `workforce/nexus/vendor` | `tmp` | fixture mirror of the repo layout |
| `scripts/phase28-*.mjs, phase31-scope-*.mjs` | `brain` | `RT`/`fixtureRoot` | temp runtime roots |
| `server/src/wiring/phase31-bootstrap.js` | `brain` | `runtime` | JEXI_W31 runtime dir, not the repo |
| `server/src/config.js` | `knowledge` | `DATA_DIR` | data dir |
| `server/index.js` | `public` | `SERVER_ROOT` | `server/public` symlink → `../dist` |
| `server/tests/autonomy/long-horizon-mission.js` | `public` | `ws` | workspace dir |
| `capabilities/commands/_context.js` | `src` | `r` | candidate server root |
| `scripts/phase31-scope-12-probe.mjs` | `src` | `MINI_REPO` | benchmark fixture |
| `scripts/scope-g/run-probes.mjs` | `src/commands/learning` | `REPO_ROOT`/`SERVER_ROOT` | hard-coded foreign path `/home/z/my-project/...` |
| `server/src/wiring/phase31-repoctx.js` | `src` | `SERVER_ROOT` | server-internal (false friend) |
| `server/test-commands.js` | `src` | `SERVER_ROOT` | server-internal |
| `server/test-permissions-modes.js` | `src` | `__d` | server dir |
| `server/test-context-engine.js / test-github-repo.js` | `src` | `repo`/`dir` | mkdtemp fixtures |
| `server/tests/agi/fixtures/verify-pkg/run-from-cwd.js` | `src` | `cwd` | fixture cwd |
| `server/test-dsh-batch12.js` | `hooks` | `SRC_DIR` | server/src → false friend |
| `server/tests/agi/test-mcp-gateway.js` | `memory` | — | MCP server **name**, not a path |
| `scripts/phase22-d-import.mjs / phase22-d-probe.mjs` | `hooks/*` | `SRC`/`ABS` | plugin-bundle-internal layout |
| `server/test-dsh-batch14.js` | `src/App.jsx` | — | test **content** assertion, not a filesystem ref |

---

## UNRESOLVABLE — for Stage 3B-3 (not edited)

| file | ref | old_target | mapped target | why |
| --- | --- | --- | --- | --- |
| `agents/swarm/hive/index.js` | `swarm/hive/index.js` | `swarm/hive/index.js` | `agents/swarm/hive/index.js` | recompute mismatch |
| `agents/workforce/agents/index.js` | `./workforce/agents/index.js` | `workforce/agents/workforce/agents/index.js` | `agents/workforce/agents/workforce/agents/index.js` | mapped target missing |
| `agents/workforce/agents/index.js` | `./workforce/agents/index.js` | `workforce/agents/workforce/agents/index.js` | `agents/workforce/agents/workforce/agents/index.js` | mapped target missing |
| `agents/workforce/divisions/index.js` | `./workforce/divisions/index.js` | `workforce/divisions/workforce/divisions/index.js` | `agents/workforce/divisions/workforce/divisions/index.js` | mapped target missing |
| `agents/workforce/divisions/index.js` | `./workforce/divisions/index.js` | `workforce/divisions/workforce/divisions/index.js` | `agents/workforce/divisions/workforce/divisions/index.js` | mapped target missing |
| `agents/workforce/identity/index.js` | `./workforce/identity/index.js` | `workforce/identity/workforce/identity/index.js` | `agents/workforce/identity/workforce/identity/index.js` | mapped target missing |
| `agents/workforce/identity/index.js` | `./workforce/identity/index.js` | `workforce/identity/workforce/identity/index.js` | `agents/workforce/identity/workforce/identity/index.js` | mapped target missing |
| `agents/workforce/nexus/index.js` | `./workforce/nexus/index.js` | `workforce/nexus/workforce/nexus/index.js` | `agents/workforce/nexus/workforce/nexus/index.js` | mapped target missing |
| `agents/workforce/nexus/index.js` | `./workforce/nexus/index.js` | `workforce/nexus/workforce/nexus/index.js` | `agents/workforce/nexus/workforce/nexus/index.js` | mapped target missing |
| `agents/workforce/registry/index.js` | `./workforce/registry` | `workforce/registry/workforce/registry` | `agents/workforce/registry/workforce/registry` | mapped target missing |
| `agents/workforce/registry/index.js` | `./workforce/registry` | `workforce/registry/workforce/registry` | `agents/workforce/registry/workforce/registry` | mapped target missing |
| `agents/workforce/trust/index.js` | `./workforce/trust/index.js` | `workforce/trust/workforce/trust/index.js` | `agents/workforce/trust/workforce/trust/index.js` | mapped target missing |
| `capabilities/commands/index.js` | `./commands/index.js` | `commands/commands/index.js` | `capabilities/commands/commands/index.js` | mapped target missing |
| `capabilities/graph/context-hook.js` | `../../../capability/code/graph-first.js` | `../../capability/code/graph-first.js` | `../../capability/code/graph-first.js` | mapped target missing |
| `capabilities/graph/rag/index.js` | `./capability/rag/index.js` | `capability/rag/capability/rag/index.js` | `capabilities/graph/rag/capability/rag/index.js` | mapped target missing |
| `capabilities/tools/domains/lsp/_graph.js` | `capability/code/graph/db` | `capability/code/graph/db` | `capabilities/graph/code/graph/db` | mapped target missing |
| `capabilities/tools/registry/audit.js` | `tools/registry/audit.js` | `tools/registry/audit.js` | `capabilities/tools/registry/audit.js` | recompute mismatch |
| `harness/adapters/_convert.js` | `workforce/coworkers` | `workforce/coworkers` | `agents/workforce/coworkers` | mapped target missing |
| `harness/adapters/_convert.js` | `workforce/coworkers` | `workforce/coworkers` | `agents/workforce/coworkers` | mapped target missing |
| `harness/adapters/index.js` | `./harness/adapters` | `harness/adapters/harness/adapters` | `harness/adapters/harness/adapters` | mapped target missing |
| `harness/adapters/index.js` | `./harness/adapters/index.js` | `harness/adapters/harness/adapters/index.js` | `harness/adapters/harness/adapters/index.js` | mapped target missing |
| `harness/forge/index.js` | `./harness/forge/index.js` | `harness/forge/harness/forge/index.js` | `harness/forge/harness/forge/index.js` | mapped target missing |
| `harness/hardening/forgejo/index.js` | `../harness/hardening/forgejo/index.js` | `harness/hardening/harness/hardening/forgejo/index.js` | `harness/hardening/harness/hardening/forgejo/index.js` | mapped target missing |
| `harness/hardening/madtea/index.js` | `../harness/hardening/madtea/index.js` | `harness/hardening/harness/hardening/madtea/index.js` | `harness/hardening/harness/hardening/madtea/index.js` | mapped target missing |
| `harness/hardening/ralph/index.js` | `../harness/hardening/ralph/index.js` | `harness/hardening/harness/hardening/ralph/index.js` | `harness/hardening/harness/hardening/ralph/index.js` | mapped target missing |
| `harness/index.js` | `./harness/adapters` | `harness/harness/adapters` | `harness/harness/adapters` | mapped target missing |
| `integrations/providers/tokens/ephemeral.js` | `providers/tokens/ephemeral.js` | `providers/tokens/ephemeral.js` | `integrations/providers/tokens/ephemeral.js` | recompute mismatch |
| `mind/brain/index/index.js` | `../brain/index/index.js` | `brain/brain/index/index.js` | `mind/brain/brain/index/index.js` | mapped target missing |
| `mind/brain/kg/index.js` | `../brain/kg/index.js` | `brain/brain/kg/index.js` | `mind/brain/brain/kg/index.js` | mapped target missing |
| `mind/brain/repo/index.js` | `../brain/repo/index.js` | `brain/brain/repo/index.js` | `mind/brain/brain/repo/index.js` | mapped target missing |
| `mind/brain/search/index.js` | `../brain/search/index.js` | `brain/brain/search/index.js` | `mind/brain/brain/search/index.js` | mapped target missing |
| `mind/knowledge/index.js` | `knowledge/index.js` | `knowledge/index.js` | `mind/knowledge/index.js` | recompute mismatch |
| `runtime/context/offload/index.js` | `../context/offload/index.js` | `context/context/offload/index.js` | `runtime/context/context/offload/index.js` | mapped target missing |
| `runtime/context/offload/index.js` | `../context/offload/index.js` | `context/context/offload/index.js` | `runtime/context/context/offload/index.js` | mapped target missing |
| `runtime/context/offload/index.js` | `../rlm/kernel/context-variable.js` | `context/rlm/kernel/context-variable.js` | `runtime/context/rlm/kernel/context-variable.js` | mapped target missing |
| `runtime/context/offload/index.js` | `../rlm/kernel/persistent-repl.js` | `context/rlm/kernel/persistent-repl.js` | `runtime/context/rlm/kernel/persistent-repl.js` | mapped target missing |
| `runtime/kernel/daemon/client.js` | `capability/code/graph/db` | `capability/code/graph/db` | `capabilities/graph/code/graph/db` | mapped target missing |
| `runtime/kernel/daemon/codegraph-daemon.js` | `capability/code/graph/db` | `capability/code/graph/db` | `capabilities/graph/code/graph/db` | mapped target missing |
| `runtime/router/resolve.js` | `./router/resolve` | `router/router/resolve` | `runtime/router/router/resolve` | mapped target missing |
| `runtime/runtimes/browser/vision/index.js` | `../runtimes/browser/vision/index.js` | `runtimes/browser/runtimes/browser/vision/index.js` | `runtime/runtimes/browser/runtimes/browser/vision/index.js` | mapped target missing |
| `scripts/phase11-index.mjs` | `capability/code/graph/db` | `capability/code/graph/db` | `capabilities/graph/code/graph/db` | mapped target missing |
| `scripts/phase11-probe-a.mjs` | `capability/code/graph/db` | `capability/code/graph/db` | `capabilities/graph/code/graph/db` | mapped target missing |
| `scripts/phase11-probe-b.mjs` | `./a.js` | `scripts/a.js` | `scripts/a.js` | mapped target missing |
| `scripts/phase11-probe-h.mjs` | `capability/code/graph/db/daemon/daemon.json` | `capability/code/graph/db/daemon/daemon.json` | `capabilities/graph/code/graph/db/daemon/daemon.json` | mapped target missing |
| `scripts/phase14-f-probe.mjs` | `./core.js` | `scripts/core.js` | `scripts/core.js` | mapped target missing |
| `scripts/phase14-f-probe.mjs` | `./model.js` | `scripts/model.js` | `scripts/model.js` | mapped target missing |
| `scripts/phase14-f-probe.mjs` | `./util.js` | `scripts/util.js` | `scripts/util.js` | mapped target missing |
| `scripts/phase15-a-probe.mjs` | `./app.js` | `scripts/app.js` | `scripts/app.js` | mapped target missing |
| `scripts/phase15-a-probe.mjs` | `./lib/math.js` | `scripts/lib/math.js` | `scripts/lib/math.js` | mapped target missing |
| `scripts/phase22-d-import.mjs` | `hooks/hooks-cursor.json` | `hooks/hooks-cursor.json` | `infra/hooks/hooks-cursor.json` | mapped target missing |
| `scripts/phase22-d-import.mjs` | `hooks/run-hook.cmd` | `hooks/run-hook.cmd` | `infra/hooks/run-hook.cmd` | mapped target missing |
| `scripts/phase22-d-import.mjs` | `hooks/session-start` | `hooks/session-start` | `infra/hooks/session-start` | mapped target missing |
| `scripts/phase22-d-probe.mjs` | `hooks/run-hook.sh` | `hooks/run-hook.sh` | `infra/hooks/run-hook.sh` | mapped target missing |
| `scripts/phase22-d-probe.mjs` | `hooks/session-start.sh` | `hooks/session-start.sh` | `infra/hooks/session-start.sh` | mapped target missing |
| `scripts/phase25-scope-h.mjs` | `prompt/assembly/order.js` | `prompt/assembly/order.js` | `capabilities/prompts/assembly/order.js` | recompute mismatch |
| `scripts/phase25-scope-h.mjs` | `prompt/assembly/registry.js` | `prompt/assembly/registry.js` | `capabilities/prompts/assembly/registry.js` | recompute mismatch |
| `scripts/phase25-scope-h.mjs` | `prompt/incidents/index.js` | `prompt/incidents/index.js` | `capabilities/prompts/incidents/index.js` | recompute mismatch |
| `scripts/phase27-scope-c.mjs` | `./loader` | `scripts/loader` | `scripts/loader` | mapped target missing |
| `scripts/phase6-a-probe.mjs` | `./defs` | `scripts/defs` | `scripts/defs` | mapped target missing |
| `scripts/scope-g/run-probes.mjs` | `./commands/index.js` | `scripts/scope-g/commands/index.js` | `scripts/scope-g/commands/index.js` | mapped target missing |
| `scripts/scope-g/run-probes.mjs` | `./commands/registry.js` | `scripts/scope-g/commands/registry.js` | `scripts/scope-g/commands/registry.js` | mapped target missing |
| `scripts/zone-owner-item2-probe.mjs` | `providers/adapters/ollama.provider.js` | `providers/adapters/ollama.provider.js` | `integrations/providers/adapters/ollama.provider.js` | mapped target missing |
| `server/src/workforce/registry/catalog.js` | `workforce/registry/index.js` | `workforce/registry/index.js` | `agents/workforce/registry/index.js` | recompute mismatch |
| `server/test-b210.js` | `src/services/director/EmployeeSession.js` | `src/services/director/EmployeeSession.js` | `interfaces/console/services/director/EmployeeSession.js` | mapped target missing |
| `server/test-b210.js` | `src/services/director/RealAdapters.js` | `src/services/director/RealAdapters.js` | `interfaces/console/services/director/RealAdapters.js` | mapped target missing |
| `server/test-b217.js` | `memory/identity.json` | `memory/identity.json` | `mind/memory/identity.json` | mapped target missing |
| `server/test-b223.js` | `../ToolDiscovery.js` | `ToolDiscovery.js` | `ToolDiscovery.js` | mapped target missing |
| `server/test-b223.js` | `src/services/ToolDiscovery.js` | `src/services/ToolDiscovery.js` | `interfaces/console/services/ToolDiscovery.js` | mapped target missing |
| `server/test-b223.js` | `src/services/director/Director.js` | `src/services/director/Director.js` | `interfaces/console/services/director/Director.js` | mapped target missing |
| `server/test-b224.js` | `src/routes/missionStream.js` | `src/routes/missionStream.js` | `interfaces/console/routes/missionStream.js` | mapped target missing |
| `server/test-everything.js` | `../lib/math` | `lib/math` | `lib/math` | mapped target missing |
| `server/test-everything.js` | `../lib/storage` | `lib/storage` | `lib/storage` | mapped target missing |
| `server/test-everything.js` | `../lib/strings` | `lib/strings` | `lib/strings` | mapped target missing |
| `server/tests/agi/test-lsp-manager.js` | `src/a.ts` | `src/a.ts` | `interfaces/console/a.ts` | mapped target missing |
| `server/tests/agi/test-lsp-manager.js` | `src/b.js` | `src/b.js` | `interfaces/console/b.js` | mapped target missing |
| `server/tests/agi/test-observer-chat-events.js` | `src/services/director/MissionRunner.js` | `src/services/director/MissionRunner.js` | `interfaces/console/services/director/MissionRunner.js` | mapped target missing |
| `services/computer/vlm/provider.js` | `. DECLARED, never both:
//                 base64 -> image is raw bytes sent as a
//                 data:image/png;base64,... URL; url -> image is a URL
//                 string passed through untouched.
//
//   available() -> { available, model? }   static config only: NO call, NO
//                                          health ping, NO transport touch
//   infer({ image, instruction, history? })
//              -> { raw, prediction }      history (optional) overrides the
//                                          internal window for THIS call
//                                          (still windowed); the completed
//                                          turn is always recorded
//                                          internally
//   reset()    -> { cleared }               clears internal history + audit
//
// Request payload (OpenAI chat completions, deterministic key order):
//   { model, messages: [ system(COMPUTER_USE_PROMPT),
//     ...history pairs (TEXT-ONLY user/assistant),
//     user([image_url part, text part]) ], temperature: 0, stream: false }
//   The image rides ONLY on the current user turn; history is text-only
//   (token discipline). temperature 0 declared for determinism.
//
// Prediction extraction (declared, deterministic): the first line of the
// raw content whose trimmed text starts with a frozen Scope A action name
// followed by ` | `computer/vlm/. DECLARED, never both:
/                 base64 -> image is raw bytes sent as a
/                 data:image/png;base64,... URL; url -> image is a URL
/                 string passed through untouched.
/
/   available() -> { available, model? }   static config only: NO call, NO
/                                          health ping, NO transport touch
/   infer({ image, instruction, history? })
/              -> { raw, prediction }      history (optional) overrides the
/                                          internal window for THIS call
/                                          (still windowed); the completed
/                                          turn is always recorded
/                                          internally
/   reset()    -> { cleared }               clears internal history + audit
/
/ Request payload (OpenAI chat completions, deterministic key order):
/   { model, messages: [ system(COMPUTER_USE_PROMPT),
/     ...history pairs (TEXT-ONLY user/assistant),
/     user([image_url part, text part]) ], temperature: 0, stream: false }
/   The image rides ONLY on the current user turn; history is text-only
/   (token discipline). temperature 0 declared for determinism.
/
/ Prediction extraction (declared, deterministic): the first line of the
/ raw content whose trimmed text starts with a frozen Scope A action name
/ followed by ` | `services/computer/vlm/. DECLARED, never both:
/                 base64 -> image is raw bytes sent as a
/                 data:image/png;base64,... URL; url -> image is a URL
/                 string passed through untouched.
/
/   available() -> { available, model? }   static config only: NO call, NO
/                                          health ping, NO transport touch
/   infer({ image, instruction, history? })
/              -> { raw, prediction }      history (optional) overrides the
/                                          internal window for THIS call
/                                          (still windowed); the completed
/                                          turn is always recorded
/                                          internally
/   reset()    -> { cleared }               clears internal history + audit
/
/ Request payload (OpenAI chat completions, deterministic key order):
/   { model, messages: [ system(COMPUTER_USE_PROMPT),
/     ...history pairs (TEXT-ONLY user/assistant),
/     user([image_url part, text part]) ], temperature: 0, stream: false }
/   The image rides ONLY on the current user turn; history is text-only
/   (token discipline). temperature 0 declared for determinism.
/
/ Prediction extraction (declared, deterministic): the first line of the
/ raw content whose trimmed text starts with a frozen Scope A action name
/ followed by ` | mapped target missing |
| `services/semantica/decisions/index.js` | `./semantica/decisions/index.js` | `semantica/decisions/semantica/decisions/index.js` | `services/semantica/decisions/semantica/decisions/index.js` | mapped target missing |
| `services/semantica/graph/index.js` | `./semantica/graph/index.js` | `semantica/graph/semantica/graph/index.js` | `services/semantica/graph/semantica/graph/index.js` | mapped target missing |
| `services/semantica/ontology/index.js` | `./semantica/ontology/index.js` | `semantica/ontology/semantica/ontology/index.js` | `services/semantica/ontology/semantica/ontology/index.js` | mapped target missing |
| … | | | | **84 total** |

Two classes dominate:

* **refs INTO `server/src/`** (e.g. `../../../server/src/tools/interface/ToolDefinition.js`, `../../server/src/services/director/Mission.js`) — the false-friend family. These are *not* moved-dir refs; they were skipped by design and need a separate decision by the lead.
* **pre-existing rot** (e.g. `./workforce/agents/index.js` inside `agents/workforce/agents/index.js`, `../brain/index/index.js` inside `mind/brain/index/index.js`) — broken before the restructure too, because the segment repeats after the move-depth was already wrong.

---

## Verification

```console
$ npm run build
✓ 1126+ modules transformed.
✓ built in 22.89s          # exit 0 — 0 unresolved imports; dist/ + dist/sw.js emitted
```

### Checkpoint suite (`rm -f scripts/.chunked-state.json && node scripts/run-tests-chunked.js`)

| metric | 3B-2a | 3B-2b | delta |
| --- | ---: | ---: | ---: |
| pass | 55 | **175** | **+120** |
| fail | 145 | **25** | **−120** |
| total | 200 | 200 | 0 |

**New failures introduced by this stage: 0** (failure-set diff against the 3B-2a run: 120 fixed, 0 new).

Remaining 25 failures (pre-existing or outside this stage's ref class):

| test | area |
| --- | --- |
| `test-learning.js` | learning seam |
| `test-hud.js` | hud seam |
| `test-dsh-batch7/9/10/11/12/13.js` | DSH batch suites |
| `test-everything.js` | mega suite |
| `scripts/audit-roster.js --check` | roster audit |
| `test-b49.js` | B49 |
| `test-b53.js` | B53 |
| `test-b78.js` | B78 |
| `test-permissions-modes.js` | permissions |
| `../interfaces/cli/test-cli.js` | cli server-dir discovery (3B-2 leftover, source) |
| `test-b206.js / b206b / b207` | B206-207 |
| `test-b224.js / b225.js` | B224-225 |
| `tests/agi/test-workgraph-persistence.js` | AGI workgraph |
| `tests/agi/test-verification-independence.js` | AGI verification |
| `tests/agi/test-verification-spawn.js` | AGI verification |
| `tests/agi/test-scheduler.js` | AGI scheduler |
| `tests/agi/test-memory-provider.js` | AGI memory provider |

### Notes / follow-ups (not changed in this stage)

* `.gitignore:42` still carries the pre-move rule `hooks/state/`, so the now-correct `infra/hooks/state/` is **no longer ignored** — the hook scripts started writing there again during the suite run. Left untouched (outside this stage's zone); recommend adding `infra/hooks/state/` in a config pass.
* `agents/workforce/agents/loader.js` and `agents/workforce/registry/catalog.js` reference a bare `agents` walk root. Ambiguous (could legitimately mean the NEW `agents/` parent), so it was **not** rewritten — lead decision required.
* `scripts/scope-g/run-probes.mjs` hard-codes a foreign absolute path (`/home/z/my-project/jexi-os`) — unusable outside its author's machine.

Also checked: no `server/src/**` file was rewritten to a server-internal target (all 4 guarded-dir edits point outside `server/`), and every new ref re-resolved on disk before writing.

