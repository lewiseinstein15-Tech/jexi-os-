/** JEXI OS — Phase 30 Scope B — skill allowed-tools pattern scoping. */
import path from 'node:path';
import { SemanticaError } from '../../../services/semantica/_internal.js';

const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]*$/;

function describe(value) {
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? String(value) : encoded;
  } catch {
    return `[${typeof value}]`;
  }
}

function invalidPattern(pattern, reason) {
  throw new SemanticaError(
    'E_INVALID_PATTERN',
    `invalid allowed-tools pattern ${describe(pattern)}: ${reason}`,
  );
}

/** Parse ToolName, ToolName(prefix:*), ToolName(/path/**), or an exact arg. */
export function parse(pattern) {
  if (typeof pattern !== 'string') invalidPattern(pattern, 'pattern must be a string');
  if (pattern === '' || pattern !== pattern.trim()) {
    invalidPattern(pattern, 'pattern must be non-empty with no surrounding whitespace');
  }

  if (TOOL_NAME.test(pattern)) return Object.freeze({ tool: pattern });

  const open = pattern.indexOf('(');
  if (open <= 0 || !pattern.endsWith(')')) {
    invalidPattern(pattern, 'expected ToolName or ToolName(argument-pattern)');
  }
  const tool = pattern.slice(0, open);
  const argPattern = pattern.slice(open + 1, -1);
  if (!TOOL_NAME.test(tool)) invalidPattern(pattern, 'invalid tool name');
  if (!argPattern || argPattern !== argPattern.trim()) {
    invalidPattern(pattern, 'argument pattern must be non-empty with no surrounding whitespace');
  }
  if (/[()\r\n\0]/.test(argPattern)) invalidPattern(pattern, 'nested delimiters and control characters are not supported');

  const stars = [...argPattern].filter((char) => char === '*').length;
  if (stars) {
    const pathGlob = argPattern.startsWith('/') && argPattern.endsWith('/**');
    const prefixGlob = !argPattern.startsWith('/')
      && stars === 1 && argPattern.endsWith('*') && argPattern.length > 1;
    if (pathGlob) {
      const root = argPattern.slice(0, -3);
      if (stars !== 2 || !root || root === '/' || root.endsWith('/')
        || root.includes('*') || root.includes('//') || path.posix.normalize(root) !== root) {
        invalidPattern(pattern, 'path glob must be a normalized absolute non-root path ending in /**');
      }
    } else if (!prefixGlob) {
      invalidPattern(pattern, 'wildcard must be one trailing * prefix match or an absolute /** path glob');
    }
  }

  return Object.freeze({ tool, argPattern });
}

function callArgument(call) {
  if (!call || typeof call !== 'object' || Array.isArray(call)) return null;
  if (Object.hasOwn(call, 'arg')) return typeof call.arg === 'string' ? call.arg : null;
  if (typeof call.args === 'string') return call.args;
  if (!call.args || typeof call.args !== 'object' || Array.isArray(call.args)) return null;
  for (const key of ['command', 'path', 'file', 'skill', 'name', 'input']) {
    if (typeof call.args[key] === 'string') return call.args[key];
  }
  const values = Object.values(call.args).filter((value) => typeof value === 'string');
  return values.length === 1 ? values[0] : null;
}

function pathGlobMatches(argPattern, argument) {
  if (!argument.startsWith('/') || argument.includes('\0')) return false;
  const root = path.posix.normalize(argPattern.slice(0, -3));
  const candidate = path.posix.normalize(argument);
  return candidate === root || candidate.startsWith(`${root}/`);
}

function matchesAst(ast, call) {
  if (!call || typeof call !== 'object' || Array.isArray(call)) return false;
  if (typeof call.tool !== 'string' || call.tool !== ast.tool) return false;
  if (ast.argPattern === undefined) return true;
  const argument = callArgument(call);
  if (argument === null) return false;
  if (ast.argPattern.startsWith('/') && ast.argPattern.endsWith('/**')) {
    return pathGlobMatches(ast.argPattern, argument);
  }
  if (ast.argPattern.endsWith('*')) {
    return argument.startsWith(ast.argPattern.slice(0, -1));
  }
  return argument === ast.argPattern;
}

export function matches(pattern, call) {
  return matchesAst(parse(pattern), call);
}

/** Validate the entire allowlist first; one invalid entry fails closed. */
export function allowed(allowedTools, call) {
  const tool = typeof call?.tool === 'string' && call.tool ? call.tool : '(unknown tool)';
  if (allowedTools === undefined || allowedTools === null) {
    return { allowed: false, reason: `tool ${JSON.stringify(tool)} denied: allowedTools is not declared` };
  }
  if (!Array.isArray(allowedTools)) {
    invalidPattern(allowedTools, 'allowedTools must be an array of patterns');
  }

  const patterns = Array.from(allowedTools, (pattern) => ({ pattern, ast: parse(pattern) }));
  if (patterns.some(({ ast }) => matchesAst(ast, call))) return { allowed: true };
  const reason = patterns.length === 0
    ? `tool ${JSON.stringify(tool)} denied: allowedTools declares no tools`
    : `tool ${JSON.stringify(tool)} denied: no allowedTools pattern matched`;
  return { allowed: false, reason };
}
