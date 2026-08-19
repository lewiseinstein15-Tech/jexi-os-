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

/* ------------------------------------------------------------------ */
/* B139 — DSH command dialect (interaction/commands full dialect)      */
/* ------------------------------------------------------------------ */

/** Command-name contract (dsh): lowercase start, [a-z0-9_-] body. */
export const COMMAND_NAME_RE = /^[a-z][a-z0-9_-]*$/;

/**
 * Parse an exact slash command WITHOUT normalizing its trailing input
 * (dsh parseCommand): `/<name>` + raw remainder, or undefined.
 */
export function parseCommand(line) {
  const match = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u.exec(String(line || ''));
  if (match === null) return undefined;
  const name = match[1];
  if (name === undefined) return undefined;
  return Object.freeze({ name, rawInput: String(line).slice(match[0].length) });
}

/** Convert arbitrary abort reasons to one stable rejected Error. */
export function commandAbortError(signal) {
  if (signal && signal.reason instanceof Error) return signal.reason;
  const reason = signal && typeof signal.reason === 'string' ? signal.reason : 'command aborted';
  return new Error(reason);
}

/** Render arbitrary thrown values without trusting string coercion. */
export function renderThrown(value) {
  try { return String(value); } catch { return '<unrenderable thrown value>'; }
}

/** Stop awaiting an uncooperative handler once its signal aborts (dsh withAbort). */
export function withCommandAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(commandAbortError(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => { signal.removeEventListener('abort', onAbort); reject(commandAbortError(signal)); };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(`command handler rejected with a non-Error value: ${renderThrown(error)}`));
      },
    );
  });
}

/**
 * Execute a message through the DSH dialect: parseCommand (strict name
 * contract, raw input preserved), recordInput honored, abort-aware run.
 * Returns { ok, matched, name, args?, result? } or null when not a command.
 */
export async function tryExecuteCommandDialect(raw, { signal = null, ctx = {} } = {}) {
  const parsed = parseCommand(raw);
  if (!parsed) return null;
  const def = commands.get(parsed.name);
  if (!def) return { ok: false, matched: parsed.name, error: `unknown command /${parsed.name} — try /help` };
  const recordInput = def.recordInput !== false;
  const invocation = { name: parsed.name, rawInput: parsed.rawInput, ctx, signal };
  try {
    const output = await withCommandAbort(Promise.resolve(def.run(invocation)), signal);
    const result = output === undefined ? { ok: true, summary: `/${parsed.name} acknowledged.` } : output;
    return { ok: true, matched: parsed.name, ...(recordInput ? { args: parsed.rawInput } : {}), result };
  } catch (e) {
    return { ok: false, matched: parsed.name, error: `/${parsed.name} failed: ${(e && e.message) || e}` };
  }
}

/** Reject invalid command metadata before it reaches a UI protocol. */
export function validateCommandDefinition(def) {
  if (!def || typeof def.name !== 'string' || !COMMAND_NAME_RE.test(def.name)) {
    throw new TypeError(`command name must match ${COMMAND_NAME_RE}`);
  }
  if (!String(def.description || '').trim()) throw new TypeError(`command "${def && def.name}" description must not be empty`);
  return true;
}
