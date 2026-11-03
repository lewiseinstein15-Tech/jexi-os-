/**
 * M19 — WRITE-PAYLOAD NORMALIZATION suite.
 *
 * Proves the confirmed M18 defect is closed: a whole-file write payload whose
 * newlines were emitted as the literal two-character sequence `\n` is decoded
 * to real newlines before it reaches disk, WHILE every legitimate backslash is
 * preserved. Each case is the exact thing a naive `.replace(/\\n/g,'\n')`
 * would corrupt.
 *
 * Deterministic, headless, ZERO network. Run:
 *   node --test tests/agi/test-m19-write-payload-normalization.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  normalizeWriteArgs,
  isDoubleEscapedPayload,
  decodeEscapedControls,
  WRITE_CONTENT_TOOLS,
} from '../../src/services/agent/WritePayloadNormalizer.js';
import {
  recoverToolCallsFromText,
  resolveToolName,
  TOOL_ALIASES,
} from '../../src/services/agent/ToolCallRecovery.js';

const N = '\\n'; // literal backslash + n
const T = '\\t';
const NL = '\n';

/** Apply the normalizer and return the effective content. */
const eff = (slug, content) => {
  const r = normalizeWriteArgs(slug, { path: 'solution.py', content });
  return { content: r.changed ? r.args.content : content, changed: r.changed, reason: r.reason };
};

test('M19/N1: a normal multi-line Python file is preserved byte-for-byte', () => {
  const src = 'from typing import List\n\ndef has_close_elements(xs: List[float]) -> bool:\n    return len(xs) > 0\n';
  const r = eff('fs_write', src);
  assert.equal(r.changed, false);
  assert.equal(r.content, src);
});

test('M19/N2: literal escaped newlines are decoded to real newlines', () => {
  const src = 'def f():' + N + '    return 1' + N;
  const r = eff('fs_write', src);
  assert.equal(r.changed, true);
  assert.equal(r.content, 'def f():' + NL + '    return 1' + NL);
  assert.ok(!r.content.includes(N), 'no literal backslash-n survives');
});

test('M19/N3: literal tabs and indentation are decoded', () => {
  const src = 'def f():' + N + T + 'return 1' + N;
  const r = eff('fs_write', src);
  assert.equal(r.changed, true);
  assert.equal(r.content, 'def f():' + NL + '\treturn 1' + NL);
});

test('M19/N4: a Windows-style path inside a string literal is PRESERVED', () => {
  // The `\n` in "C:\new" is a real path separator, not a newline. The scanner
  // must not touch it even though the payload has no real newlines.
  const src = 'p = r"C:' + N + 'ew"' + N + 'print(p)';
  const r = eff('fs_write', src);
  assert.equal(r.changed, true, 'structural separator still decoded');
  assert.ok(r.content.includes('r"C:' + N + 'ew"'), 'the in-string path keeps its backslash');
  assert.equal(r.content, 'p = r"C:' + N + 'ew"' + NL + 'print(p)');
});

test('M19/N5: a backslash inside a Python string literal is preserved', () => {
  const src = 'x = "a' + N + 'b"'; // a single-line file: only in-string escape
  const r = eff('fs_write', src);
  assert.equal(r.changed, false, 'no structural separator -> nothing to do');
  assert.equal(r.content, src);
});

test('M19/N6: JSON content is preserved (escapes are data, not structure)', () => {
  const src = '{"path": "a' + N + 'b", "n": 1}';
  const r = eff('fs_write', src);
  assert.equal(r.changed, false);
  assert.equal(r.content, src);
});

test('M19/N7: an empty file is a no-op', () => {
  const r = eff('fs_write', '');
  assert.equal(r.changed, false);
  assert.equal(r.content, '');
});

test('M19/N8: Unicode content is preserved', () => {
  const src = 's = "café ☕ 日本語"' + NL;
  const r = eff('fs_write', src);
  assert.equal(r.changed, false);
  assert.equal(r.content, src);
});

test('M19/N9: an already-valid source file is untouched', () => {
  const src = 'import json\n\ndef parse(s: str):\n    return json.loads(s)\n';
  const r = eff('fs_write', src);
  assert.equal(r.changed, false);
  assert.equal(r.content, src);
});

test('M19/N10: only whole-file tools are normalized (never a needle/arg)', () => {
  assert.ok(WRITE_CONTENT_TOOLS.has('fs_write'));
  assert.ok(WRITE_CONTENT_TOOLS.has('fs_append'));
  assert.equal(WRITE_CONTENT_TOOLS.has('fs_edit'), false);
  // fs_edit's `find` must NEVER be decoded — a literal \n there is a needle.
  const r = normalizeWriteArgs('fs_edit', { path: 'a.py', find: 'x' + N + 'y', replace: 'z' });
  assert.equal(r.changed, false);
  assert.equal(r.reason, 'tool-not-write-content');
});

test('M19/N11: other backslash escapes are never rewritten', () => {
  const src = 'import re' + N + 'p = re.compile(r"' + '\\d+' + '")' + N; // literal \d
  const r = eff('fs_write', src);
  assert.equal(r.changed, true);
  assert.ok(r.content.includes('\\d+'), 'regex \\d survives');
  assert.equal(r.content, 'import re' + NL + 'p = re.compile(r"' + '\\d+' + '")' + NL);
});

test('M19/N12: a triple-quoted docstring keeps its inner escapes', () => {
  const src = 'def f():' + N + '    """a' + N + 'b"""' + N + '    return 1' + N;
  const r = eff('fs_write', src);
  assert.equal(r.changed, true);
  // The docstring body's literal \n is inside a triple-quoted region -> kept.
  assert.ok(r.content.includes('"""a' + N + 'b"""'));
});

test('M19/N13: isDoubleEscapedPayload fires on escaped AND dominant-literal payloads', () => {
  assert.equal(isDoubleEscapedPayload('a' + N + 'b'), true);
  assert.equal(isDoubleEscapedPayload('a' + NL + 'b'), false);
  // M18/R2 mixed shape: literal `\n` OUTNUMBER the real newlines -> escaped.
  assert.equal(isDoubleEscapedPayload('a' + N + 'b' + N + 'c' + NL + 'd'), true, 'dominant literal -> decoded');
  // A legitimate file: real newlines dominate, literal `\n` only inside strings.
  assert.equal(isDoubleEscapedPayload('a = "x' + N + 'y"' + NL + 'b = 1' + NL + 'c = 2'), false, 'real newlines dominate -> untouched');
  assert.equal(isDoubleEscapedPayload('a' + NL + 'b' + N + 'c'), false, 'one literal vs one real is ambiguous -> untouched');
  assert.equal(isDoubleEscapedPayload('plain text'), false);
  assert.equal(isDoubleEscapedPayload(''), false);
});

test('M19/N14: decodeEscapedControls leaves unknown escapes verbatim', () => {
  assert.equal(decodeEscapedControls('a' + '\\\\' + 'b'), 'a' + '\\\\' + 'b'); // double backslash
  assert.equal(decodeEscapedControls('a' + '\\u0041'), 'a' + '\\u0041');
  assert.equal(decodeEscapedControls('trailing' + '\\'), 'trailing' + '\\');
});

test('M19/N15: the M18 HumanEval/3 payload now writes a parseable file and grades PASS', () => {
  // The exact bytes recovered from the M18 artifact: the CORRECT below_zero
  // implementation, but every newline is the literal two-character `\n`.
  const payload = [
    'from typing import List',
    '',
    'def below_zero(operations: List[int]) -> bool:',
    '    balance = 0',
    '    for op in operations:',
    '        balance += op',
    '        if balance < 0:',
    '            return True',
    '    return False',
  ].join(N) + N;

  const r = eff('fs_write', payload);
  assert.equal(r.changed, true);
  assert.ok(r.content.includes(NL));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-m19-'));
  try {
    fs.writeFileSync(path.join(dir, 'solution.py'), r.content, 'utf8');
    fs.writeFileSync(path.join(dir, 'test_below_zero.py'), [
      'from typing import List',
      'def check(candidate):',
      '    assert candidate([]) == False',
      '    assert candidate([1, 2, 3]) == False',
      '    assert candidate([1, 2, -4, 5]) == True',
      '',
      'check(below_zero)',
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(dir, 'grade.py'), [
      'import sys, traceback',
      'ns = {}',
      'try:',
      '    exec(open("solution.py", encoding="utf-8").read(), ns)',
      '    exec(open("test_below_zero.py", encoding="utf-8").read(), ns)',
      '    print("HUMANEVAL_GRADE=PASS")',
      '    sys.exit(0)',
      'except Exception:',
      '    traceback.print_exc()',
      '    print("HUMANEVAL_GRADE=FAIL")',
      '    sys.exit(1)',
    ].join('\n'), 'utf8');
    const out = execFileSync('python3', ['grade.py'], { cwd: dir, encoding: 'utf8' });
    assert.match(out, /HUMANEVAL_GRADE=PASS/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M19/N16: the RAW (un-normalized) payload fails the same grader — the defect is real', () => {
  const payload = 'def below_zero(operations):' + N + '    return False' + N;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-m19-raw-'));
  try {
    fs.writeFileSync(path.join(dir, 'solution.py'), payload, 'utf8');
    let failed = false;
    try {
      execFileSync('python3', ['-c', 'import ast,sys; ast.parse(open("solution.py",encoding="utf-8").read())'], { cwd: dir, encoding: 'utf8' });
    } catch { failed = true; }
    assert.equal(failed, true, 'raw literal-\\n payload is a SyntaxError');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ── M19 alias resolution (the category-B defect) ───────────────────────── */

const MENU = ['fs_read', 'fs_write', 'fs_edit', 'term_execute', 'pytest_run', 'capability_check', 'ask_user_question', 'request_tools'];

test('M19/A1: the exact M18 failure — code_write prose is recovered as fs_write', () => {
  // Verbatim shape captured from the live ollama round that died with zero
  // tool calls (M18 category B).
  const text = '{"name":"code_write","parameters":{"path":"/tmp/x/solution.py","content":"def f():\\n    return 1"}}';
  const calls = recoverToolCallsFromText(text, MENU);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'fs_write');
  assert.equal(calls[0].aliasedFrom, 'code_write');
  assert.equal(calls[0].arguments.path, '/tmp/x/solution.py');
});

test('M19/A2: alias resolution is case- and separator-insensitive', () => {
  for (const variant of ['code_write', 'code-write', 'Code_Write', 'CODE-WRITE']) {
    const r = resolveToolName(variant, MENU);
    assert.equal(r?.name, 'fs_write', `${variant} should resolve to fs_write`);
    assert.equal(r?.aliased, true);
  }
});

test('M19/A3: an exact offered name resolves without aliasing', () => {
  const r = resolveToolName('fs_write', MENU);
  assert.equal(r.name, 'fs_write');
  assert.equal(r.aliased, false);
});

test('M19/A4: an alias to a NON-offered tool is refused (no menu expansion)', () => {
  assert.equal(resolveToolName('code_delete', MENU), null);
  assert.equal(resolveToolName('fs_delete', MENU), null);
  assert.equal(recoverToolCallsFromText('{"name":"code_delete","parameters":{"path":"x"}}', MENU).length, 0);
});

test('M19/A5: an invented name is refused', () => {
  assert.equal(resolveToolName('definitely_not_a_tool', MENU), null);
  assert.equal(resolveToolName('', MENU), null);
  assert.equal(resolveToolName('code_write', []), null, 'empty menu discloses nothing');
});

test('M19/A6: every alias target is a real domain tool slug', () => {
  const domainTools = new Set([
    'fs_read', 'fs_write', 'fs_edit', 'fs_append', 'fs_delete', 'fs_glob', 'fs_grep', 'fs_ls',
    'term_execute', 'term_session', 'pytest_run', 'test_run', 'test_coverage',
  ]);
  for (const [alias, target] of Object.entries(TOOL_ALIASES)) {
    assert.ok(domainTools.has(target), `alias ${alias} -> ${target} must be a domain tool`);
  }
});

test('M19/A7: the write path alias remaps filename -> path only when path is absent', () => {
  const a = recoverToolCallsFromText('{"name":"code_write","parameters":{"filename":"a.py","content":"x"}}', MENU);
  assert.equal(a[0].arguments.path, 'a.py');
  assert.equal(a[0].arguments.filename, undefined);
  // An explicit path wins; the synonym is left untouched.
  const b = recoverToolCallsFromText('{"name":"code_write","parameters":{"path":"b.py","filename":"a.py","content":"x"}}', MENU);
  assert.equal(b[0].arguments.path, 'b.py');
});

test('M19/A8: alias resolution does not weaken the native-call preference', () => {
  // Recovery is only consulted when native calls are absent; a direct fs_write
  // still resolves to itself, so a real native call is never rewritten.
  const r = resolveToolName('fs_write', MENU);
  assert.equal(r.aliased, false);
});

/* ── M19 bounded malformed-call retry (through the REAL provider loop) ──── */

test('M19/R1: a truncated prose call triggers ONE bounded retry that recovers the write', async () => {
  const { generateWithToolsLoop } = await import('../../src/providers/runtime/LLMClient.js');
  const { executeTool, setToolProfile } = await import('../../src/services/ToolRuntime.js');
  setToolProfile('full');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-m19-retry-'));
  const target = path.join(dir, 'solution.py');
  const tools = ['fs_write', 'term_execute'].map((n) => ({
    type: 'function',
    function: { name: n, description: n, parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: [] } },
  }));

  // Round 1: a call the model clearly intended, but with a truncated
  // (unparseable) `content` — the exact residual M18 failure shape.
  const truncated = '{"name":"fs_write","parameters":{"path":' + JSON.stringify(target) + ',"content":"from typing import List\\n\\ndef f():\\n    """unterminated';
  let call = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    call++;
    if (call === 1) {
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: truncated } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    // The retry: a valid native call.
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'fs_write', arguments: JSON.stringify({ path: target, content: 'def f():\n    return 1\n' }) } }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const retries = [];
  const prevWs = process.env.WORKSPACE_DIR;
  process.env.WORKSPACE_DIR = dir; // M6/D1 — writes are confined to the workspace jail
  try {
    const res = await generateWithToolsLoop('write the file', 'sys', tools, {
      provider: 'ollama',
      model: 'llama3.2:3b',
      maxIterations: 1, // the retry must not need a second loop iteration
      onMalformedCallRetry: () => retries.push(1),
      executeToolCalls: async (calls) => {
        const out = [];
        for (const c of calls) {
          const r = await executeTool({ slug: c.name, args: c.arguments || {}, profile: 'full' });
          out.push({ tool_call_id: c.id, content: JSON.stringify(r).slice(0, 120) });
        }
        return out;
      },
    });
    assert.equal(retries.length, 1, 'the malformed-call retry fired exactly once');
    assert.ok(res.toolCalls.some((c) => c.name === 'fs_write'), 'the retried native call was executed');
    assert.equal(fs.readFileSync(target, 'utf8'), 'def f():\n    return 1\n');
  } finally {
    globalThis.fetch = realFetch;
    if (prevWs === undefined) delete process.env.WORKSPACE_DIR; else process.env.WORKSPACE_DIR = prevWs;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M19/R2: the retry is opt-out and never fires for a plain direct answer', async () => {
  const { generateWithToolsLoop } = await import('../../src/providers/runtime/LLMClient.js');
  const tools = [{ type: 'function', function: { name: 'fs_write', description: 'w', parameters: { type: 'object', properties: {}, required: [] } } }];
  let call = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    call++;
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'The answer is 42.' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const retries = [];
  try {
    const res = await generateWithToolsLoop('answer', 'sys', tools, {
      provider: 'ollama', model: 'llama3.2:3b', maxIterations: 2,
      onMalformedCallRetry: () => retries.push(1),
      executeToolCalls: async () => [],
    });
    assert.equal(retries.length, 0, 'plain prose is not a malformed call');
    assert.equal(call, 1, 'no extra model call was made');
    assert.equal(res.text, 'The answer is 42.');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('M19/N17: the M18 HumanEval/1 MIXED payload (literal \\n + a stray real newline) is repaired', () => {
  // Measured live (2026-11-02): 7 literal `\n` against 1 real newline — the
  // original "no real newline" guard refused it and the file was written
  // broken (`from typing import List\n\ndef …` on ONE line -> SyntaxError).
  const BS = '\\';
  const mixed = 'from typing import List' + BS + 'n' + BS + 'ndef f():' + BS + 'n    return 1' + NL;
  assert.equal(isDoubleEscapedPayload(mixed), true);
  const r = normalizeWriteArgs('fs_write', { path: 'solution.py', content: mixed });
  assert.equal(r.changed, true);
  assert.ok(r.args.content.includes(NL + 'def f():'), 'the literal \\n became a real newline');
  assert.equal(r.args.content, 'from typing import List' + NL + NL + 'def f():' + NL + '    return 1' + NL);
});

test('M19/N18: a real file whose strings contain \\n is NOT rewritten (dominance guard)', () => {
  const BS = '\\';
  const legit = 'lines = []' + NL + 'sep = "' + BS + 'n"' + NL + 'text = "a' + BS + 'nb"' + NL + 'print(sep.join(lines))' + NL;
  assert.equal(isDoubleEscapedPayload(legit), false);
  const r = normalizeWriteArgs('fs_write', { path: 'x.py', content: legit });
  assert.equal(r.changed, false);
  assert.equal(r.args.content, legit, 'byte-for-byte preserved');
});
