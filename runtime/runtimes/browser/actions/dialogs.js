/**
 * JEXI OS — Phase 17 Scope B — DIALOG SHIM.
 *
 * WHY THIS EXISTS (probed against Obscura 0.2.2):
 *   Page.handleJavaScriptDialog → -32601 "Unknown Page method: handleJavaScriptDialog"
 *   Page.javascriptDialogOpening → never fires
 *   alert() / confirm() / prompt() → do not block the page and raise no event
 *
 * Obscura auto-suppresses dialogs. There is therefore NO native way to read
 * what a dialog said or to answer it — a dialog is gone before any client could
 * react. Playwright's `page.on('dialog')` cannot work here either, because the
 * underlying protocol event does not exist.
 *
 * The supported substitute is `Page.addScriptToEvaluateOnNewDocument`, which
 * works. It injects a shim into every new document BEFORE any page script runs,
 * replacing alert/confirm/prompt with recorder functions that:
 *   - append {type, message, default, returned, at} to a history array
 *   - return the caller's configured policy value
 *
 * ── HONESTY CONTRACT ───────────────────────────────────────────────────────
 * This is an EMULATION, not the native protocol. Consequences, stated plainly:
 *   - The policy is set BEFORE the dialog fires. A caller cannot inspect a
 *     dialog and then decide, because by then it has already returned.
 *   - The dialog does not block the page, so a "modal" flow proceeds without
 *     waiting. That is Obscura's real behaviour, not something the shim adds.
 *   - Actions that touch dialogs report `via: "injected-shim"` so no report can
 *     present this as native protocol support.
 * Set the policy first, then trigger the dialog, then read get_dialogs.
 */

/** The injectable source. Installed with Page.addScriptToEvaluateOnNewDocument. */
export const DIALOG_SHIM_SOURCE = `(() => {
  if (window.__jexiDialogShim) return;
  const shim = {
    version: '1.0.0',
    policy: { accept: true, prompt_text: null },
    history: [],
    pending: null,
    record(type, message, dflt, returned) {
      const entry = {
        type,
        message: message === undefined ? null : String(message),
        default: dflt === undefined ? null : String(dflt),
        returned: returned === undefined ? null : String(returned),
        at: Date.now(),
        seq: this.history.length,
      };
      this.history.push(entry);
      this.pending = entry;
      return entry;
    },
  };
  window.alert = function (message) {
    shim.record('alert', message, null, undefined);
  };
  window.confirm = function (message) {
    const r = !!shim.policy.accept;
    shim.record('confirm', message, null, r);
    return r;
  };
  window.prompt = function (message, dflt) {
    const r = shim.policy.accept
      ? (shim.policy.prompt_text === null ? (dflt === undefined ? null : String(dflt)) : String(shim.policy.prompt_text))
      : null;
    shim.record('prompt', message, dflt, r);
    return r;
  };
  window.__jexiDialogShim = shim;
})();`;

/**
 * Install the shim so it runs on every new document in the session.
 * Safe to call repeatedly — the shim is idempotent and CDP identifiers stack.
 *
 * @param {import('../cdp.js').CdpSession} session
 * @returns {Promise<{installed: boolean, identifier: string, note: string}>}
 */
export async function installDialogShim(session) {
  const r = await session.send('Page.addScriptToEvaluateOnNewDocument', { source: DIALOG_SHIM_SOURCE });
  // Also apply to the CURRENT document, which the new-document hook misses.
  const applied = await session.eval(`(() => {
    if (window.__jexiDialogShim) return 'already-present';
    ${DIALOG_SHIM_SOURCE}
    return window.__jexiDialogShim ? 'installed' : 'failed';
  })()`);
  return {
    installed: applied === 'installed' || applied === 'already-present',
    identifier: r.identifier ?? null,
    current_document: applied,
    note: 'emulation: Obscura auto-suppresses dialogs and implements neither Page.handleJavaScriptDialog nor Page.javascriptDialogOpening',
  };
}

export default { installDialogShim, DIALOG_SHIM_SOURCE };
