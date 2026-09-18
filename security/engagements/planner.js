/**
 * JEXI OS — Phase 8 Scope D — PLANNER (Soundwave).
 *
 * Turns an operator's intent into a validated plan draft from which the
 * 8-document bundle is assembled BEFORE any execution. The planner never
 * touches the target and never runs the pipeline — it normalizes inputs,
 * fills defaults, and refuses incomplete or contradictory plans with
 * field-specific errors (EngagementValidationError).
 *
 * Decepticon mapping:
 *   scope + roe   ← targets/forbidden/networks + allowed/forbidden actions,
 *                   approval list, time windows, severity cap
 *   conops        ← phases + sequencing (defaults: the 5 pipeline phases)
 *   deconfliction ← blue-team contacts + coordination windows
 *   abort         ← triggers + escalation chain (sane defaults)
 *   data handling ← collected / storage / retention / classification
 *   contact       ← derived downstream (docs/contact.js)
 *   cleanup       ← removal steps (sane defaults)
 *   signatures    ← empty at plan time; signed via eng.addSignature()
 */

import { EngagementValidationError } from './store.js';
import { normalizeTarget } from './validator.js';
import { defaultStorage } from './docs/data-handling.js';
import { CLASSIFICATIONS, DOC_ID as DH_DOC } from './docs/data-handling.js';

function str(v, field, { required = false } = {}) {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) {
    if (required) throw new EngagementValidationError(field, `${field} is required (non-empty string)`);
    return null;
  }
  if (typeof v !== 'string') throw new EngagementValidationError(field, `${field} must be a string — got ${JSON.stringify(v)}`);
  return v.trim();
}

function strArray(v, field, { required = false } = {}) {
  if (v === undefined || v === null) {
    if (required) throw new EngagementValidationError(field, `${field} is required (non-empty array of strings)`);
    return [];
  }
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x.trim())) {
    throw new EngagementValidationError(field, `${field} must be an array of non-empty strings — got ${JSON.stringify(v)}`);
  }
  return [...new Set(v.map((x) => x.trim()))];
}

function windowArray(v, field) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new EngagementValidationError(field, `${field} must be an array of {start, end}`);
  return v.map((w) => {
    const start = w && w.start ? new Date(w.start) : null;
    const end = w && w.end ? new Date(w.end) : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new EngagementValidationError(field, `${field}: every window needs parseable start and end — got ${JSON.stringify(w)}`);
    }
    if (start.getTime() > end.getTime()) {
      throw new EngagementValidationError(field, `${field}: window start after end — got ${JSON.stringify(w)}`);
    }
    return { start: start.toISOString(), end: end.toISOString() };
  });
}

export function planDraft(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new EngagementValidationError('input', 'expected a plan input object');
  }

  const name = str(input.name, 'name', { required: true });

  const targets = strArray(input.targets, 'targets', { required: true }).map(normalizeTarget);
  if (!targets.length) throw new EngagementValidationError('targets', 'scope.targets is required (at least one hostname | ip | url)');

  const forbidden = strArray(input.forbidden, 'forbidden').map(normalizeTarget);
  const overlap = forbidden.filter((f) => targets.includes(f));
  if (overlap.length) {
    // not fatal — the validator refuses forbidden targets at execution time
    // (that is exactly probe P7's scenario) — but plan-time contradiction
    // is surfaced loudly here.
    console.error(`[planner] warning: targets also listed as forbidden: ${overlap.join(', ')} — the validator will refuse them`);
  }

  const networks = (input.networks === undefined || input.networks === null) ? [] : input.networks.map((n) => {
    if (!n || typeof n.cidr !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(n.cidr)) {
      throw new EngagementValidationError('networks', `networks: every entry needs an IPv4 cidr string a.b.c.d/p — got ${JSON.stringify(n)}`);
    }
    return { cidr: n.cidr, allowed: n.allowed === undefined ? true : Boolean(n.allowed) };
  });

  const allowedActions = strArray(input.allowedActions, 'allowedActions', { required: true }).map((a) => a.toLowerCase());
  const forbiddenActions = strArray(input.forbiddenActions, 'forbiddenActions').map((a) => a.toLowerCase());
  const doubleBooked = allowedActions.filter((a) => forbiddenActions.includes(a));
  if (doubleBooked.length) {
    throw new EngagementValidationError('allowedActions', `actions both allowed and forbidden: ${doubleBooked.join(', ')} — an action cannot be on both lists`);
  }
  if (!allowedActions.length) throw new EngagementValidationError('allowedActions', 'roe.allowedActions is required (at least one action)');

  const requiresApproval = strArray(input.requiresApproval, 'requiresApproval').map((a) => a.toLowerCase());
  const timeWindows = windowArray(input.timeWindows, 'roe.timeWindows');
  const coordinationWindows = windowArray(input.coordinationWindows, 'deconfliction.coordinationWindows');

  const maxSeverity = input.maxSeverity === undefined ? 'high' : input.maxSeverity;
  if (!['low', 'medium', 'high', 'critical'].includes(maxSeverity)) {
    throw new EngagementValidationError('maxSeverity', `maxSeverity must be one of low|medium|high|critical — got ${JSON.stringify(maxSeverity)}`);
  }

  const contacts = (input.contacts === undefined || input.contacts === null) ? [] : input.contacts.map((c) => {
    const cName = str(c && c.name, 'contacts[].name', { required: true });
    const cRole = str(c && c.role, 'contacts[].role', { required: true });
    return { name: cName, email: str(c && c.email, 'contacts[].email'), role: cRole };
  });

  const abortTriggers = input.abortTriggers === undefined || input.abortTriggers === null ? null : input.abortTriggers.map((t) => ({
    condition: str(t && t.condition, 'abortTriggers[].condition', { required: true }),
    action: str(t && t.action, 'abortTriggers[].action', { required: true }),
  }));
  const escalation = input.escalation === undefined || input.escalation === null ? null : input.escalation.map((e) => ({
    level: e && e.level,
    contact: str(e && e.contact, 'escalation[].contact', { required: true }),
  }));

  const dh = input.dataHandling || {};
  const classification = dh.classification === undefined ? 'confidential' : dh.classification;
  if (!CLASSIFICATIONS.includes(classification)) {
    throw new EngagementValidationError('classification', `${DH_DOC}: classification must be one of ${CLASSIFICATIONS.join('|')} — got ${JSON.stringify(classification)}`);
  }
  const retention = dh.retention === undefined ? 30 : dh.retention;
  if (!Number.isFinite(Number(retention)) || Number(retention) < 0) {
    throw new EngagementValidationError('retention', `dataHandling.retention must be a non-negative number of days — got ${JSON.stringify(retention)}`);
  }

  const dataHandling = {
    collected: strArray(dh.collected, 'dataHandling.collected').length
      ? strArray(dh.collected, 'dataHandling.collected')
      : ['findings', 'evidence excerpts', 'pipeline artifacts'],
    storage: dh.storage === undefined || dh.storage === null ? defaultStorage(name) : String(dh.storage),
    retention: Number(retention),
    classification,
  };

  const cleanupSteps = (input.cleanupSteps === undefined || input.cleanupSteps === null || !input.cleanupSteps.length)
    ? null
    : strArray(input.cleanupSteps, 'cleanupSteps', { required: true });

  const conops = input.conops === undefined || input.conops === null ? null : {
    phases: input.conops.phases === undefined ? undefined : input.conops.phases.map((p) => ({
      name: str(p && p.name, 'conops.phases[].name', { required: true }),
      order: p && p.order,
      actions: strArray(p && p.actions, 'conops.phases[].actions', { required: true }),
    })),
    sequencing: input.conops.sequencing === undefined ? 'sequential' : input.conops.sequencing,
  };

  return {
    name,
    targets,
    forbidden,
    networks,
    allowedActions,
    forbiddenActions,
    requiresApproval,
    timeWindows,
    maxSeverity,
    conops,
    contacts,
    coordinationWindows,
    abortTriggers,
    escalation,
    dataHandling,
    cleanupSteps,
    signatures: [],
  };
}

export default { planDraft };
