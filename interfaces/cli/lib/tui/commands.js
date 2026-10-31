/**
 * JEXI TUI — slash commands.
 *
 * Pure parsing + a registry describing each command. The app owns execution;
 * this module only decides what was typed and what the command means, so the
 * whole command surface is testable without a terminal.
 *
 * Grammar:  /<name> [arg...]
 *   - the first whitespace-delimited token after '/' is the command name
 *   - everything after the first run of whitespace is the raw argument string
 *   - an unknown '/name' is reported as { unknown: true } (never thrown)
 */

/** Commands that only touch local state (never the backend). */
export const LOCAL_COMMANDS = new Set(['help', 'clear', 'new', 'exit', 'quit', 'cancel']);

/** Aliases → canonical name. */
const ALIASES = { quit: 'exit', '?': 'help', h: 'help', q: 'exit' };

/**
 * Every command the TUI understands.
 * `needs` names the backend endpoint(s) a command reads — documentation and a
 * hook for tests; `usage` is shown by /help.
 */
export const COMMANDS = {
  help: { usage: '/help', desc: 'list commands and keys' },
  clear: { usage: '/clear', desc: 'clear the transcript (keeps the session)' },
  new: { usage: '/new', desc: 'start a new session' },
  resume: { usage: '/resume [id]', desc: 'list recent sessions, or resume one by id', needs: ['sessions', 'conversation'] },
  model: { usage: '/model [provider/model]', desc: 'show the active model, or switch provider config', needs: ['providersActive', 'configureProvider'] },
  tools: { usage: '/tools [filter]', desc: 'list tools the engine exposes', needs: ['tools'] },
  skills: { usage: '/skills [filter]', desc: 'list skills available to the engine', needs: ['skills'] },
  memory: { usage: '/memory [query]', desc: 'show stored memory, or search it', needs: ['memory', 'memorySearch'] },
  status: { usage: '/status', desc: 'backend, model, session and permission status', needs: ['health', 'providersActive', 'permissions'] },
  permissions: { usage: '/permissions [preset]', desc: 'show or set the approval preset for this session', needs: ['permissions', 'setPermissions'] },
  approve: { usage: '/approve', desc: 'approve a paused protected action' },
  deny: { usage: '/deny', desc: 'decline a paused protected action' },
  cancel: { usage: '/cancel', desc: 'cancel the running turn (same as Ctrl+C)' },
  doctor: { usage: '/doctor', desc: 'backend health check', needs: ['health'] },
  exit: { usage: '/exit', desc: 'leave the TUI' },
};

/**
 * Parse a raw input line.
 * @returns {{isCommand:boolean, name?:string, arg?:string, unknown?:boolean}}
 */
export function parseCommand(line) {
  const s = String(line == null ? '' : line);
  if (!s.startsWith('/')) return { isCommand: false };
  const body = s.slice(1);
  const m = /^(\S+)\s*([\s\S]*)$/.exec(body);
  const rawName = (m ? m[1] : '').toLowerCase();
  const arg = (m ? m[2] : '').trim();
  if (!rawName) return { isCommand: true, name: '', arg, unknown: true };
  const name = ALIASES[rawName] || rawName;
  if (!Object.prototype.hasOwnProperty.call(COMMANDS, name)) {
    return { isCommand: true, name: rawName, arg, unknown: true };
  }
  return { isCommand: true, name, arg, unknown: false };
}

/** Is this a local (no-backend) command? */
export function isLocalCommand(name) {
  return LOCAL_COMMANDS.has(name);
}

/** Lines for /help. */
export function helpLines() {
  const out = ['commands:'];
  for (const [name, c] of Object.entries(COMMANDS)) {
    out.push(`  ${c.usage.padEnd(28)} ${c.desc}`);
  }
  out.push('');
  out.push('keys: Enter send · ↑↓ scroll · PgUp/PgDn page · Ctrl+L redraw · Ctrl+C cancel/quit');
  return out;
}

/** Rank command names by prefix for completion (reserved for TAB). */
export function completeCommand(prefix) {
  const p = String(prefix || '').replace(/^\//, '').toLowerCase();
  return Object.keys(COMMANDS).filter((n) => n.startsWith(p));
}

export default { parseCommand, isLocalCommand, helpLines, completeCommand, COMMANDS, LOCAL_COMMANDS };
