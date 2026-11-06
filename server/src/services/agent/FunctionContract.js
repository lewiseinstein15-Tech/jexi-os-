/**
 * JEXI OS — AGENT — Function contract extraction (M23, Workstream A).
 *
 * M22 measured the residual coding failures and found the binding constraint
 * was the model, not the harness: the model wrote files that did not define the
 * required function, or defined it with the wrong signature, or implemented the
 * wrong algorithm. Every one of those is a failure to honour a CONTRACT the
 * request already stated — a function name, an ordered parameter list, a
 * return requirement, and (in HumanEval, and in most real requests that ship
 * examples) worked input/output pairs.
 *
 * This module turns that contract from prose the model has to re-derive into a
 * structured object the loop can (a) state back to the model before it writes,
 * and (b) check the written file against afterwards. It is PURE and
 * deterministic: no model, no network, no spawn. That is deliberate — a
 * contract extractor that itself calls a model cannot be a reliable gate.
 *
 * It generalises in two directions:
 *   - a request that CARRIES PYTHON (a HumanEval prompt, a pasted stub, a
 *     fenced block) is parsed as source: exact name, ordered parameters with
 *     defaults, return annotation, docstring, doctests, imports;
 *   - a PROSE request ("write a function `slugify(text: str) -> str` that …")
 *     is parsed for the signature it names, and degrades honestly to whatever
 *     it can support rather than inventing a contract.
 *
 * Nothing here hardcodes a benchmark task. The extractor sees text; it never
 * sees a task id.
 */

/* ------------------------------------------------------------------ code ---*/

/**
 * The Python source a request carries, or null.
 *
 * Preference order: a language-tagged python fence; any fenced block that
 * parses as Python; the whole text when it already looks like a definition.
 * A fenced block is preferred because a request may wrap the stub in prose and
 * we must not parse the prose as code.
 */
export function extractCodeBlock(text) {
  const s = String(text ?? '');
  const fences = [...s.matchAll(/```([a-zA-Z0-9_+-]*)\s*\n([\s\S]*?)```/g)];
  if (fences.length) {
    const py = fences.find((f) => /^(py|python3?|python)$/i.test(f[1] || ''));
    if (py) return py[2];
    const defish = fences.find((f) => /\b(def|class)\s+[A-Za-z_]\w*\s*[(:]/.test(f[2]));
    if (defish) return defish[2];
    return fences[0][2];
  }
  if (/\b(def|class)\s+[A-Za-z_]\w*\s*[(:]/.test(s)) return s;
  return null;
}

/** Split a parameter list on TOP-LEVEL commas (brackets/parens/quotes aware). */
function splitParams(list) {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (quote) {
      cur += ch;
      if (ch === quote && list[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** One parameter string → {name, annotation, default, kind}. */
function parseParam(raw) {
  let p = String(raw).trim();
  if (!p) return null;
  let kind = 'positional';
  if (/^\*\*/.test(p)) { kind = 'kwargs'; p = p.replace(/^\*\*/, ''); }
  else if (/^\*/.test(p)) { kind = 'varargs'; p = p.replace(/^\*/, ''); }
  if (/^[/]$/.test(p) || /^\*$/.test(p)) return { kind: p === '*' ? 'kwonly-marker' : 'positional-only-marker', name: p };
  let def = null;
  const eq = p.indexOf('=');
  if (eq >= 0) { def = p.slice(eq + 1).trim(); p = p.slice(0, eq).trim(); }
  let annotation = null;
  const colon = p.indexOf(':');
  if (colon >= 0) { annotation = p.slice(colon + 1).trim(); p = p.slice(0, colon).trim(); }
  return { kind, name: p, annotation, default: def };
}

/**
 * Parse the FIRST top-level `def`/`class` signature in a source string.
 *
 * Handles a multi-line signature (the parenthesised parameter list may wrap)
 * and annotations that contain commas and brackets (`List[Tuple[int, str]]`).
 * Returns null when there is no definition.
 */
export function parseSignature(source) {
  const s = String(source ?? '');
  const lines = s.split(/\r?\n/);
  const startRe = /^(\s*)(async\s+)?(def|class)\s+([A-Za-z_]\w*)\s*([(:])/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(startRe);
    if (!m) continue;
    const kind = m[3] === 'class' ? 'class' : 'function';
    const name = m[4];
    const startLine = i + 1;
    /* Collect the whole header: from this line through the line that closes the
       parameter list at bracket depth 0 (a signature may wrap across lines). */
    let depth = 0;
    let j = i;
    for (; j < lines.length; j++) {
      const seg = lines[j];
      for (const ch of seg) {
        if ('([{'.includes(ch)) depth++;
        else if (')]}'.includes(ch)) depth--;
      }
      if (depth <= 0 && /:\s*(#.*)?$/.test(seg)) break;
    }
    const headerText = lines.slice(i, j + 1).join('\n');
    const hm = headerText.match(/^\s*(?:async\s+)?(?:def|class)\s+[A-Za-z_]\w*\s*\(([\s\S]*)\)\s*(?:->\s*([^:]+?))?\s*:\s*(?:#.*)?$/);
    let params = [];
    let returns = null;
    if (hm) {
      params = splitParams(hm[1]).map(parseParam).filter(Boolean);
      returns = hm[2] ? hm[2].trim() : null;
    }
    return { kind, name, params, returns, line: startLine, header: headerText, bodyStartLine: j + 2 };
  }
  return null;
}

/**
 * Every top-level `def`/`class` signature, in order.
 *
 * A HumanEval prompt (and many real requests) ships a COMPLETE helper above the
 * function that is actually being asked for — `HumanEval/10` defines
 * `is_palindrome` with a working body, then `make_palindrome` with only a
 * docstring. Picking the first definition would extract the wrong contract, so
 * the caller needs them all and a rule to choose.
 */
export function parseAllSignatures(source) {
  const lines = String(source ?? '').split(/\r?\n/);
  const startRe = /^(\s*)(async\s+)?(def|class)\s+([A-Za-z_]\w*)\s*([(:])/;
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!startRe.test(lines[i])) { i++; continue; }
    const sig = parseSignature(lines.slice(i).join('\n'));
    if (!sig) { i++; continue; }
    const headerLines = sig.header.split('\n').length;
    /* Body = the indented lines after the header, up to the next column-0 line. */
    const body = [];
    let k = i + headerLines;
    for (; k < lines.length; k++) {
      if (lines[k].trim() === '') { body.push(lines[k]); continue; }
      if (/^\s/.test(lines[k])) { body.push(lines[k]); continue; }
      break;
    }
    out.push({ ...sig, body: body.join('\n') });
    i += headerLines;
  }
  return out;
}

/** Does a body contain a real statement (not just a docstring / pass / ...)? */
export function bodyIsComplete(body) {
  const meaningful = String(body ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  /* Drop a leading docstring (single- or multi-line). */
  let i = 0;
  if (meaningful[i] && /^("""|''')/.test(meaningful[i])) {
    const open = meaningful[i].startsWith('"""') ? '"""' : "'''";
    if (meaningful[i].length > 3 && meaningful[i].endsWith(open)) i = 1;
    else { i = 1; while (i < meaningful.length && !meaningful[i].includes(open)) i++; i++; }
  }
  const rest = meaningful.slice(i);
  return rest.some((l) => !/^(?:pass|\.\.\.|raise\s+NotImplementedError\b.*)$/.test(l));
}

/**
 * Choose the definition a request is asking to COMPLETE.
 *
 * Rule, in order:
 *   1. an explicit hint (`entryPoint`) that matches a definition wins;
 *   2. a definition whose body is incomplete (docstring/placeholder only) is
 *      the one to fill in — this is what `HumanEval/10` needs;
 *   3. otherwise the LAST definition (a request that names a new function
 *      usually appends it).
 * Returns null when the source has no definition.
 */
export function selectTargetSignature(source, entryPoint = null) {
  const all = parseAllSignatures(source);
  if (!all.length) return null;
  if (entryPoint) {
    const hit = all.find((s) => s.name === entryPoint);
    if (hit) return hit;
  }
  const incomplete = all.filter((s) => !bodyIsComplete(s.body));
  if (incomplete.length) return incomplete[incomplete.length - 1];
  return all[all.length - 1];
}

/** The docstring body of the first definition, or null. */
export function extractDocstring(source) {
  const s = String(source ?? '');
  const m = s.match(/(?:^|\n)\s*(?:def|class)\s+[A-Za-z_]\w*[\s\S]*?:\s*\n\s*(?:"""|''')([\s\S]*?)(?:"""|''')/);
  if (m) return m[1].trim();
  const one = s.match(/:\s*(?:"""|''')([\s\S]*?)(?:"""|''')/);
  return one ? one[1].trim() : null;
}

/** The docstring that belongs to a SPECIFIC definition. */
export function extractDocstringFor(source, name) {
  const all = parseAllSignatures(source);
  const hit = all.find((s) => s.name === name);
  if (hit) {
    const m = String(hit.body ?? '').match(/^\s*(?:"""|''')([\s\S]*?)(?:"""|''')/);
    if (m) return m[1].trim();
  }
  return extractDocstring(source);
}

/**
 * The docstring's PROSE, with the doctest lines and their expected output
 * removed. The behaviour line should describe intent; the examples are carried
 * separately so they can be rendered as their own, checkable list.
 */
export function docstringProse(source) {
  const raw = extractDocstring(source);
  return proseFromDocstring(raw);
}

/** The prose of a SPECIFIC definition's docstring (doctests stripped). */
export function docstringProseFor(source, name) {
  return proseFromDocstring(extractDocstringFor(source, name));
}

function proseFromDocstring(raw) {
  if (!raw) return null;
  const kept = [];
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s*>>>/.test(line)) break;
    if (/^\s*(?:"""|''')/.test(line)) continue;
    kept.push(line);
  }
  const prose = kept.join(' ').replace(/\s+/g, ' ').trim();
  return prose || null;
}

/**
 * Doctest pairs: `>>> call` followed by the expected output lines.
 * These are the worked examples the request already carries, and the single
 * most useful thing to hand a model that has to get the ALGORITHM right.
 */
export function extractDoctests(source) {
  const s = String(source ?? '');
  const lines = s.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*>>>\s*(.+?)\s*$/);
    if (!m) continue;
    const expr = m[1];
    const expected = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (/^\s*>>>/.test(line)) break;
      if (line.trim() === '') break;
      if (/^\s*("""|''')/.test(line)) break;
      expected.push(line.replace(/^\s{0,4}/, ''));
    }
    out.push({ expr, expected: expected.join('\n').trim() });
  }
  return out;
}

/** Top-level `import`/`from ... import ...` lines, de-duplicated. */
export function extractImports(source) {
  const s = String(source ?? '');
  const out = [];
  for (const line of s.split(/\r?\n/)) {
    if (/^(?:import|from)\s+\S/.test(line)) out.push(line.trim());
  }
  return [...new Set(out)];
}

/* ----------------------------------------------------------------- prose ---*/

/**
 * A signature named in prose, e.g.
 *   "write a function `slugify(text: str, max_len: int = 40) -> str` that …"
 *   "define def slugify(text: str) -> str:"
 * Returns a signature object shaped like `parseSignature`, or null.
 */
export function parseProseSignature(text) {
  const s = String(text ?? '');
  /* Form 1 — a keyword names the definition, optionally with "named":
       "def slugify(...)", "function named slugify(...)", "method parse(...)" */
  const bare = s.match(/\b(def|function|method|class)\s+(?:named\s+|called\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*([A-Za-z_][\w[\], .|]*?)(?=[,.;]|\s+(?:that|which|and|returning|to|the|in|for|so|then)\b|$))?/i);
  if (bare) {
    return {
      kind: /class/i.test(bare[1]) ? 'class' : 'function',
      name: bare[2],
      params: splitParams(bare[3]).map(parseParam).filter(Boolean),
      returns: bare[4] ? bare[4].trim() : null,
      line: null,
      header: bare[0],
    };
  }
  /* Form 2 — a backticked signature with no keyword:
       "write a function `slugify(text: str, max_len: int = 40) -> str`" */
  const fenced = s.match(/`([^`]*\b[A-Za-z_]\w*\s*\([^`]*\)[^`]*)`/);
  if (fenced) {
    const inner = fenced[1].trim();
    const sig = parseSignature(/\b(?:def|class)\s/.test(inner) ? inner : `def ${inner}:`);
    if (sig) return sig;
  }
  return null;
}

/* -------------------------------------------------------------- contract ---*/

/**
 * Extract a structured contract from a coding request.
 *
 * @param {string} text      the request (query, prompt, or pasted stub)
 * @param {object} [opts]
 * @param {string|null} [opts.filePath]  the file the request names, if any
 * @param {string|null} [opts.language]  'python' when known
 * @returns {{
 *   source: 'python'|'prose'|'none',
 *   language: string|null,
 *   filePath: string|null,
 *   name: string|null,
 *   kind: string|null,
 *   params: object[],
 *   returns: string|null,
 *   behavior: string|null,
 *   doctests: object[],
 *   imports: string[],
 *   signature: string|null,
 *   confidence: 'high'|'medium'|'low',
 *   missing: string[],
 * }}
 */
export function extractFunctionContract(text, { filePath = null, language = null, entryPoint = null } = {}) {
  const t = String(text ?? '');
  const code = extractCodeBlock(t);
  /* M23 — choose the definition being ASKED FOR, not blindly the first: a
     request may ship a complete helper above the stub to be filled in. */
  const sig = code ? selectTargetSignature(code, entryPoint) : null;
  const proseSig = sig ? null : parseProseSignature(t);
  const chosen = sig || proseSig;

  const doctests = code ? extractDoctests(code) : extractDoctests(t);
  const docstring = code && chosen?.name ? docstringProseFor(code, chosen.name) : null;
  const imports = code ? extractImports(code) : [];
  const lang = language || (code ? 'python' : null);
  const source = sig ? 'python' : (proseSig ? 'prose' : 'none');

  const missing = [];
  if (!chosen) missing.push('name');
  if (chosen && !chosen.params.length) missing.push('params');
  if (!doctests.length) missing.push('examples');
  if (!chosen?.returns) missing.push('return-annotation');

  const confidence = sig && chosen?.params.length ? 'high'
    : proseSig ? 'medium'
      : 'low';

  return {
    source,
    language: lang,
    filePath: filePath || extractFilePath(t),
    name: chosen?.name ?? null,
    kind: chosen?.kind ?? null,
    params: chosen?.params ?? [],
    returns: chosen?.returns ?? null,
    behavior: docstring || firstSentence(t),
    doctests,
    imports,
    signature: chosen?.header ? normalizeSignature(chosen) : null,
    confidence,
    missing,
  };
}

/** The file path a request names, if it names one. */
export function extractFilePath(text) {
  const s = String(text ?? '');
  const m = s.match(/(?:to the file|write to|file|path)\s+`?([~\w./-]+\.(?:py|js|ts|tsx|jsx|mjs|cjs|rb|go|rs|java|json|md|txt))`?/i)
    || s.match(/`([~\w./-]+\.(?:py|js|ts|tsx|jsx|mjs|cjs|rb|go|rs|java|json|md|txt))`/);
  return m ? m[1] : null;
}

/** First sentence of a docstring/prose, for a short "behaviour" line. */
function firstSentence(text) {
  const s = String(text ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  const m = s.match(/^(.{10,240}?[.!?])(?:\s|$)/);
  return m ? m[1] : s.slice(0, 200);
}

/** A single-line canonical signature string from a parsed signature. */
export function normalizeSignature(sig) {
  if (!sig) return null;
  const params = (sig.params || [])
    .map((p) => {
      if (p.kind === 'varargs') return `*${p.name}`;
      if (p.kind === 'kwargs') return `**${p.name}`;
      if (p.kind === 'kwonly-marker' || p.kind === 'positional-only-marker') return p.name;
      let s = p.name;
      if (p.annotation) s += `: ${p.annotation}`;
      if (p.default != null) s += ` = ${p.default}`;
      return s;
    })
    .join(', ');
  const ret = sig.returns ? ` -> ${sig.returns}` : '';
  return `${sig.kind === 'class' ? 'class' : 'def'} ${sig.name}(${params})${ret}:`;
}

/**
 * A COMPACT, model-facing block that states the contract. Small on purpose —
 * the M22 finding is that the model fails on the contract, not on prompt size,
 * so this adds the missing facts without a wall of prose.
 */
export function renderContractBlock(contract) {
  if (!contract || !contract.name) return null;
  const lines = ['REQUIRED CONTRACT (must be honoured exactly):'];
  lines.push(`- Define exactly: ${contract.signature || `${contract.name}(...)`}`);
  const ordered = (contract.params || []).filter((p) => p.kind !== 'kwonly-marker' && p.kind !== 'positional-only-marker');
  if (ordered.length) {
    lines.push(`- Parameters, in order: ${ordered.map((p) => p.name).join(', ')}`);
  }
  if (contract.returns) lines.push(`- Return: ${contract.returns}`);
  if (contract.behavior) lines.push(`- Behaviour: ${contract.behavior}`);
  if (contract.doctests?.length) {
    lines.push('- Worked examples (your implementation must reproduce these):');
    for (const d of contract.doctests.slice(0, 6)) {
      lines.push(`    ${d.expr}  =>  ${d.expected}`);
    }
  }
  if (contract.imports?.length) lines.push(`- Keep these imports: ${contract.imports.join('; ')}`);
  if (contract.doctests?.length) {
    lines.push('- SELF-CHECK before you finish: run each worked example above against your');
    lines.push('  implementation (e.g. with term_execute) and fix any that does not match.');
  }
  return lines.join('\n');
}

/**
 * Check a written source against a contract using the pure structural reader.
 * Returns { ok, violations: [{code, detail}] }. This is the post-write gate;
 * it never executes anything.
 */
export function checkAgainstContract(source, contract) {
  const s = String(source ?? '');
  const violations = [];
  if (!contract?.name) return { ok: true, violations };
  const all = parseAllSignatures(s);
  const defs = all.map((d) => d.name);
  if (!defs.includes(contract.name)) {
    violations.push({ code: 'missing-entry-point', detail: `${contract.name} is not defined (found: ${defs.join(', ') || 'none'})` });
    return { ok: false, violations };
  }
  const count = defs.filter((n) => n === contract.name).length;
  if (count > 1) {
    violations.push({ code: 'duplicate-entry-point', detail: `${contract.name} is defined ${count} times` });
  }
  const sig = all.find((d) => d.name === contract.name);
  const want = (contract.params || []).filter((p) => p.kind !== 'kwonly-marker' && p.kind !== 'positional-only-marker').map((p) => p.name);
  const got = (sig.params || []).filter((p) => p.kind !== 'kwonly-marker' && p.kind !== 'positional-only-marker').map((p) => p.name);
  if (want.length && want.join(',') !== got.join(',')) {
    violations.push({ code: 'signature-mismatch', detail: `expected (${want.join(', ')}), got (${got.join(', ')})` });
  }
  if (!bodyIsComplete(sig.body)) {
    violations.push({ code: 'incomplete-body', detail: `${contract.name} has no implementation (docstring/placeholder only)` });
  }
  return { ok: violations.length === 0, violations };
}
