/**
 * JEXI OS — Phase 17 Scope H — DIAGRAM DESIGN / TYPE REGISTRY.
 * All {N} visual types (list mirrors upstream cathrynlavery/diagram-design v2.6).
 */
import t0 from './architecture.type.js';
import t1 from './bar.type.js';
import t2 from './database-schema.type.js';
import t3 from './data-flow.type.js';
import t4 from './deployment.type.js';
import t5 from './dependency-graph.type.js';
import t6 from './dp-integration.type.js';
import t7 from './dp-security-matrix.type.js';
import t8 from './er.type.js';
import t9 from './fishbone.type.js';
import t10 from './flowchart.type.js';
import t11 from './gantt.type.js';
import t12 from './high-level.type.js';
import t13 from './it-state.type.js';
import t14 from './kanban.type.js';
import t15 from './layers.type.js';
import t16 from './line.type.js';
import t17 from './loop.type.js';
import t18 from './medallion.type.js';
import t19 from './nested.type.js';
import t20 from './org-chart.type.js';
import t21 from './polar.type.js';
import t22 from './process.type.js';
import t23 from './pyramid.type.js';
import t24 from './quadrant.type.js';
import t25 from './radar.type.js';
import t26 from './sankey.type.js';
import t27 from './scatter.type.js';
import t28 from './sequence.type.js';
import t29 from './state-machine.type.js';
import t30 from './story-map.type.js';
import t31 from './swimlane.type.js';
import t32 from './timeline.type.js';
import t33 from './treemap.type.js';
import t34 from './tree.type.js';
import t35 from './uml-class.type.js';
import t36 from './user-journey.type.js';
import t37 from './venn.type.js';
import t38 from './wardley.type.js';
import t39 from './waterfall.type.js';

export const TYPES = [
  t0,
  t1,
  t2,
  t3,
  t4,
  t5,
  t6,
  t7,
  t8,
  t9,
  t10,
  t11,
  t12,
  t13,
  t14,
  t15,
  t16,
  t17,
  t18,
  t19,
  t20,
  t21,
  t22,
  t23,
  t24,
  t25,
  t26,
  t27,
  t28,
  t29,
  t30,
  t31,
  t32,
  t33,
  t34,
  t35,
  t36,
  t37,
  t38,
  t39,
];

const BY_NAME = new Map(TYPES.map((t) => [t.name, t]));

/** Look up a type by name; throws E_UNKNOWN_TYPE with the valid list. */
export function getType(name) {
  const t = BY_NAME.get(String(name));
  if (!t) {
    const e = new Error(`unknown diagram type "${name}" — valid: ${[...BY_NAME.keys()].sort().join(', ')}`);
    e.code = 'E_UNKNOWN_TYPE';
    throw e;
  }
  return t;
}

export default { TYPES, getType };
