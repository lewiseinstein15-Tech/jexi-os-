// Class node — ES class declaration (superclass resolved into INHERITS edges).
export const LABEL = 'Class';

export function create({ name, file, line = 0, endLine = line, language = 'js', superclass = null }) {
  return {
    label: LABEL,
    name,
    qualname: `${file}::${name}`,
    file,
    line,
    endLine,
    language,
    props: { superclass },
  };
}
