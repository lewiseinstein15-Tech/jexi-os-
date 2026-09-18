/**
 * JEXI OS — COMMANDS — /build-fix (Phase 7 G).
 *
 * The build-error resolver run: reads the real error (planted or last
 * recorded), classifies it, proposes a fix. The deterministic diagnosis is
 * the REAL CodeJudge.diagnoseJsFile (node --check with line recovery); when
 * a provider is live an LLM second opinion is fetched through the real
 * client. Classification + suggestion are always real — never invented.
 */

import path from 'node:path';
import fs from 'node:fs';
import { serverMod, clampText, redact } from './_context.js';

const ERROR_CLASSES = [
  { re: /SyntaxError|Unexpected (token|end of input)|missing semi|Invalid regular expression/i, cls: 'syntax' },
  { re: /Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/i, cls: 'missing-module' },
  { re: /is not defined|is not a function|undefined \(reading|has no properties in common|null \(reading/i, cls: 'reference' },
  { re: /EACCES|EPERM|EISDIR|ELOOP/i, cls: 'permissions' },
  { re: /ENOENT|ENOTDIR/i, cls: 'missing-file' },
  { re: /EADDRINUSE|ECONNREFUSED|ETIMEDOUT|ECONNRESET|fetch failed|network/i, cls: 'network' },
  { re: /TypeError/i, cls: 'type' },
  { re: /RangeError|Maximum call stack/i, cls: 'range' },
];

function classify(message) {
  for (const { re, cls } of ERROR_CLASSES) {
    if (re.test(message)) return cls;
  }
  return 'unknown';
}

const SUGGESTIONS = {
  syntax: 'Run the file through node --check and repair the reported line; look for an unclosed bracket/quote just ABOVE it.',
  'missing-module': 'Verify the import path + extension relative to the importing file; check the module actually exists in this layout (root vs server/).',
  reference: 'Find where the symbol should come from (import, destructure, typo) and wire it; grep the repo for the exact identifier.',
  permissions: 'Fix file permissions or run without elevated expectations; never chmod 777 — grant the specific user.',
  'missing-file': 'Create the missing path or correct the spelling; check the working directory the process runs from.',
  network: 'Check the target is reachable and the URL/port is right; add a timeout + retry with backoff.',
  type: 'Guard the value before use (typeof check / optional chaining) and fix the producer of the wrong type.',
  range: 'Find the unbounded recursion or huge allocation; add a depth/size cap.',
  unknown: 'Reproduce with the stack trace, isolate the smallest failing input, then fix at the source.',
};

export default {
  name: 'build-fix',
  aliases: [],
  description: 'Read + classify the latest build error and propose a fix (resolver run)',
  category: 'debug',
  args: [
    { name: 'path', required: false, type: 'path', default: '', description: 'file to diagnose (default: newest changed JS file with a syntax error, or the error you paste)' },
    { name: 'error', required: false, type: 'string', default: '', description: 'a pasted error message to classify' },
  ],
  async handler(args, ctx) {
    const CodeJudge = await serverMod('src/services/CodeJudge.js');
    if (!CodeJudge?.diagnoseJsFile) {
      return { ok: false, summary: 'CodeJudge not available in this runtime', error: 'server/src/services/CodeJudge.js missing' };
    }

    ctx.log('build-error-resolver starting…');
    const steps = [];
    let target = String(args.path || '').trim();
    let diagnosis = null;

    // 1. locate the target when not given: newest *.js under cwd (2 levels) that fails node --check
    if (!target && !args.error) {
      const candidates = [];
      const walk = (dir, depth) => {
        if (depth > 2 || candidates.length > 200) return;
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'data') continue;
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p, depth + 1);
          else if (/\.(js|mjs|cjs)$/.test(e.name)) candidates.push(p);
        }
      };
      walk(process.cwd(), 0);
      for (const c of candidates.slice(0, 120)) {
        const d = CodeJudge.diagnoseJsFile(c);
        if (!d.pass) { target = c; diagnosis = d; break; }
      }
      steps.push(`scanned ${Math.min(candidates.length, 120)} JS files for a failing one`);
    }

    // 2. diagnose the real error
    let classification = 'unknown';
    let message = String(args.error || '');
    if (target && !diagnosis) {
      const abs = path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
      if (!fs.existsSync(abs)) {
        classification = 'missing-file';
        message = `ENOENT: ${abs} does not exist`;
      } else {
        diagnosis = CodeJudge.diagnoseJsFile(abs);
        message = diagnosis.pass ? '' : diagnosis.message;
        classification = diagnosis.pass ? 'clean' : classify(diagnosis.message);
      }
    } else if (message) {
      classification = classify(message);
    }

    const evidence = {
      target: target ? (path.isAbsolute(target) ? target : path.resolve(process.cwd(), target)) : null,
      line: diagnosis?.line ?? null,
      message: clampText(redact(message), 300),
    };
    steps.push(target ? `diagnosed ${evidence.target}${evidence.line ? `:${evidence.line}` : ''}` : 'classified the pasted error');
    ctx.log(`classified: ${classification}${evidence.line ? ` (line ${evidence.line})` : ''}`);

    // 3. propose a fix — deterministic first, LLM second opinion when live
    let suggestion = SUGGESTIONS[classification] || SUGGESTIONS.unknown;
    let mode = 'deterministic';
    let llm = null;
    try {
      const providers = await serverMod('src/providers/index.js');
      if (providers?.canChat?.()) {
        const LLM = await serverMod('src/providers/runtime/LLMClient.js');
        if (LLM?.generateContent) {
          ctx.log('fetching LLM second opinion…');
          const prompt = [
            `A build failed. Class: ${classification}.`,
            evidence.target ? `File: ${evidence.target}${evidence.line ? ` line ${evidence.line}` : ''}.` : '',
            `Error: ${evidence.message}`,
            'Propose the fix in at most 3 sentences. Be concrete (what line, what change).',
          ].filter(Boolean).join('\n');
          const r = await LLM.generateContent(prompt, 'You are a build-error resolver. Answer briefly and concretely.', null, { maxTokens: 300 });
          const text = clampText(redact(typeof r === 'string' ? r : (r?.text || r?.answer || '')), 600);
          if (text) { llm = text; suggestion = `${suggestion} — LLM: ${text}`; mode = 'deterministic+llm'; }
        }
      }
    } catch { llm = null; }
    steps.push(`fix proposed via ${mode}`);

    const ok = classification !== 'unknown' || !!message;
    return {
      ok,
      summary: target
        ? `resolver run: ${path.basename(evidence.target || '')} → ${classification}${evidence.line ? ` @line ${evidence.line}` : ''} — fix proposed (${mode})`
        : `resolver run: pasted error → ${classification} — fix proposed (${mode})`,
      classification,
      evidence,
      suggestion,
      mode,
      llmOpinion: llm,
      clean: classification === 'clean',
      steps,
    };
  },
};
