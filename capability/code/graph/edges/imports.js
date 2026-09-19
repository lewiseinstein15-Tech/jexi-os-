// IMPORTS edge — file/module import or require (ESM `import .. from`, CJS `require`).
export const TYPE = 'IMPORTS';

export function create(src, dst, props = {}) {
  return { type: TYPE, src, dst, props: { specifier: props.specifier || null } };
}
