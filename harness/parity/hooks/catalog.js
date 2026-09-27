/**
 * JEXI OS — Phase 30 Scope A — declared 30-event lifecycle catalog.
 *
 * Event names, trigger descriptions, matcher fields and reference timeouts
 * follow shanraisshan/claude-code-best-practice HOOKS-README (Official 30).
 * Runtime registration mapping is applied separately in registry.js.
 *
 * PHASE 5 P5-3 — WIRED vs INTENTIONAL NO-OP (in-file, per the wiring spec):
 * every event is either (a) WIRED — a real production emitter fires it in
 * the live lifecycle — or (b) an INTENTIONAL NO-OP stub: registered at boot
 * by src/wiring/phase31-hooks.js as a no-op handler so the contract holds,
 * with the concrete reason recorded in NO_OP_REASONS below. No event is
 * silently dead: wired ones fire, no-op ones are declared.
 */

// Events with REAL production emitters (call sites verified on main):
//   PreToolUse  → server/src/tools/execution/permission-gate.js
//   PostToolUse → server/src/tools/execution/executor.js
//   Stop        → server/src/services/MissionRunner.js
//   PreCompact  → server/src/services/CompactionEngine.js
//   SessionStart→ server/index.js boot
//   SessionEnd  → server/index.js SIGTERM/SIGINT
export const WIRED_HOOKS = ['PreToolUse', 'PostToolUse', 'Stop', 'PreCompact', 'SessionStart', 'SessionEnd'];

/** Why each remaining event is an intentional no-op stub (not an accident). */
export const NO_OP_REASONS = {
  PermissionRequest: 'no human-in-the-loop permission UI surface yet; PermissionRequest pairs with it',
  PostToolUseFailure: 'failure path surfaced through tool result + logs; no external hook consumer yet',
  UserPromptSubmit: 'prompt normalization happens inline in the chat handler; no external hook consumer yet',
  Notification: 'notification channel is the SSE stream itself; no external hook consumer yet',
  SubagentStart: 'SubagentRuntime dispatch is HTTP-only today (P5-7 wires chat dispatch); emitter lands with it',
  SubagentStop: 'SubagentRuntime dispatch is HTTP-only today (P5-7 wires chat dispatch); emitter lands with it',
  PostCompact: 'CompactionEngine has no post-compact consumer; pre-compact gate is the enforced one',
  Setup: 'project setup/maintenance initialization is not a runtime subsystem yet',
  TeammateIdle: 'agent teams are roster data + topology passthrough; no live teammate scheduler yet',
  TaskCreated: 'agent-team task objects are not dispatched at runtime yet',
  TaskCompleted: 'agent-team task objects are not dispatched at runtime yet',
  ConfigChange: 'config edits go through the Settings API with its own audit; no external hook consumer yet',
  WorktreeCreate: 'worktree isolation is not a runtime subsystem yet',
  WorktreeRemove: 'worktree isolation is not a runtime subsystem yet',
  InstructionsLoaded: 'instruction loading (AGENTS.md/rules) is synchronous inside PromptAssembly; no async hook consumer yet',
  Elicitation: 'no MCP elicitation flows are enabled in the registry yet',
  ElicitationResult: 'no MCP elicitation flows are enabled in the registry yet',
  StopFailure: 'API-failure turn endings surface via done payload + logs; no external hook consumer yet',
  CwdChanged: 'the server has one fixed workspace root; no cwd switching yet',
  FileChanged: 'fs.watchers exist for skills only (SkillDiscovery); no general file-watch hook consumer yet',
  PermissionDenied: 'denials are audited by RiskGuard/ToolRuntime directly; P30.F adds the neutral default seam',
  UserPromptExpansion: 'slash-command expansion is handled inline in the chat handler',
  PostToolBatch: 'parallel tool batches are not dispatched in the chat lanes yet',
  MessageDisplay: 'display is the SSE stream itself; no external hook consumer yet',
};

const hook = (event, lifecycle, when, matcher = null, timeout = 5000, declaredReturn = 'none') =>
  Object.freeze({
    event, lifecycle, when, matcher, timeout, async: false, declaredReturn,
    wired: WIRED_HOOKS.includes(event),
    intentionalNoOp: !WIRED_HOOKS.includes(event),
    noOpReason: WIRED_HOOKS.includes(event) ? null : (NO_OP_REASONS[event] || 'no production emitter yet — declared intentional no-op'),
  });

export const HOOK_CATALOG = Object.freeze([
  hook('PreToolUse', 'tool', 'Before a tool call executes.', 'tool_name', 5000, 'block'),
  hook('PermissionRequest', 'permission', 'When a tool call requests user permission.', 'tool_name', 5000, 'block'),
  hook('PostToolUse', 'tool', 'After a tool call completes successfully.', 'tool_name'),
  hook('PostToolUseFailure', 'tool', 'After a tool call fails.', 'tool_name'),
  hook('UserPromptSubmit', 'message', 'After the user submits a prompt and before processing begins.', null, 5000, 'rewrite'),
  hook('Notification', 'message', 'When a user-facing notification is sent.', 'notification_type'),
  hook('Stop', 'message', 'When the assistant finishes a response.', null, 5000, 'block'),
  hook('SubagentStart', 'subagent', 'When a subagent starts.', 'agent_type'),
  hook('SubagentStop', 'subagent', 'When a subagent completes.', 'agent_type', 5000, 'block'),
  hook('PreCompact', 'compaction', 'Before context compaction begins.', 'compact_trigger', 5000, 'block'),
  hook('PostCompact', 'compaction', 'After context compaction completes.', 'compact_trigger'),
  hook('SessionStart', 'session', 'When a session starts or resumes.', 'source'),
  hook('SessionEnd', 'session', 'When a session ends.', 'reason'),
  hook('Setup', 'session', 'When project setup or maintenance initialization runs.', null, 30000),
  hook('TeammateIdle', 'subagent', 'When an agent-team teammate becomes idle.', null, 5000, 'block'),
  hook('TaskCreated', 'subagent', 'When an agent-team task is created.', null, 5000, 'block'),
  hook('TaskCompleted', 'subagent', 'When an agent-team task completes.', null, 5000, 'block'),
  hook('ConfigChange', 'session', 'When session configuration changes.', 'config_source', 5000, 'block'),
  hook('WorktreeCreate', 'worktree', 'When an isolated worktree is created.', null, 5000, 'rewrite'),
  hook('WorktreeRemove', 'worktree', 'When an isolated worktree is removed.'),
  hook('InstructionsLoaded', 'session', 'When instruction or path-scoped rule files enter context.', 'load_reason'),
  hook('Elicitation', 'permission', 'When an MCP tool requests user input.', 'server_name', 5000, 'rewrite'),
  hook('ElicitationResult', 'permission', 'After MCP elicitation input and before returning it to the server.', 'server_name', 5000, 'rewrite'),
  hook('StopFailure', 'message', 'When a turn ends because of an API failure.', 'error'),
  hook('CwdChanged', 'session', 'When the session working directory changes.'),
  hook('FileChanged', 'session', 'When a watched file changes.', 'filename'),
  hook('PermissionDenied', 'permission', 'After automatic policy denies a tool call.', 'tool_name', 5000, 'retry'),
  hook('UserPromptExpansion', 'message', 'Before a slash command or MCP prompt expansion reaches the model.', 'command_name', 5000, 'block'),
  hook('PostToolBatch', 'tool', 'After a complete parallel tool batch resolves.', null, 5000, 'block'),
  hook('MessageDisplay', 'message', 'While an assistant message is displayed to the user.', null, 5000, 'rewrite'),
]);

export const HOOK_EVENT_COUNT = 30;
