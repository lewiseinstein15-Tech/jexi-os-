/**
 * B133 — COMMAND REGISTRY (DeepSeek Harness `packages/interaction/commands`
 * mirror).
 *
 * A registry of slash commands the chat route recognizes BEFORE the model
 * sees the message: { name, description, match, run }. /help lists every
 * registered command. Commands are validated at registration (name +
 * description required) like DSH.
 */

const commands = new Map();

/** Register a command. Returns an unregister fn (reversible). */
export function registerCommand({ name, description, match, run }) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) throw new TypeError('command name must not be empty');
  if (!String(description || '').trim()) throw new TypeError(`command "${n}" description must not be empty`);
  if (commands.has(n)) throw new TypeError(`command "${n}" already registered`);
  const def = { name: n, description: String(description).trim(), match: typeof match === 'function' ? match : (q) => q.trim().toLowerCase().startsWith(`/${n}`), run: typeof run === 'function' ? run : async () => ({ ok: true, summary: `/${n} acknowledged.` }) };
  commands.set(n, def);
  return () => commands.delete(n);
}

/** List all commands (sorted). */
export function listCommands() {
  return [...commands.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Try to execute a message as a command. Returns null when no command matches. */
export async function tryExecuteCommand(raw, ctx = {}) {
  const text = String(raw || '').trim();
  if (!text.startsWith('/')) return null;
  const m = text.match(/^\/([a-z0-9_-]+)\b(.*)$/i);
  if (!m) return null;
  const name = m[1].toLowerCase();
  const def = commands.get(name);
  if (!def) return { ok: false, error: `unknown command /${name} — try /help`, matched: name };
  if (!def.match(text)) return { ok: false, error: `command /${name} does not apply to this input`, matched: name };
  try {
    return { ok: true, matched: name, result: await def.run(text, ctx) };
  } catch (e) {
    return { ok: false, matched: name, error: `/${name} failed: ${(e && e.message) || e}` };
  }
}

/** /help text (all commands). */
export function helpText() {
  const lines = listCommands().map((c) => `- **/${c.name}** — ${c.description}`);
  return `### 📖 JEXI commands\n\n${lines.join('\n')}\n`;
}
