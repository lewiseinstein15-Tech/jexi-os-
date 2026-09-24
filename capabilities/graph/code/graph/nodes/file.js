// File node — one per indexed source file (qualname == repo-relative path).
export const LABEL = 'File';

export function create({ name, file, language = 'js', bytes = 0 }) {
  return {
    label: LABEL,
    name: file,
    qualname: file,
    file,
    line: 0,
    endLine: 0,
    language,
    props: { bytes },
  };
}
