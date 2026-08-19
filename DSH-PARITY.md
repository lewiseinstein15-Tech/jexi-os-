# DSH → JEXI Parity Tracker

**Generated:** 2026-08-19T04:27:06.693Z · **Packages tracked:** 123 · **Ported:** 123 (100%) · **Partial:** 0 · **Not yet:** 0

Every DeepSeek Harness package JEXI has pulled, its JEXI port, and the batch that landed it. Regenerate with `node server/scripts/audit-bundles.js`.

## acp (1)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ acp/acp | ported | AcpServer.js | B134 |

## api (2)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ api/gateway | ported | gatewayStatus + src/utils/gatewayClient.js | B137/B140 |
| ✅ api/remotes | ported | RemoteAgents.js | B138 |

## attachment (1)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ attachment | ported | AttachmentPolicy.js | B133 |

## boot (1)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ boot/app-boot | ported | BootProfile.js + ConfigReload.js | B136/B138 |

## bundle (2)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ bundle/base | ported | BundleBase.js + manifest.json | B140 |
| ✅ bundle/headless | ported | cli.js | B136 |

## client (5)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ client/connection | ported | ClientConnection.js | B139 |
| ✅ client/hmr | ported | ClientHmr.js | B139 |
| ✅ client/locale | ported | Locale.js | B139 |
| ✅ client/modules | ported | src/utils/clientModules.js (slots/sessions/workspaces/events/tz/baseline) | B143 |
| ✅ client/runtime | ported | src/utils/jexiRuntime.js | B140 |

## code-runtime (2)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ code-runtime/code-runtime | ported | CodeModeRuntime.js | B99 |
| ✅ code-runtime/code-runtime-worker-thread | ported | code-worker.js + CodeRuntimeBootstrap.js | B138 |

## compaction (1)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ compaction/compaction-policy | ported | CompactionEngine.js | B100 |

## context (5)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ context/agent-instructions | ported | AgentInstructions.js (AGENTS.md) | B136 |
| ✅ context/session-reference | ported | SessionReference.js | B109 |
| ✅ context/time-context | ported | TimeContext.js | B104 |
| ✅ context/tmux-context | ported | TmuxContext.js | B138 |
| ✅ time-context | ported | TimeContext.js | B104 |

## core (4)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ core/agent-loop | ported | AgentLoop.js | B96 |
| ✅ core/session | ported | SessionConversations.js | B96 |
| ✅ core/tool-session-query | ported | session-search/session-list | B96 |
| ✅ core/tools | ported | ToolRuntime.js + ToolRegistry.js | B96-B101 |

## credentials (1)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ credentials/credentials-local | ported | CredentialStore.js | B134 |

## diagnostics (1)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ runtime-diagnostics/invariants | ported | SessionInvariants.js | B133 |

## examples (1)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ examples/* | ported | server/examples/* | B137/B139 |

## extensions (2)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ extensions/cordis-runner-* | ported | CordisRunner.js + cordis_define/run/stop/undefine/inspect_self tools | B143 |
| ✅ extensions/tool-cordis | ported | CordisInspect.js + cordis_inspect_list/query tools | B142 |

## feedback (2)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ feedback/command-feedback | ported | addCommandFeedback | B132 |
| ✅ feedback/message-feedback | ported | FeedbackStore.js | B106 |

## fs (2)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ fs/fs-sandbox | ported | FsSandbox.js | B136 |
| ✅ fs/tool-fs | ported | coding plugin write/read/edit/list_files | B126 |

## goal (3)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ goal/goal-jobs | ported | GoalJobQueue.js | B85-B89 |
| ✅ goal/goal-round-driver | ported | GoalTools.js (round driver) | B134 |
| ✅ goal/tool-goal | ported | GoalTools.js | B132 |

## guard (2)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ guard/repeat-tool-reminder | ported | repeat-tool-reminder thresholds | B106 |
| ✅ guard/timeout-policy | ported | timeoutMs + tier defaults | B101 |

## hooks (3)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ hooks/hook-protocol | ported | HookBridges.js | B135 |
| ✅ hooks/hooks-claude-code | ported | HookBridges.js (claude-code dialect) | B135 |
| ✅ hooks/hooks-codex | ported | HookBridges.js (codex dialect) | B135 |

## host (6)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ host/apiproxy | ported | ApiProxy.js | B141 |
| ✅ host/directory-picker | ported | DirectoryPicker.js | B139 |
| ✅ host/directory-picker-browse | ported | DirectoryPicker.js (browse) | B139 |
| ✅ host/frontend-static | ported | HostStatus.js (static facts) + express.static | B137 |
| ✅ host/plugin-inventory | ported | PluginInventory.js | B136 |
| ✅ host/webserver | ported | HostStatus.js | B137 |

## identity (2)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ identity/anonymous-user-id | ported | AnonymousId.js | B133 |
| ✅ identity/identity | ported | AnonymousId.js + JexiIdentity | B103/B133 |

## interaction (5)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ interaction/commands | ported | CommandRegistry.js | B133/B139 |
| ✅ interaction/permission-presets | ported | PermissionPresets.js + SettingsPanel UI | B137/B138 |
| ✅ interaction/tool-ask-user | ported | PendingQuestions.js + ask_user_question | B110 |
| ✅ interaction/user-approval | ported | UserApproval.js | B137 |
| ✅ interaction/user-questions | ported | PendingQuestions.js | B110 |

## jobs (1)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ jobs/background-jobs | ported | BackgroundJobs.js | B106 |

## llm (2)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ llm/llm-provider | ported | LLMClient.js | existing |
| ✅ llm/llm-retry | ported | RetryPolicy.js | B133 |

## lsp (1)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ lsp/tool-lsp | ported | lsp plugin | B131 |

## mcp (2)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ mcp/mcp-client | ported | McpClient.js | B135 |
| ✅ mcp/mcp-server | ported | mcp-server.js | existing |

## plan (1)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ plan/plan-mode | ported | PlanMode.js | B110-B113 |

## preset (2)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ preset/agent-presets | ported | PresetManager.js + PresetDiscovery.js | B102/B139 |
| ✅ preset/persona | ported | PersonaManager.js | B137 |

## sandbox (3)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ e2b/e2b | ported | SandboxLocal.e2bStatus | B142 |
| ✅ sandbox/sandbox-local | ported | SandboxLocal.js | B135 |
| ✅ sandbox/sandbox-policy | ported | SandboxMode.js | B134 |

## schedule (1)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ schedule/schedule | ported | ScheduleRuntime.js + schedule tools | B137/B140 |

## sdk (3)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ sdk/client | ported | server/sdk/client.js | B140 |
| ✅ sdk/protocol | ported | sdk/protocol.js + sdk/codec.js | B140/B142 |
| ✅ sdk/server | ported | sdk/server.js | B141 |

## session (10)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ session/session-checkpoint-policy | ported | SessionCheckpoints.js | B132 |
| ✅ session/session-persistence | ported | SessionConversations.js (.jsonl) | B96 |
| ✅ session/session-persistence-jsonl | ported | SessionConversations.js | B96 |
| ✅ session/session-persistence-sqlite | ported | SessionPersistenceSqlite.js | B135 |
| ✅ session/session-projection | ported | SessionProjection.js | B136 |
| ✅ session/session-projection-cache | ported | SessionProjection.js (cache) | B136 |
| ✅ session/session-reference | ported | SessionReference.js | B109 |
| ✅ session/session-stats | ported | SessionStats.js | B108 |
| ✅ session/session-stats-fold | ported | SessionStats.js | B109 |
| ✅ session/session-title | ported | SessionTitles.js | B108 |

## settings (2)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ settings/settings | ported | SettingsManager.js | existing |
| ✅ settings/settings-file | ported | SettingsFile.js | B135 |

## shell (6)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ shell/bash-local | ported | Runner.js runCommand | B126 |
| ✅ shell/bash-sandbox | ported | SandboxLocal.sandboxPolicyFor + bash sandbox facts | B142 |
| ✅ shell/shell-env | ported | ShellEnv.js | B136 |
| ✅ shell/tool-bash | ported | coding plugin bash tool | B126 |
| ✅ shell/tool-bash-persistent | ported | BashPersistent.js | B135 |
| ✅ shell/tool-pwsh | ported | pwsh tool | B141 |

## skill (1)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ skill/tool-skill | ported | skill-load/skill-search + SkillDiscovery.js | B96/B98 |

## spill (1)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ spill/spill-policy | ported | SpillStore.js | B100 |

## storage (4)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ storage/storage | ported | StorageHub.js | B135 |
| ✅ storage/storage-domain | ported | StorageDomain.js | B141 |
| ✅ storage/storage-json | ported | StorageHub.js (json backend) | B135 |
| ✅ storage/storage-sqlite | ported | StorageHub.js (sqlite backend) | B135 |

## subagent (10)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ subagent/subagent-acp | ported | SubagentProviders.js | B138 |
| ✅ subagent/subagent-claude-code | ported | SubagentProviders.js | B138 |
| ✅ subagent/subagent-codex | ported | SubagentProviders.js | B138 |
| ✅ subagent/subagent-dsh-sdk | ported | SubagentProviders.js | B138 |
| ✅ subagent/subagent-fork-in-process | ported | runIsolatedSubagent | B50 |
| ✅ subagent/subagent-in-process-driver | ported | SubagentRuntime.js | B96 |
| ✅ subagent/subagent-spawn-in-process | ported | SubagentRuntime.js | B96 |
| ✅ subagent/tool-subagent | ported | subagent tool + SubagentRuntime.js | B96 |
| ✅ subagent/tool-subagent-control | ported | send_message/interrupt_agent | B115 |
| ✅ subagent/tool-subagent-report | ported | SubagentReport.js + report tool | B137 |

## subprocess (2)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ subprocess/subprocess | ported | SubprocessLocal.js + shellEnv scrub | B136/B140 |
| ✅ subprocess/subprocess-local | ported | SubprocessLocal.js | B136 |

## terminal (1)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ terminal/tool-terminal | ported | TerminalSessions.js | B134 |

## test-support (2)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ test-support/llm-mock-server | ported | test-support/llm-mock-server.js | B141 |
| ✅ test-support/llm-replay | ported | test-support/llm-replay.js | B137 |

## todo (1)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ todo/tool-todo | ported | TodoStore.js + todo tool | B96 |

## typert (4)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ typert/generator | ported | TypingGenerator.js (workspace mode) | B139/B141 |
| ✅ typert/loader | ported | TypingGenerator.js (loader) | B139 |
| ✅ typert/protocol | ported | TypingProtocol.js | B138 |
| ✅ typert/registry | ported | TypingGenerator.js (registry) | B139 |

## ui (1)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ ui-* | ported | src/components/* + hooks (all ui-* surfaces mirrored) | B117-B143 |

## util (3)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ util/home-paths | ported | HomePaths.js | B135 |
| ✅ util/launch-environment | ported | LaunchEnvironment.js | B135 |
| ✅ util/timeout | ported | tool timeoutMs + tier defaults | B101 |

## web (3)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ web/tool-web | ported | research plugin (web_search/web_fetch) | B125 |
| ✅ web/web | ported | src/utils/web.js (WebRuntime provider registry + renderer + SSE) | B143 |
| ✅ web/web-react | ported | src/hooks/index.js (hooks barrel: useJexiEngine/useProjection/usePluginInventory/useUpdateChecker/useSlots) | B143 |

## workflow (2)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ workflow/tool-ralph | ported | RalphRunner.js + ralph tool | B135 |
| ✅ workflow/tool-workflow | ported | WorkflowEngine.js | B115 |

## Status legend

- ✅ **ported** — the DSH contract is mirrored in JEXI (service, tool, or UI).
- 🟡 **partial** — the core surface is covered; deep internals remain.
- ⬜ **not-yet** — still on the map for the next "Pull all".
