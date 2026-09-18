/**
 * JEXI OS — Phase 8 Scope D — BUNDLE (assembles the 8-document OPPLAN).
 *
 * Soundwave writes an 8-document OPPLAN before any execution:
 *
 *   1. roe.js            Rules of Engagement (incl. scope)
 *   2. conops.js         Concept of Operations
 *   3. deconfliction.js  blue-team coordination
 *   4. abort.js          abort conditions
 *   5. data-handling.js  collection / storage / retention
 *   6. contact.js        who to call, when (derived card)
 *   7. cleanup.js        post-engagement removal
 *   8. signatures.js     authorization proof
 *
 * The machine bundle stores documents 1–5 and 7–8 as spec'd sections
 * ({id, name, createdAt, scope, roe, conops, deconfliction, abort,
 * dataHandling, cleanup, signatures}); document 6 is the derived comms
 * card rendered into the OPPLAN output (contact.js builds it from the
 * deconfliction + abort sections on demand).
 */

import { randomUUID } from 'node:crypto';
import { nowIso } from './store.js';
import * as roe from './docs/roe.js';
import * as conops from './docs/conops.js';
import * as deconfliction from './docs/deconfliction.js';
import * as abort from './docs/abort.js';
import * as dataHandling from './docs/data-handling.js';
import * as contact from './docs/contact.js';
import * as cleanup from './docs/cleanup.js';
import * as signatures from './docs/signatures.js';

/** Assemble the full engagement bundle from a plan draft. */
export function assembleBundle(draft) {
  const engagement = {
    id: `eng-${randomUUID()}`,
    name: draft.name,
    createdAt: nowIso(),
    ...roe.build(draft),
    ...conops.build(draft),
    ...deconfliction.build(draft),
    ...abort.build(draft),
    ...dataHandling.build(draft),
    ...cleanup.build(draft),
    ...signatures.build(draft),
  };
  if (!engagement.name || typeof engagement.name !== 'string') {
    throw new Error('bundle: assembled engagement has no name');
  }
  return engagement;
}

/** The 8 OPPLAN documents, in order, each extracted from the bundle. */
export const OPPLAN_DOCS = [
  { no: 1, id: roe.DOC_ID, title: roe.DOC_TITLE, sections: (e) => ({ scope: e.scope, roe: e.roe }) },
  { no: 2, id: conops.DOC_ID, title: conops.DOC_TITLE, sections: (e) => e.conops },
  { no: 3, id: deconfliction.DOC_ID, title: deconfliction.DOC_TITLE, sections: (e) => e.deconfliction },
  { no: 4, id: abort.DOC_ID, title: abort.DOC_TITLE, sections: (e) => e.abort },
  { no: 5, id: dataHandling.DOC_ID, title: dataHandling.DOC_TITLE, sections: (e) => e.dataHandling },
  { no: 6, id: contact.DOC_ID, title: contact.DOC_TITLE, sections: (e) => contact.build(e).contact },
  { no: 7, id: cleanup.DOC_ID, title: cleanup.DOC_TITLE, sections: (e) => e.cleanup },
  { no: 8, id: signatures.DOC_ID, title: signatures.DOC_TITLE, sections: (e) => e.signatures },
];

/** Render the 8-document OPPLAN as text (the pre-execution authorization pack). */
export function renderOpplan(engagement) {
  const head = [
    `# OPPLAN — ${engagement.name}`,
    `engagement: ${engagement.id}`,
    `created: ${engagement.createdAt}`,
    `content hash: sha256:${signatures.bundleHash(engagement)}`,
    '',
  ];
  const body = OPPLAN_DOCS.map((d) => [
    `## Document ${d.no}/8 — ${d.title} [${d.id}]`,
    '',
    JSON.stringify(d.sections(engagement), null, 2),
    '',
  ].join('\n'));
  return [...head, ...body].join('\n');
}
