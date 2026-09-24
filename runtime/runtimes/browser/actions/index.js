/**
 * JEXI OS — Phase 17 Scope B — ACTION CATALOGUE.
 *
 * Assembles every action group into one registry. Import this and get the full
 * browser action surface.
 *
 *   const registry = createActionRegistry({ grantedPermissions: [...] });
 *   registry.size()            // total actions
 *   registry.catalogue()       // JSON schemas for a model
 *   await registry.dispatch('click_element', { selector: '#go' }, ctx)
 *
 * ── ACTION GROUPS ──────────────────────────────────────────────────────────
 *   navigation.js   navigate, back/forward, refresh, wait, scroll, hover, mouse
 *   interaction.js  clicks (incl. double/right/ctrl/shift), typing, keys,
 *                   focus/blur, drag
 *   forms.js        select, checkbox, radio, date, upload, submit
 *   tabs.js         tabs, windows, iframes, dialogs
 *   extraction.js   text/html/attributes/value/links, screenshot, eval_js,
 *                   DOM mutation, viewport, UA override
 *   files.js        download, read/write/list files, save screenshot
 */

import { ActionRegistry } from './registry.js';
import { navigationActions } from './navigation.js';
import { interactionActions } from './interaction.js';
import { formActions } from './forms.js';
import { tabActions, dialogActions } from './tabs.js';
import { extractionActions, domMutationActions } from './extraction.js';
import { fileActions } from './files.js';
import { installDialogShim } from './dialogs.js';

export { ActionRegistry } from './registry.js';
export { ActionError, ActionValidationError, ActionPermissionError, ActionTimeoutError, ActionNotFoundError } from './registry.js';
export { DomService } from '../dom-service.js';
export { installDialogShim } from './dialogs.js';
export { performClick, KEY_SPECS, MODIFIERS, modifierMask } from './interaction.js';
export { resolveNode, describeTarget, TARGET_SCHEMA } from './resolve.js';

/**
 * Every action group, in registration order.
 * @returns {Array<object>} flat array of action specs
 */
export function allActionSpecs() {
  return [
    ...navigationActions(),
    ...interactionActions(),
    ...formActions(),
    ...tabActions(),
    ...dialogActions(),
    ...extractionActions(),
    ...domMutationActions(),
    ...fileActions(),
  ];
}

/**
 * Build a registry populated with every action.
 *
 * @param {object} [o]
 * @param {string[]} [o.grantedPermissions] defaults to the safe set:
 *        navigate, read, interact (NO eval, write, filesystem, network)
 * @param {boolean} [o.allowHighRisk]
 * @returns {ActionRegistry}
 */
export function createActionRegistry(o = {}) {
  const registry = new ActionRegistry(o);
  registry.registerAll(allActionSpecs());
  return registry;
}

/**
 * A count of actions by group — used by probes and reports so the total is
 * always derived from the registry rather than a hardcoded claim.
 */
export function actionInventory() {
  const groups = {
    navigation: navigationActions(),
    interaction: interactionActions(),
    forms: formActions(),
    tabs: tabActions(),
    dialogs: dialogActions(),
    extraction: extractionActions(),
    dom_mutation: domMutationActions(),
    files: fileActions(),
  };
  const byGroup = {};
  let total = 0;
  for (const [name, specs] of Object.entries(groups)) {
    byGroup[name] = specs.length;
    total += specs.length;
  }
  const all = Object.values(groups).flat();
  const byRisk = {};
  for (const s of all) {
    const r = s.risk || 'medium';
    byRisk[r] = (byRisk[r] || 0) + 1;
  }
  const dupes = all.map((s) => s.name).filter((n, i, arr) => arr.indexOf(n) !== i);
  return { total, by_group: byGroup, by_risk: byRisk, duplicate_names: dupes, names: all.map((s) => s.name) };
}

export default { createActionRegistry, allActionSpecs, actionInventory };
