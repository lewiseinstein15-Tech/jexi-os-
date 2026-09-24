// Function node — named function, method, or arrow assigned to a binding.
export const LABEL = 'Function';

export function create({ name, file, line = 0, endLine = line, language = 'js', kind = 'function', params = null, owner = null }) {
  return {
    label: LABEL,
    name,
    // CBM-style qualified name: <file>::[Owner.]name
    qualname: `${file}::${owner ? `${owner}.` : ''}${name}`,
    file,
    line,
    endLine,
    language,
    props: { kind, owner, params },
  };
}
