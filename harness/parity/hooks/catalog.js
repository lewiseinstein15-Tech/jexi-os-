/**
 * JEXI OS — Phase 30 Scope A — declared 30-event lifecycle catalog.
 *
 * Event names, trigger descriptions, matcher fields and reference timeouts
 * follow shanraisshan/claude-code-best-practice HOOKS-README (Official 30).
 * Runtime registration mapping is applied separately in registry.js.
 */

const hook = (event, lifecycle, when, matcher = null, timeout = 5000, declaredReturn = 'none') =>
  Object.freeze({ event, lifecycle, when, matcher, timeout, async: false, declaredReturn });

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
