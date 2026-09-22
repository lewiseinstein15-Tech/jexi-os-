// computer/operators/index.js
// Phase 29 Scope B — operator registry.
//
// Contract spellings:
//   registry.list()            -> [operator]        (desktop, fake)
//   registry.get(name)         -> operator          (unknown -> E_UNKNOWN_OPERATOR)
//   registry.select(name?)     -> { active }        (default: 'desktop', NEVER fake)
//   registry.active()          -> { active }
//
// Declared: the DEFAULT select() target is the desktop operator. The fake
// operator is registered so tests can reach it explicitly via
// select('fake') / get('fake'), but it is never chosen by default — it is
// test-only (TARS discipline: dynamic operator selection happens in the
// runner based on settings; the browser/mobile operators arrive in
// Scopes C/J and extend this registry).

import { ComputerError } from '../errors.js';
import { assertOperator, OPERATOR_CAPABILITY_KEYS, OPERATOR_CODES } from './interface.js';
import { createDesktopOperator } from './desktop.js';
import { createFakeOperator } from './fake.js';

export const DEFAULT_OPERATOR = 'desktop';

const CREATORS = Object.freeze({
  desktop: createDesktopOperator,
  fake: createFakeOperator,
});

function buildRegistry() {
  const operators = new Map();
  for (const name of Object.keys(CREATORS)) {
    operators.set(name, CREATORS[name]());
  }
  let activeName = DEFAULT_OPERATOR;
  return {
    list() {
      return [...operators.values()];
    },
    get(name) {
      const op = operators.get(name);
      if (!op) {
        throw new ComputerError('E_UNKNOWN_OPERATOR', `unknown operator: ${name}`, {
          name,
          known: [...operators.keys()],
        });
      }
      return op;
    },
    select(name = DEFAULT_OPERATOR) {
      const op = operators.get(name);
      if (!op) {
        throw new ComputerError('E_UNKNOWN_OPERATOR', `unknown operator: ${name}`, {
          name,
          known: [...operators.keys()],
        });
      }
      activeName = name;
      return { active: op };
    },
    active() {
      return { active: operators.get(activeName) };
    },
    activeName() {
      return activeName;
    },
  };
}

export const registry = buildRegistry();

export { assertOperator, OPERATOR_CAPABILITY_KEYS, OPERATOR_CODES, createDesktopOperator, createFakeOperator };
