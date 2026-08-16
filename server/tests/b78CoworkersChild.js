/**
 * B78 fixture — filesystem-native coworker definitions, run as a FRESH process
 * so JEXI_AGENTS_DIR (when set) is read at import time.
 *
 * Usage:
 *   DATA_DIR=<tmp> node tests/b78CoworkersChild.js real
 *     → loads the COMMITTED jexi-agents/ files (no JEXI_AGENTS_DIR): all five
 *       coworkers + ORCHESTRATOR.md must parse with frontmatter.
 *   DATA_DIR=<tmp> JEXI_AGENTS_DIR=<tmp-agents> ISOLATION=1 node tests/b78CoworkersChild.js isolated
 *     → the parent wrote a temp agents dir with a marker in coding.md only;
 *       loading email.md must NOT see the marker (edit-one-file isolation).
 */
import { loadCoworker, loadOrchestrator, orchestratorPromptFragment, listCoworkers } from '../src/services/CoworkerFiles.js';

const mode = process.argv[2] || 'real';
const SLUGS = ['coder', 'memory', 'researcher', 'email', 'github'];
const out = { mode };

out.present = SLUGS.filter((s) => !!loadCoworker(s));
out.frontmatter = Object.fromEntries(
  SLUGS.map((s) => {
    const d = loadCoworker(s);
    return [s, d ? { name: d.meta.name, hasDescription: !!d.meta.description, models: Array.isArray(d.meta.models) ? d.meta.models : null, bodyLen: (d.body || '').length } : null];
  })
);
const orch = loadOrchestrator();
out.orchestrator = orch ? { hasMeta: !!orch.meta.name, bodyLen: (orch.body || '').length } : null;
out.fragmentLen = orchestratorPromptFragment().length;
out.list = listCoworkers().map((c) => c.slug);

if (mode === 'isolated' && process.env.ISOLATION === '1') {
  const coding = loadCoworker('coder');
  const email = loadCoworker('email');
  out.isolation = {
    codingHasMarker: !!(coding && coding.content.includes('ISOLATION-MARKER')),
    emailHasMarker: !!(email && email.content.includes('ISOLATION-MARKER')),
  };
}

console.log(JSON.stringify(out));
process.exit(0);
