/**
 * JEXI OS — Phase 27 Scope C — deterministic complexity classifier.
 *
 * classify(prompt) -> { class: 'simple' | 'strong', score, signals }
 *
 * Five signals contribute to a 0..10 score (openclaude model-routing
 * pattern: everyday turns -> cheap tier, complex work -> strongest tier):
 *
 *   length        0/1/2  prompt length >= 250 / >= 600 chars
 *   nesting       0/1/2  max bracket/brace/paren nesting depth >= 2 / >= 4
 *   tools         0/1/2  tool-verb/keyword mentions >= 2 / >= 4
 *   code          0/1/2  fenced code block / inline code present
 *   questions     0/1/2  '?' count 2 / >= 3 (multi-question)
 *
 * score >= STRONG_THRESHOLD (4) routes to 'strong'. Every sub-score is
 * computed from the prompt text — nothing is fabricated, no randomness,
 * no time, no network: the same prompt always yields the same result.
 */
import { RoutingError } from './_internal.js';

export const STRONG_THRESHOLD = 4;

export const CLASSES = ['simple', 'strong'];

/** Documented tool/keyword list (case-insensitive, whole words). */
export const TOOL_RE =
  /\b(spawn|deploy|migrate|refactor|orchestrat\w*|pipeline|workflow|daemon|scheduler|benchmark|instrument|grep|lint|compile|transpile|scan|audit|build|test|provision|teardown|rollback|snapshot)\b/gi;

export function maxNestingDepth(prompt) {
  let depth = 0;
  let max = 0;
  for (const ch of prompt) {
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
      if (depth > max) max = depth;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1);
    }
  }
  return max;
}

export function classify(prompt) {
  if (typeof prompt !== 'string' || prompt.length === 0) {
    throw new RoutingError('E_INVALID_PROMPT', 'prompt must be a non-empty string');
  }

  const length = prompt.length;
  const lengthScore = length >= 600 ? 2 : length >= 250 ? 1 : 0;

  const nestingDepth = maxNestingDepth(prompt);
  const nestingScore = nestingDepth >= 4 ? 2 : nestingDepth >= 2 ? 1 : 0;

  const toolMentions = (prompt.match(TOOL_RE) || []).length;
  const toolScore = toolMentions >= 4 ? 2 : toolMentions >= 2 ? 1 : 0;

  const hasFencedCode = prompt.includes('```');
  const hasInlineCode = !hasFencedCode && /`[^`]+`/.test(prompt);
  const codeScore = hasFencedCode ? 2 : hasInlineCode ? 1 : 0;

  const questionCount = (prompt.match(/\?/g) || []).length;
  const questionScore = questionCount >= 3 ? 2 : questionCount === 2 ? 1 : 0;

  const score = lengthScore + nestingScore + toolScore + codeScore + questionScore;
  const klass = score >= STRONG_THRESHOLD ? 'strong' : 'simple';

  return {
    class: klass,
    score,
    signals: {
      length,
      lengthScore,
      nestingDepth,
      nestingScore,
      toolMentions,
      toolScore,
      hasFencedCode,
      codeScore,
      questionCount,
      questionScore,
    },
  };
}
