/**
 * JEXI OS — Phase 14 Scope E — the reasoner (rule engine).
 *
 *   infer(graph, rules) -> { derived, provenance, graph }
 *
 * Rule format:
 *   { id, weight?, when: (graph) -> matches[], then: (match) -> facts[] }
 * A match MUST carry `sources: [nodeIds]` — the facts it derives
 * from. Each derived fact becomes a node in a fresh prov.strictGraph()
 * (Scope B compliant), with provenance naming the rule and the source
 * facts:
 *   agent    = agent:reasoner
 *   activity = activity:rule:<rule.id>
 *   source   = rule:<rule.id>(<src1>,<src2>,...)
 *
 * confidence is COMPUTED: (rule.weight ?? 1) / max(1, sources.length),
 * clamped to [0, 1] — a weighted rule spreads its confidence over the
 * facts it leans on. It is stored on the derived node's props and
 * never invented.
 */
import { fail } from '../_internal.js';
import { prov } from '../provenance/index.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function infer(graph, rules) {
  if (!Array.isArray(rules)) {
    throw fail('E_INVALID_RULES', 'infer needs an array of rules');
  }
  const sg = prov.strictGraph();
  const derived = [];
  const provenance = [];
  let seq = 0;
  for (const rule of rules) {
    if (!rule || typeof rule.id !== 'string' || typeof rule.when !== 'function' || typeof rule.then !== 'function') {
      throw fail('E_INVALID_RULES', 'a rule needs { id, when(graph), then(match) }');
    }
    const matches = rule.when(graph) || [];
    for (const match of matches) {
      const sources = Array.isArray(match.sources) ? [...match.sources].sort() : [];
      const facts = rule.then(match) || [];
      for (const fact of facts) {
        seq += 1;
        const id = `derived-${rule.id}-${String(seq).padStart(3, '0')}`;
        const confidence = clamp01((rule.weight ?? 1) / Math.max(1, sources.length));
        const node = sg.addNode({
          id,
          kind: fact.kind ?? 'entity',
          label: fact.label ?? id,
          props: { ...(fact.props ?? {}), rule: rule.id, sources, confidence },
        }, {
          agent: 'agent:reasoner',
          activity: `activity:rule:${rule.id}`,
          source: `rule:${rule.id}(${sources.join(',')})`,
          when: seq,
        });
        derived.push(node);
        provenance.push(prov.of(node));
      }
    }
  }
  return { derived, provenance, graph: sg };
}
