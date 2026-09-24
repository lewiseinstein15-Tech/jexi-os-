// CROSS_SERVICE edge — code in one service root (server/, cli/, harness/, ...)
// reaching into another. Derived when an edge spans service boundaries.
export const TYPE = 'CROSS_SERVICE';

export function create(src, dst, props = {}) {
  return { type: TYPE, src, dst, props: { from: props.from || null, to: props.to || null } };
}
