/**
 * JEXI OS — Phase 14 Scope F — signature-only summary under a token budget.
 *
 *   summarize(root, ranked, { budget }) -> { files, summary, tokens }
 *
 * Only KEY SIGNATURES enter the summary — export/function/class/const
 * declarations for code, headings for markdown. Full bodies never
 * appear; every signature line is hard-truncated at 400 chars.
 *
 * Budget (default 1000 tokens, ~4 chars/token): files are added in
 * rank order while the running total fits; truncation therefore
 * drops the LOWEST-ranked files first. The top 10 are ALWAYS kept,
 * even when they alone exceed the budget (the retention floor wins;
 * documented). tokens is the real estimate of what was kept.
 */
import fs from 'node:fs';
import path from 'node:path';

export const MAX_LINE = 400;
export const DEFAULT_BUDGET = 1000;
export const TOP_KEEP = 10;

const SIG_JS = /^\s*(export\s+(default\s+)?(async\s+)?(function|class|const|let)\b|function\s+\w+|class\s+\w+)/;
const SIG_MD = /^#{1,4}\s/;

export function signaturesFor(rel, content) {
  const isMd = rel.endsWith('.md');
  const lines = String(content).split('\n');
  const sigs = [];
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if ((isMd && SIG_MD.test(trimmed)) || (!isMd && SIG_JS.test(trimmed))) {
      sigs.push(trimmed.length > MAX_LINE ? trimmed.slice(0, MAX_LINE) : trimmed);
    }
    if (sigs.length >= 12) break;
  }
  return sigs;
}

export const estimateTokens = (text) => Math.ceil(text.length / 4);

export function summarize(root, ranked, { budget = DEFAULT_BUDGET } = {}) {
  const kept = [];
  const blocks = [];
  let tokens = 0;
  for (const entry of ranked) {
    let content = '';
    try { content = fs.readFileSync(path.join(root, entry.path), 'utf8'); } catch { content = ''; }
    const sigs = signaturesFor(entry.path, content);
    const block = `## ${entry.path} [score ${entry.score}]` + (sigs.length ? '\n' + sigs.map((s) => `  ${s}`).join('\n') : '');
    const t = estimateTokens(block);
    const withinFloor = kept.length < TOP_KEEP;
    if (!withinFloor && tokens + t > budget) continue; // drop lowest-ranked first
    kept.push(entry.path);
    blocks.push(block);
    tokens += t;
  }
  return { files: kept, summary: blocks.join('\n'), tokens };
}
