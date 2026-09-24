/** JEXI OS — Phase 30 Scope A — hook lookup, Phase 7 mapping and validation. */
import fs from 'node:fs';
import { SemanticaError } from '../../../services/semantica/_internal.js';
import { HOOK_CATALOG, HOOK_EVENT_COUNT } from './catalog.js';
import { HOOK_RETURNS, makeContract, validateHookSpec } from './contract.js';

const PHASE7_REGISTRY_URL = new URL('../../../hooks/hooks.json', import.meta.url);

function readPhase7Registrations() {
  try {
    const parsed = JSON.parse(fs.readFileSync(PHASE7_REGISTRY_URL, 'utf8'));
    return {
      registrations: Array.isArray(parsed?.hooks) ? parsed.hooks : [],
      error: Array.isArray(parsed?.hooks) ? null : 'hooks/hooks.json has no hooks array',
    };
  } catch (error) {
    return { registrations: [], error: `hooks/hooks.json unreadable: ${error.code ?? error.name}` };
  }
}

function publicHandler(registration) {
  return Object.freeze({
    id: String(registration.id),
    matcher: registration.matcher ?? null,
    command: String(registration.command ?? ''),
    exitBehavior: registration.exitBehavior === 'block' ? 'block' : 'warn',
    timeout: Number.isInteger(registration.timeout) ? registration.timeout : 5000,
    async: false,
    enabled: registration.enabled !== false,
    return: registration.exitBehavior === 'block' ? 'block' : 'none',
  });
}

const PHASE7 = readPhase7Registrations();

function buildRegistry() {
  const handlersByEvent = new Map();
  for (const registration of PHASE7.registrations) {
    if (!registration || typeof registration.event !== 'string') continue;
    const handlers = handlersByEvent.get(registration.event) ?? [];
    handlers.push(publicHandler(registration));
    handlersByEvent.set(registration.event, handlers);
  }

  return HOOK_CATALOG.map((entry) => {
    const handlers = Object.freeze([...(handlersByEvent.get(entry.event) ?? [])]);
    const stub = handlers.length === 0;
    const returnType = stub
      ? 'none'
      : handlers.some((handler) => handler.return === 'block') ? 'block' : 'none';
    return Object.freeze({
      event: entry.event,
      lifecycle: entry.lifecycle,
      when: entry.when,
      matcher: entry.matcher,
      timeout: entry.timeout,
      async: entry.async,
      contract: makeContract(returnType),
      handlers,
      stub,
    });
  });
}

const REGISTRY = Object.freeze(buildRegistry());
const BY_EVENT = new Map(REGISTRY.map((spec) => [spec.event, spec]));
const clone = (value) => JSON.parse(JSON.stringify(value));

export function list() {
  return REGISTRY.map(clone);
}

export function get(event) {
  const spec = BY_EVENT.get(event);
  if (!spec) {
    throw new SemanticaError('E_UNKNOWN_HOOK_EVENT',
      `unknown hook event ${JSON.stringify(event)}; known events: ${REGISTRY.map((item) => item.event).join(', ')}`);
  }
  return clone(spec);
}

export function count() {
  return REGISTRY.length;
}

export function validate() {
  const errors = [];
  if (REGISTRY.length !== HOOK_EVENT_COUNT) {
    errors.push(`catalog must declare exactly ${HOOK_EVENT_COUNT} events; found ${REGISTRY.length}`);
  }
  if (PHASE7.error) errors.push(PHASE7.error);

  const eventCounts = new Map();
  const mappedHandlerIds = new Set();
  for (const [index, spec] of REGISTRY.entries()) {
    errors.push(...validateHookSpec(spec, index));
    eventCounts.set(spec.event, (eventCounts.get(spec.event) ?? 0) + 1);
    if (!HOOK_RETURNS.includes(HOOK_CATALOG[index]?.declaredReturn)) {
      errors.push(`${spec.event}: declared return must be one of ${HOOK_RETURNS.join(', ')}`);
    }
    for (const handler of spec.handlers) {
      if (mappedHandlerIds.has(handler.id)) errors.push(`${spec.event}: duplicate Phase 7 registration id ${handler.id}`);
      mappedHandlerIds.add(handler.id);
    }
  }
  for (const [event, occurrences] of eventCounts) {
    if (occurrences !== 1) errors.push(`${event}: event declared ${occurrences} times`);
  }

  const registeredIds = new Set();
  for (const [index, registration] of PHASE7.registrations.entries()) {
    const at = `Phase 7 registration[${index}]`;
    if (!registration || typeof registration !== 'object') {
      errors.push(`${at}: must be an object`);
      continue;
    }
    if (typeof registration.id !== 'string' || registration.id === '') errors.push(`${at}: id must be a non-empty string`);
    if (registeredIds.has(registration.id)) errors.push(`${at}: duplicate id ${registration.id}`);
    registeredIds.add(registration.id);
    if (!BY_EVENT.has(registration.event)) errors.push(`${at}: unknown catalog event ${String(registration.event)}`);
  }
  if (mappedHandlerIds.size !== PHASE7.registrations.length) {
    errors.push(`Phase 7 mapping incomplete: mapped ${mappedHandlerIds.size} of ${PHASE7.registrations.length} registrations`);
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

export function mapped() {
  return list().filter((spec) => !spec.stub);
}

export function stubs() {
  return list().filter((spec) => spec.stub);
}
