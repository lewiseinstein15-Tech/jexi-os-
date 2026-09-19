// INHERITS edge — class extends (resolved to the indexed superclass when present).
export const TYPE = 'INHERITS';

export function create(src, dst, props = {}) {
  return { type: TYPE, src, dst, props: { superclass: props.superclass || null } };
}
