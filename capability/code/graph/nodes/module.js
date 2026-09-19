// Module node — import specifier that does not resolve to an indexed file
// (npm packages, builtins, unresolved relatives).
export const LABEL = 'Module';

export function create({ specifier }) {
  return {
    label: LABEL,
    name: specifier,
    qualname: `module:${specifier}`,
    file: null,
    line: 0,
    endLine: 0,
    language: 'module',
    props: { kind: specifier.startsWith('.') ? 'relative' : 'package' },
  };
}
