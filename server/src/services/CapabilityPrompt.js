/**
 * JEXI OS — capability guidance for the system prompt.
 *
 * The prompt-side half of the capability fix. Tool guidance that describes what
 * a capability is useful for is only honest if it reflects the current session,
 * so this block is generated from the live registry and the evidence ledger
 * rather than written once into the system prompt.
 *
 * It answers three questions the model previously had to guess at:
 *   1. What can I do here, right now?          → the available list, with when-to-use
 *   2. What is NOT available, so I must not claim it? → the unavailable list, with why
 *   3. What has actually worked this session?   → the proven list (evidence)
 *
 * It deliberately does NOT enumerate the tools themselves — the tool schemas are
 * the interface for that, and duplicating them here would drift. It describes
 * capabilities, and the numbers come from the runtime.
 */
import { capabilitySummaryAsync, listCapabilityStatesAsync } from '../capability/registry/registry.js';
import { succeededCapabilities, failedCapabilities } from '../capability/registry/ledger.js';

/** Capability ids whose absence is common enough to warrant a plain-English note. */
const UNMET_HINT = {
  web_search: 'no web-search provider is reachable — say you cannot look this up online rather than guessing at current facts',
  web_fetch: 'no URL-fetch provider is reachable',
  browser: 'no browser backend is running',
  terminal: 'terminal execution is disabled by the active permission profile',
  filesystem_write: 'file writes are disabled by the active permission profile',
  filesystem_read: 'file reads are unavailable',
  testing: 'no test runner is available',
};

/**
 * Build the capability guidance block. Returns '' when there is nothing useful
 * to say, so a turn is never padded with boilerplate.
 *
 * @param {object} [opts]
 * @param {number} [opts.maxAvailable=24]
 */
export async function capabilityPromptBlock(opts = {}) {
  const maxAvailable = opts.maxAvailable ?? 24;
  let summary;
  try { summary = await capabilitySummaryAsync(); } catch { return ''; }
  if (!summary || !summary.capabilities?.length) return '';

  const available = summary.capabilities.filter((c) => c.available);
  const unavailable = summary.capabilities.filter((c) => !c.available);

  // Evidence: what actually succeeded / failed this session.
  let proven = new Set();
  let broken = new Set();
  try { proven = succeededCapabilities(); broken = failedCapabilities(); } catch { /* ledger optional */ }

  const lines = [];
  lines.push('CAPABILITIES IN THIS SESSION');
  lines.push('This is generated from the live capability registry — trust it over any assumption about what you can do.');
  lines.push('');

  if (available.length) {
    lines.push(`Available now (${available.length}):`);
    for (const c of available.slice(0, maxAvailable)) {
      const marks = [];
      if (proven.has(c.id)) marks.push('used successfully this session');
      if (broken.has(c.id) && !proven.has(c.id)) marks.push('attempted and failed this session');
      lines.push(`  - ${c.id}: ${c.whenToUse}${marks.length ? ` [${marks.join('; ')}]` : ''}`);
    }
    if (available.length > maxAvailable) lines.push(`  … and ${available.length - maxAvailable} more.`);
  } else {
    lines.push('No tools are available in this session.');
  }

  if (unavailable.length) {
    lines.push('');
    lines.push(`NOT available in this session (${unavailable.length}) — do not claim to have used these:`);
    for (const c of unavailable) {
      const hint = UNMET_HINT[c.id] ? ` (${UNMET_HINT[c.id]})` : ` (${c.reason})`;
      lines.push(`  - ${c.id}: ${c.title}${hint}`);
    }
  }

  lines.push('');
  lines.push(`Active permission profile: ${summary.profile}. A capability listed as NOT available is a hard limit for this session: report it as a limitation instead of attempting it or describing it as done.`);
  lines.push('If you are unsure whether you can do something, do not guess — the list above is the answer, and you may inspect it with the capability_check tool when it is offered.');

  return lines.join('\n');
}
