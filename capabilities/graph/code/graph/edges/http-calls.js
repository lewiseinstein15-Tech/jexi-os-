// HTTP_CALLS edge — fetch/axios call to an external host resource or an
// internal route node. CBM contract: runtime traces may VALIDATE these edges,
// never fabricate them.
export const TYPE = 'HTTP_CALLS';

export function create(src, dst, props = {}) {
  return { type: TYPE, src, dst, props: { target: props.target || null } };
}
