/** JEXI OS — Phase 30 Scope C — subagent dispatch enforcement. */
import { SemanticaError } from '../../../semantica/_internal.js';
import { scoping } from '../skills/index.js';
import { extendSpec, validate } from './contract.js';

const WRITE_TOOLS = new Set([
  'bash', 'edit', 'multiedit', 'notebookedit', 'todowrite', 'write',
  'code-write', 'fs_delete', 'fs_write', 'terminal.execute',
]);
const WRITE_HINT = /(create|delete|edit|execute|patch|remove|write)/;

function isWriteTool(tool) {
  const normalized = String(tool ?? '').toLowerCase();
  return WRITE_TOOLS.has(normalized) || WRITE_HINT.test(normalized);
}

function deny(code, message, details = {}) {
  const error = new SemanticaError(code, message);
  Object.assign(error, details);
  throw error;
}

function dispatchTurns(dispatch) {
  const value = dispatch?.turn ?? dispatch?.turns ?? dispatch?.turnCount ?? 0;
  if (!Number.isInteger(value) || value < 0) {
    deny('E_INVALID_SPEC', `dispatch turn count must be a non-negative integer; got ${String(value)}`);
  }
  return value;
}

/** Return allow on success; hard guardrail violations throw SemanticaError. */
export function enforce(spec, dispatch = {}) {
  const extended = extendSpec(spec);
  const checked = validate(extended);
  const agentId = String(extended.id ?? '(unknown subagent)');
  if (!checked.valid) {
    const fields = checked.errors.map((error) => error.field ?? 'spec').join(', ');
    deny('E_INVALID_SPEC', `subagent ${JSON.stringify(agentId)} has an invalid spec: ${fields}`, {
      agentId,
      errors: checked.errors,
    });
  }

  const turns = dispatchTurns(dispatch);
  if (turns > extended.maxTurns) {
    deny(
      'E_MAX_TURNS',
      `subagent ${JSON.stringify(agentId)} exceeded maxTurns ${extended.maxTurns}: received turn ${turns}`,
      { agentId, maxTurns: extended.maxTurns, turns },
    );
  }

  const tool = String(dispatch?.tool ?? '(unknown tool)');
  const scoped = scoping.allowed(extended.allowedTools, dispatch);
  if (!scoped.allowed) {
    deny(
      'E_TOOL_NOT_ALLOWED',
      `subagent ${JSON.stringify(agentId)} cannot dispatch tool ${JSON.stringify(tool)}: ${scoped.reason}`,
      { agentId, tool },
    );
  }

  if (extended.permissionMode === 'plan' && isWriteTool(tool)) {
    deny(
      'E_TOOL_NOT_ALLOWED',
      `subagent ${JSON.stringify(agentId)} cannot dispatch write tool ${JSON.stringify(tool)} in permissionMode "plan"`,
      { agentId, tool, permissionMode: extended.permissionMode },
    );
  }

  return { allowed: true };
}
