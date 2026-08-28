# DSH → JEXI Parity Tracker

**Generated:** 2026-08-28T00:21:24.100Z · **Packages tracked:** 229 · **Ported:** 229 (100%) · **Partial:** 0 · **Not yet:** 0

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

## attachment (2)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ attachment/attachment | ported | AttachmentPolicy.js | B133 |
| ✅ attachment/attachment-local | ported | AttachmentPolicy.js (local uploads) | B133 |

## boot (2)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ boot/app-boot | ported | BootProfile.js + ConfigReload.js | B136/B138 |
| ✅ boot/cmdline | ported | cli.js parseCliArgs | B144 |

## bundle (3)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ bundle/base | ported | BundleBase.js + manifest.json | B140 |
| ✅ bundle/headless | ported | cli.js | B136 |
| ✅ bundle/web-app | ported | src/ (React app + vite bundle) | B117-B144 |

## client (42)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ client/connection | ported | ClientConnection.js | B139 |
| ✅ client/hmr | ported | ClientHmr.js | B139 |
| ✅ client/locale | ported | Locale.js | B139 |
| ✅ client/modules | ported | src/utils/clientModules.js | B143 |
| ✅ client/runtime | ported | src/utils/jexiRuntime.js | B140 |
| ✅ client/schema-form | ported | src/utils/schemaForm.js | B141 |
| ✅ client/ui-agent-preset | ported | src/components (SettingsPanel presets) | B117-B144 |
| ✅ client/ui-attachment | ported | src/components (upload handling (ChatWindow)) | B117-B144 |
| ✅ client/ui-brand-official | ported | src/brand/official.jsx (+ App sidebar slots) | B160 |
| ✅ client/ui-commands | ported | src/components (CommandCenter) | B117-B144 |
| ✅ client/ui-conversation | ported | src/components (ConversationsScreen) | B117-B144 |
| ✅ client/ui-deliverables | ported | src/components (DownloadPanel) | B117-B144 |
| ✅ client/ui-directory-picker-browse | ported | src/components (DirectoryPicker + browse UI) | B117-B144 |
| ✅ client/ui-directory-picker-native | ported | src/components (DirectoryPicker.js) | B117-B144 |
| ✅ client/ui-goal | ported | src/components (GoalsScreen) | B117-B144 |
| ✅ client/ui-input-trigger | ported | src/components (QUICK ACTIONS row) | B117-B144 |
| ✅ client/ui-jobs | ported | src/components (jobs UI (run_in_background cards)) | B117-B144 |
| ✅ client/ui-layout | ported | src/components (App.jsx layout + TopNav) | B117-B144 |
| ✅ client/ui-message-feedback | ported | src/components (feedback buttons) | B117-B144 |
| ✅ client/ui-model-selection | ported | src/components (modelSelection.js) | B117-B144 |
| ✅ client/ui-permission-presets | ported | src/components (SettingsPanel permission card) | B117-B144 |
| ✅ client/ui-plan | ported | src/components (plan card + plan-review card) | B117-B144 |
| ✅ client/ui-primitives | ported | src/components (CapabilityCards + shared UI primitives) | B117-B144 |
| ✅ client/ui-reference | ported | src/utils/referenceSource.js | B160 |
| ✅ client/ui-renderer | ported | src/utils/uiRenderer.jsx (slot registry + assembled root) | B160 |
| ✅ client/ui-settings | ported | src/components (SettingsPanel) | B117-B144 |
| ✅ client/ui-settings-general | ported | src/components (SettingsPanel general) | B117-B144 |
| ✅ client/ui-settings-models | ported | src/components (SettingsPanel models) | B117-B144 |
| ✅ client/ui-settings-plugin-inventory | ported | src/components (usePluginInventory hook) | B117-B144 |
| ✅ client/ui-settings-plugins | ported | src/components (SettingsPanel LOADED PLUGINS) | B117-B144 |
| ✅ client/ui-sidebar | ported | src/components (NavList + BottomNavigation) | B117-B144 |
| ✅ client/ui-skill | ported | src/components (SkillsScreen) | B117-B144 |
| ✅ client/ui-slots | ported | src/components (useSlots hook) | B117-B144 |
| ✅ client/ui-subagent | ported | src/components (subagent cards) | B117-B144 |
| ✅ client/ui-theme | ported | src/components (theme.js) | B117-B144 |
| ✅ client/ui-tool | ported | src/components (tool result cards) | B117-B144 |
| ✅ client/ui-trajectory | ported | src/components (ActivityWindow) | B117-B144 |
| ✅ client/ui-user-questions | ported | src/components (question card) | B117-B144 |
| ✅ client/ui-workflow-run | ported | src/components (workflow run UI) | B117-B144 |
| ✅ client/ui-workspace | ported | src/components (ProjectsScreen + WorkspaceEntity UI) | B136/B144 |
| ✅ client/web | ported | src/main.jsx + App.jsx | B117-B144 |
| ✅ client/web-react | ported | src/hooks/index.js (hooks barrel) | B143 |

## code-runtime (3)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ code-runtime/code-runtime | ported | CodeModeRuntime.js | B99 |
| ✅ code-runtime/code-runtime-python | ported | CodeRuntimePython.js + plugins/python-run | B160 |
| ✅ code-runtime/code-runtime-worker-thread | ported | code-worker.js + CodeRuntimeBootstrap.js | B138 |

## compaction (4)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ compaction/command-compact | ported | /compact command | B100 |
| ✅ compaction/compaction | ported | CompactionEngine.js | B100 |
| ✅ compaction/compaction-basic | ported | CompactionEngine.js (basic mode) | B100 |
| ✅ compaction/compaction-tool-result-pruner | ported | ToolResultPruner.js | B144 |

## context (6)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ context/agent-instructions | ported | AgentInstructions.js (AGENTS.md) | B136 |
| ✅ context/file-reference | ported | FileReference.js (grammar + snapshots) | B160 |
| ✅ context/file-reference-local | ported | FileReference.js (bounded fuzzy index) | B160 |
| ✅ context/session-reference | ported | SessionReference.js | B109 |
| ✅ context/time-context | ported | TimeContext.js | B104 |
| ✅ context/tmux-context | ported | TmuxContext.js | B138 |

## core (8)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ core/agent | ported | AgentRoster+AgentDefinitions | B96 |
| ✅ core/agent-default-model | ported | ModelRouting.js | B102 |
| ✅ core/agent-loop | ported | AgentLoop.js | B96 |
| ✅ core/agent-tool-presentation | ported | ToolRuntime presentCall/presentResult + tool cards | B101 |
| ✅ core/scope | ported | SubagentRuntime isolation + WorkflowEngine scoping | B96/B115 |
| ✅ core/session | ported | SessionConversations.js | B96 |
| ✅ core/system-prompt | ported | PromptAssembly + JexiPrompt | B119 |
| ✅ core/tools | ported | ToolRuntime+ToolRegistry | B96 |

## credentials (3)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ credentials/authorization | ported | Authorization.js (conversation credential flows) | B160 |
| ✅ credentials/credentials | ported | CredentialStore.js | B134 |
| ✅ credentials/credentials-local | ported | CredentialStore.js | B134 |

## e2b (3)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ e2b/e2b | ported | SandboxLocal.e2bStatus | B142 |
| ✅ e2b/fs-e2b | ported | SandboxLocal sandboxTempDir (per-session fs sandbox) | B135 |
| ✅ e2b/subprocess-e2b | ported | SubprocessLocal + shellEnv scrub | B136 |

## examples (3)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ examples/acp-demo | ported | examples/acp-demo.mjs | B139 |
| ✅ examples/agent-spine-demo | ported | examples/agent-spine-demo.mjs | B139 |
| ✅ examples/jsonrpc-demo | ported | examples/jsonrpc-demo.mjs | B139 |

## experimental (2)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ experimental/agent-team | ported | AgentTeams.js (roster + mailbox + task DAG) | B160 |
| ✅ experimental/tool-agent-team | ported | plugins/agent-team (8 model-facing tools) | B160 |

## extensions (4)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ extensions/cordis-client-runner | ported | src/utils/clientModules.js + useSlots | B143 |
| ✅ extensions/cordis-host-runner | ported | CordisRunner.js + cordis tools | B143 |
| ✅ extensions/tool-cordis | ported | CordisInspect.js + cordis_inspect tools | B142 |
| ✅ extensions/ui-cordis | ported | cordis API surface + tool cards | B142/B143 |

## feedback (2)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ feedback/command-feedback | ported | addCommandFeedback | B132 |
| ✅ feedback/message-feedback | ported | FeedbackStore.js | B106 |

## fs (7)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ fs/fs | ported | WorkspaceRuntime.js | existing |
| ✅ fs/fs-local | ported | WorkspaceRuntime.js | existing |
| ✅ fs/fs-observation-policy | ported | SkillDiscovery watchers + observeHostMutationFromArgs | B98 |
| ✅ fs/fs-sandbox | ported | FsSandbox.js | B136 |
| ✅ fs/tool-fs | ported | coding plugin write/read/edit/list_files | B126 |
| ✅ fs/tool-fs-search | ported | fs_search plugin tool | B144 |
| ✅ fs/tool-str-replace-editor | ported | edit tool (old_string replacement) | B126 |

## goal (4)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ goal/command-goal | ported | goal tools + GoalJobQueue commands | B132 |
| ✅ goal/goal | ported | GoalEngine.js | B132 |
| ✅ goal/goal-round-driver | ported | GoalTools.js (round driver) | B134 |
| ✅ goal/tool-goal | ported | GoalTools.js | B132 |

## guard (2)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ guard/repeat-tool-reminder | ported | repeat-tool-reminder thresholds | B106 |
| ✅ guard/timeout-policy | ported | tool timeoutMs + tier defaults | B101 |

## hooks (3)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ hooks/hook-protocol | ported | HookBridges.js | B135 |
| ✅ hooks/hooks-claude-code | ported | HookBridges.js (claude-code dialect) | B135 |
| ✅ hooks/hooks-codex | ported | HookBridges.js (codex dialect) | B135 |

## host (8)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ host/apiproxy | ported | ApiProxy.js | B137/B141 |
| ✅ host/directory-picker | ported | DirectoryPicker.js | B139 |
| ✅ host/directory-picker-auto | ported | DirectoryPicker.js (browse) | B139 |
| ✅ host/directory-picker-browse | ported | DirectoryPicker.js (browse) | B139 |
| ✅ host/directory-picker-native | ported | DirectoryPicker.js | B139 |
| ✅ host/frontend-static | ported | HostStatus.js + express.static | B137/B141 |
| ✅ host/plugin-inventory | ported | PluginInventory.js | B137/B141 |
| ✅ host/webserver | ported | HostStatus.js | B137/B141 |

## identity (1)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ identity/anonymous-user-id | ported | AnonymousId.js | B133 |

## interaction (5)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ interaction/commands | ported | CommandRegistry.js | B133/B139 |
| ✅ interaction/permission-presets | ported | PermissionPresets.js + SettingsPanel UI | B137/B138 |
| ✅ interaction/tool-ask-user | ported | PendingQuestions.js + ask_user_question | B110 |
| ✅ interaction/user-approval | ported | UserApproval.js | B137 |
| ✅ interaction/user-questions | ported | PendingQuestions.js | B110 |

## jobs (3)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ jobs/jobs | ported | GoalJobQueue.js + BackgroundJobs.js | B85/B106 |
| ✅ jobs/jobs-local | ported | BackgroundJobs.js | B106 |
| ✅ jobs/tool-jobs | ported | run_in_background/jobs_collect/job_list/job_kill | B106 |

## llm (5)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ llm/llm | ported | LLMClient.js | existing |
| ✅ llm/llm-deepseek | ported | LLMClient.js (DeepSeek provider) | existing |
| ✅ llm/llm-pi-ai | ported | LLMClient.js provider chain | existing |
| ✅ llm/llm-retry | ported | RetryPolicy.js | B133 |
| ✅ llm/token-meter | ported | TokenMeter.js | B132 |

## lsp (3)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ lsp/lsp | ported | lsp plugin engine | B131 |
| ✅ lsp/lsp-stdio | ported | lsp plugin (stdio spawn) | B131 |
| ✅ lsp/tool-lsp | ported | lsp tool | B131 |

## mcp (1)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ mcp/mcp-client | ported | McpClient.js | B135 |

## plan (1)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ plan/plan-mode | ported | PlanMode.js | B110-B113 |

## preset (2)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ preset/agent-presets | ported | PresetManager.js + PresetDiscovery.js | B102/B139 |
| ✅ preset/persona | ported | PersonaManager.js | B137 |

## runtime-diagnostics (1)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ runtime-diagnostics/invariants | ported | SessionInvariants.js | B133 |

## sandbox (4)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ sandbox/sandbox | ported | SandboxLocal.js (confinement probe) | B135 |
| ✅ sandbox/sandbox-local | ported | SandboxLocal.js | B135 |
| ✅ sandbox/sandbox-policy | ported | SandboxMode.js | B134 |
| ✅ sandbox/sandbox-windows-acl | ported | SandboxLocal.js (per-workspace write identity = session temp dirs) | B135/B142 |

## schedule (1)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ schedule/schedule | ported | ScheduleRuntime.js + schedule_create/list/delete tools | B137/B140 |

## sdk (3)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ sdk/client | ported | sdk/client.js | B140 |
| ✅ sdk/protocol | ported | sdk/protocol.js + sdk/codec.js | B140-B142 |
| ✅ sdk/server | ported | sdk/server.js | B141 |

## session (13)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ session/session-checkpoint-policy | ported | SessionCheckpoints.js | B132 |
| ✅ session/session-persistence | ported | SessionConversations.js (.jsonl) | B96 |
| ✅ session/session-persistence-jsonl | ported | SessionConversations.js (.jsonl) | B96 |
| ✅ session/session-persistence-sqlite | ported | SessionPersistenceSqlite.js | B135 |
| ✅ session/session-projection | ported | SessionProjection.js | B136 |
| ✅ session/session-projection-cache | ported | SessionProjection.js (cache) | B136 |
| ✅ session/session-stats | ported | SessionStats.js | B108 |
| ✅ session/session-telemetry | ported | Telemetry.js | B132 |
| ✅ session/session-telemetry-otel | ported | Telemetry.js (core; OTEL wire exporter n/a on this deployment) | B132 |
| ✅ session/session-title | ported | SessionTitles.js | B108 |
| ✅ session/session-title-all-prompts-llm | ported | SessionTitles (llm over all prompts) | B108 |
| ✅ session/session-title-first-prompt-llm | ported | SessionTitles (first-prompt fallback) | B108 |
| ✅ session/session-title-llm | ported | SessionTitles (llm source) | B108 |

## session-query (4)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ session-query/session-log-export | ported | SessionQuery.js (exportSessionLog) | B144 |
| ✅ session-query/session-query | ported | SessionQuery.js (querySessionLog) | B144 |
| ✅ session-query/session-query-sqlite | ported | SessionQuery.js (querySessionSqlite) | B144 |
| ✅ session-query/tool-session-query | ported | session-search tool | B96 |

## settings (2)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ settings/settings | ported | SettingsManager.js | existing |
| ✅ settings/settings-file | ported | SettingsFile.js | B135 |

## shell (10)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ shell/bash-local | ported | Runner.js runCommand | B126 |
| ✅ shell/bash-sandbox | ported | SandboxLocal.sandboxPolicyFor + bash sandbox facts | B142 |
| ✅ shell/pwsh-local | ported | pwsh tool (local) | B141 |
| ✅ shell/pwsh-sandbox | ported | pwsh tool + sandbox policy | B141/B142 |
| ✅ shell/shell | ported | Runner.js + BashPersistent.js | B126/B135 |
| ✅ shell/shell-env | ported | ShellEnv.js | B136 |
| ✅ shell/tool-bash | ported | coding plugin bash tool | B126 |
| ✅ shell/tool-bash-persistent | ported | BashPersistent.js | B135 |
| ✅ shell/tool-pwsh | ported | pwsh tool | B141 |
| ✅ shell/tool-pwsh-persistent | ported | PwshPersistent.js | B160 |

## skill (4)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ skill/skill | ported | SkillDiscovery.js | B98 |
| ✅ skill/skill-badge | ported | skill catalog badges (SkillsScreen) | B98/B107 |
| ✅ skill/skill-filesystem | ported | SkillDiscovery.js (SKILL.md folders) | B98 |
| ✅ skill/tool-skill | ported | skill-load/skill-search tools | B96/B98 |

## spill (3)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ spill/spill | ported | SpillStore.js | B100 |
| ✅ spill/spill-local | ported | SpillStore.js | B100 |
| ✅ spill/spill-policy | ported | SpillStore.js | B100 |

## storage (4)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ storage/storage | ported | StorageHub.js | B135 |
| ✅ storage/storage-domain | ported | StorageDomain.js | B141 |
| ✅ storage/storage-json | ported | StorageHub.js (json backend) | B135 |
| ✅ storage/storage-sqlite | ported | StorageHub.js (sqlite backend) | B135 |

## subagent (11)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ subagent/subagent | ported | SubagentRuntime.js | B96 |
| ✅ subagent/subagent-acp | ported | SubagentProviders.js (acp) | B138 |
| ✅ subagent/subagent-claude-code | ported | SubagentProviders.js (claude-code) | B138 |
| ✅ subagent/subagent-codex | ported | SubagentProviders.js (codex) | B138 |
| ✅ subagent/subagent-dsh-sdk | ported | SubagentProviders.js (dsh-sdk) | B138 |
| ✅ subagent/subagent-fork-in-process | ported | SubagentRuntime.js | B96 |
| ✅ subagent/subagent-in-process-driver | ported | SubagentRuntime.js | B96 |
| ✅ subagent/subagent-spawn-in-process | ported | SubagentRuntime.js | B96 |
| ✅ subagent/tool-subagent | ported | subagent tool | B96 |
| ✅ subagent/tool-subagent-control | ported | send_message/interrupt_agent | B115 |
| ✅ subagent/tool-subagent-report | ported | SubagentReport.js + report tool | B137 |

## subprocess (2)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ subprocess/subprocess | ported | SubprocessLocal.js + ShellEnv scrub | B136/B140 |
| ✅ subprocess/subprocess-local | ported | SubprocessLocal.js | B136 |

## terminal (3)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ terminal/terminal | ported | TerminalSessions.js | B134 |
| ✅ terminal/terminal-bash | ported | BashPersistent.js | B135 |
| ✅ terminal/tool-terminal | ported | TerminalSessions.js tools | B134 |

## test-support (6)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ test-support/acp-snapshot | ported | test-support/acp-snapshot.js | B144 |
| ✅ test-support/agent-loop-testkit | ported | test-support/agent-loop-testkit.js | B142 |
| ✅ test-support/client-runtime | ported | src/utils/jexiRuntime.js + clientModules.js | B140/B143 |
| ✅ test-support/llm-mock-server | ported | test-support/llm-mock-server.js | B141 |
| ✅ test-support/llm-replay | ported | test-support/llm-replay.js | B137 |
| ✅ test-support/loader-smoke | ported | cli.js --self-test | B136/B144 |

## todo (1)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ todo/tool-todo | ported | TodoStore.js + todo tool | B96 |

## typert (4)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ typert/generator | ported | TypingGenerator.js (incl. workspace mode) | B139/B141 |
| ✅ typert/loader | ported | TypingGenerator.js (loader) | B139 |
| ✅ typert/protocol | ported | TypingProtocol.js | B138 |
| ✅ typert/registry | ported | TypingGenerator.js (registry) | B139 |

## util (7)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ util/atomic-write | ported | AtomicWrite.js | B132 |
| ✅ util/brand | ported | Brand.js | B144 |
| ✅ util/home-paths | ported | HomePaths.js | B135 |
| ✅ util/launch-environment | ported | LaunchEnvironment.js | B135 |
| ✅ util/native-command | ported | NativeCommand.js | B144 |
| ✅ util/output-retention | ported | OutputRetention.js | B144 |
| ✅ util/timeout | ported | tool timeoutMs + tier defaults | B101 |

## web (6)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ web/tool-web | ported | research plugin (web_search/web_fetch) | B125 |
| ✅ web/web | ported | src/utils/web.js (WebRuntime) | B143 |
| ✅ web/web-fetch-http | ported | web_fetch tool + WebSearchProviders fetch registry | B125/B144 |
| ✅ web/web-search-deepseek | ported | WebSearchProviders.js (deepseek) | B144 |
| ✅ web/web-search-exa | ported | WebSearchProviders.js (exa) | B144 |
| ✅ web/web-search-perplexity | ported | WebSearchProviders.js (perplexity) | B144 |

## workflow (4)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ workflow/tool-ralph | ported | RalphRunner.js + ralph tool | B135 |
| ✅ workflow/tool-workflow | ported | WorkflowEngine.js | B115 |
| ✅ workflow/workflow | ported | WorkflowEngine.js | B115 |
| ✅ workflow/workflow-worker-thread | ported | BackgroundJobs.js worker | B106/B115 |

## workspace (1)

| Package | Status | JEXI port | Batch |
|---|---|---|---|
| ✅ workspace/workspace | ported | WorkspaceEntity.js | B136 |

## Status legend

- ✅ **ported** — the DSH contract is mirrored in JEXI (service, tool, or UI).
- 🟡 **partial** — the core surface is covered; deep internals remain.
- ⬜ **not-yet** — still on the map for the next "Pull all".
