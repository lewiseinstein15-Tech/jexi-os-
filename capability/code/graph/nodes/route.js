// Route node — HTTP endpoint declared in source (app.get('/x'), router.post(...)).
export const LABEL = 'Route';

export function create({ method, path, file, line = 0, language = 'js' }) {
  const m = String(method).toUpperCase();
  return {
    label: LABEL,
    name: `${m} ${path}`,
    qualname: `route:${m} ${path}`,
    file,
    line,
    endLine: line,
    language,
    props: { method: m, path },
  };
}
