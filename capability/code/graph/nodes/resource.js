// Resource node — infrastructure or external dependency touched by code:
// k8s objects, compose services, Dockerfiles, external HTTP hosts.
export const LABEL = 'Resource';

export function create({ name, kind, identifier = null, file = null, line = 0 }) {
  return {
    label: LABEL,
    name,
    qualname: `resource:${kind}:${name}`,
    file,
    line,
    endLine: line,
    language: kind === 'http-host' ? 'http' : 'manifest',
    props: { kind, identifier },
  };
}
