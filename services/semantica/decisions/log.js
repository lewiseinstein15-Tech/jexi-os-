/**
 * JEXI OS — Phase 14 Scope C — the decision log (append-only).
 *
 *   log.record({ subject, chosen, alternatives, rationale, by, when? })
 *     -> { decisionId }            (decision-001, decision-002, ...)
 *   log.get(decisionId)            -> frozen decision | undefined
 *   log.list({ subject? })         -> decisions in append order
 *   log.graph()                    -> the backing provenanced graph
 *
 * Every recorded decision becomes a kind:'decision' node in a
 * prov.strictGraph() (Scope A + B enforced): nothing enters without
 * provenance. A later decision on the same subject gets a
 * 'supersedes' edge from the previous one, giving intelligence() a
 * real path to walk. Records are frozen; there is no update or
 * delete API — append-only by construction.
 */
import { fail } from '../_internal.js';
import { prov } from '../provenance/index.js';
import { intelligence } from './intelligence.js';
import { conflicts } from './conflict.js';

export class DecisionLog {
  constructor() {
    this.records = [];
    this.byId = new Map();
    this.lastBySubject = new Map();
    this.g = prov.strictGraph();
    this.seq = 0;
  }

  graph() { return this.g; }

  record({ subject, chosen, alternatives, rationale, by, when } = {}) {
    if (typeof subject !== 'string' || subject.trim() === '') {
      throw fail('E_MISSING_SUBJECT', 'a decision needs a subject');
    }
    if (typeof rationale !== 'string' || rationale.trim() === '') {
      throw fail('E_MISSING_RATIONALE', 'a decision needs a rationale (why this was chosen)');
    }
    if (!Array.isArray(alternatives) || alternatives.length === 0) {
      throw fail('E_MISSING_ALTERNATIVES', 'a decision needs a non-empty alternatives list');
    }
    if (typeof chosen !== 'string' || chosen.trim() === '') {
      throw fail('E_MISSING_CHOSEN', 'a decision needs the chosen option');
    }
    this.seq += 1;
    const decisionId = `decision-${String(this.seq).padStart(3, '0')}`;
    const rec = Object.freeze({
      decisionId,
      subject,
      chosen,
      alternatives: Object.freeze([...alternatives]),
      rationale,
      by: typeof by === 'string' && by.trim() !== '' ? by : 'unknown',
      when: when ?? this.seq,
      seq: this.seq,
    });

    const agentId = `agent:${rec.by}`;
    const provSpec = {
      agent: agentId,
      activity: 'activity:decision-record',
      source: `decisions.record(${subject})`,
      when: rec.when,
    };
    this.g.addNode({
      id: decisionId,
      kind: 'decision',
      label: `${subject}: ${chosen}`,
      props: { subject, chosen, rationale, by: rec.by },
    }, provSpec);

    const prev = this.lastBySubject.get(subject);
    if (prev) {
      this.g.addEdge({ from: prev, to: decisionId, kind: 'supersedes' }, {
        agent: agentId,
        activity: 'activity:decision-record',
        source: `decisions.supersedes(${subject})`,
        when: rec.when,
      });
    }
    this.lastBySubject.set(subject, decisionId);

    this.records.push(rec);
    this.byId.set(decisionId, rec);
    return { decisionId };
  }

  get(decisionId) { return this.byId.get(decisionId); }

  list({ subject } = {}) {
    if (subject === undefined) return [...this.records];
    return this.records.filter((d) => d.subject === subject);
  }

  intelligence(subject) { return intelligence(this, subject); }

  conflicts(crit = {}) { return conflicts(this, crit); }
}

export function create() { return new DecisionLog(); }
