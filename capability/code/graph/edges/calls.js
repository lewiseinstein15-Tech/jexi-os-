// CALLS edge — function/method/class-constructor invocation.
export const TYPE = 'CALLS';

export function create(src, dst, props = {}) {
  return { type: TYPE, src, dst, props: { via: props.via || 'static' } };
}
