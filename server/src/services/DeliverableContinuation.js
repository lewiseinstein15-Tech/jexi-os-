/**
 * DeliverableContinuation — B201 (Test B residual): a COUNTED file
 * deliverable ("10 lessons, one file per lesson") that came up short — a weak
 * fallback model stopping early, an output cap, whatever — gets continuation
 * passes BEFORE the answer ships: "you asked for 10, you wrote 4 — write the
 * rest."
 *
 * Runs at the index.js terminal seam (before done()), appends the missing
 * file blocks to the summary (the answer grows to include everything), and
 * narrates each round live. The FileBlockWriter persists whatever blocks the
 * final summary contains — dedup by filename means continuations can never
 * double-write a file.
 *
 * Never throws, never blocks the answer on failure; stops after maxRounds or
 * when a round adds nothing (no infinite loops on a dead model).
 */
import { extractFileBlocks } from './FileBlockWriter.js';

const WORD_NUMS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };
const MAX_ROUNDS = 4;
const MAX_TOTAL_FILES = 40;

/** The count of files/lessons/etc the user explicitly asked for, or null. */
export function parseRequestedCount(query) {
  const q = String(query || '').toLowerCase();
  let m = q.match(/(\d+)\s*(?:different\s*)?(?:lessons?|files?|chapters?|sections?|parts?|episodes?|recipes?|flashcard sets?|workouts?|emails?|posts?)/);
  if (m) return Math.min(parseInt(m[1], 10), MAX_TOTAL_FILES);
  m = q.match(/(?:lesson|file|chapter|part)-(\d+)\s*(?:through|to|-|–)\s*(?:lesson|file|chapter|part)-(\d+)/);
  if (m) return Math.min(parseInt(m[2], 10), MAX_TOTAL_FILES);
  m = q.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\s*(?:lessons?|files?|chapters?|parts?)\b/);
  if (m) return Math.min(WORD_NUMS[m[1]] || 0, MAX_TOTAL_FILES);
  return null;
}

/** Infer the numbered filename pattern from delivered files, when possible.
 *  ['swahili-lessons/lesson-01.md', 'swahili-lessons/lesson-02.md'] →
 *  { prefix: 'swahili-lessons/lesson-', suffix: '.md', width: 2, nums: [1, 2] } */
function numberedPattern(names) {
  const parsed = names
    .map((n) => {
      const m = String(n).match(/^(.*?)(\d+)(\.[a-z0-9]+)$/i);
      return m ? { prefix: m[1], suffix: m[3], num: parseInt(m[2], 10), width: m[2].length } : null;
    })
    .filter(Boolean);
  if (parsed.length < 1) return null;
  const first = parsed[0];
  const same = parsed.every((p) => p.prefix === first.prefix && p.suffix === first.suffix && p.width === first.width);
  if (!same) return null;
  return { prefix: first.prefix, suffix: first.suffix, width: first.width, nums: parsed.map((p) => p.num) };
}

/**
 * Continue a short deliverable. Returns { summary, added, rounds, requested,
 * delivered } — summary unchanged when nothing was (or needed to be) added.
 * `generate` is injectable for tests (defaults to the real generateContent).
 */
export async function continueDeliverable({
  query,
  summary,
  sendEvent = () => {},
  generate = null,
  maxRounds = MAX_ROUNDS,
} = {}) {
  const text = String(summary || '');
  const requested = parseRequestedCount(query);
  if (!requested || !text.includes('```')) return { summary: text, added: [], rounds: 0, requested, delivered: null };

  const say = (t) => { try { sendEvent('narration', { text: t }); } catch { /* never block */ } };
  let working = text;
  let rounds = 0;

  for (let r = 0; r < maxRounds; r++) {
    const have = extractFileBlocks(working);
    const names = have.map((b) => b.name);
    if (have.length >= requested) break;

    // Name the missing files when the pattern is inferable.
    const pattern = numberedPattern(names);
    let wantList;
    if (pattern) {
      const missing = [];
      for (let n = 1; n <= requested; n++) {
        if (!pattern.nums.includes(n)) missing.push(`${pattern.prefix}${String(n).padStart(pattern.width, '0')}${pattern.suffix}`);
      }
      wantList = missing.join(', ');
    } else {
      wantList = `${requested - have.length} more file${requested - have.length > 1 ? 's' : ''} (${requested} expected, ${have.length} written)`;
    }

    say(`My draft covered ${have.length} of ${requested} — writing the rest now.`);
    rounds += 1;

    const prompt = [
      `The user asked for this writing deliverable:`,
      `"${String(query).slice(0, 1200)}"`,
      ``,
      `Files already written (do NOT repeat them): ${names.join(', ') || '(none)'}`,
      ``,
      `Write ${wantList}.`,
      `Use EXACTLY the same format as the existing files: a line with the filename in bold (**path/filename.md**), then a fenced markdown block (\`\`\`markdown ... \`\`\`) with the complete file content.`,
      `Do not stop early. Do not ask questions. Output only the missing files.`,
    ].join('\n');

    let reply = null;
    try {
      if (typeof generate === 'function') reply = await generate(prompt, r, have);
      else {
        const { generateContent } = await import('./LLMClient.js');
        const { JEXI_SYSTEM_PROMPT } = await import('./JexiPrompt.js');
        reply = await generateContent(prompt, (JEXI_SYSTEM_PROMPT || '') + '\nYou are finishing a writing deliverable. Output the missing files only.', null, { temperature: 0.3 });
      }
    } catch (e) {
      say(`I could not finish the remaining files this time (${String(e && e.message || e).slice(0, 60)}).`);
      break;
    }

    const fresh = extractFileBlocks(String(reply || ''));
    const added = fresh.filter((b) => !names.includes(b.name));
    if (!added.length) break; // model produced nothing new — stop honestly
    working = `${working}\n\n${String(reply).trim()}`;
    say(`Done — ${extractFileBlocks(working).length} of ${requested} files written.`);
  }

  const finalBlocks = extractFileBlocks(working);
  return { summary: working, added: finalBlocks.map((b) => b.name), rounds, requested, delivered: finalBlocks.length };
}
