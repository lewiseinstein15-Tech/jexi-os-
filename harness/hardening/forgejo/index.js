/**
 * JEXI OS — Phase 23 Scope B — forgejo-mcp: 103-tool taxonomy + dispatch.
 *
 *   import { taxonomy, dispatch, createTransport } from '../harness/hardening/forgejo/index.js';
 *
 * 5 categories (repo / issue / pr / org / admin), 103 tools total
 * (repo 33, issue 22, pr 20, org 16, admin 12 — computed, see
 * TAXONOMY_TOTAL). Every tool spec carries name, category, params[]
 * ({ name, required, type, description? }) and description. list() is
 * sorted by name asc — deterministic, byte for byte.
 *
 * transport.dispatch validates the tool and its required params LOCALLY,
 * then refuses E_NO_FORGE_CONNECTION in this sandbox — no live forge
 * exists, and nothing is faked. Tokens ride via keyRef (env var name or
 * keyring:<ref>), reusing the madtea credential discipline read-only.
 */

export {
  taxonomy,
  CATEGORIES,
  CATEGORY_COUNTS,
  TAXONOMY_TOTAL,
} from './taxonomy.js';

export {
  transport,
  dispatch,
  createTransport,
  missingParams,
  TRANSPORT_KINDS,
} from './transport.js';
