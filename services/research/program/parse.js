// research/program/parse.js
// Parse program.md (the human-edited strategy file, the program.md analog of
// karpathy/autoresearch, MIT): `## Strategy` free text + `## Constraints` list.
// Pure function — no fs, no state — so the loader and probes can reuse it.

export function parseProgram(markdown) {
  const md = String(markdown ?? '');
  const lines = md.split(/\r?\n/);

  let section = null;
  const strategyLines = [];
  const constraintLines = [];

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const title = heading[2].trim().toLowerCase();
      section = title === 'strategy' ? 'strategy' : title === 'constraints' ? 'constraints' : null;
      continue;
    }
    if (section === 'strategy') strategyLines.push(line);
    else if (section === 'constraints') constraintLines.push(line);
  }

  const strategy = strategyLines.join('\n').replace(/^\s*\n+/, '').replace(/\n\s*$/, '').trim();
  const constraints = constraintLines
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('>'))
    .map((l) => l.replace(/^[-*+]\s+/, '').trim())
    .filter((l) => l.length > 0);

  const ok = strategy.length > 0;
  return {
    strategy,
    constraints,
    ok,
    ...(ok ? {} : { error: 'no non-empty Strategy section found' }),
  };
}
