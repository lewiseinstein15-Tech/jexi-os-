/**
 * Narration — the agent's own first-person words between tool calls.
 * A plain paragraph in the transcript flow: NO card, NO background,
 * NO border. Short spoken asides (< 160 chars, single paragraph) render
 * in JEXI's hand (Caveat); anything longer stays in the readable UI face
 * (legibility lesson of 2026-09-08: handwriting never carries body text).
 */
export default function Narration({ text }) {
  const t = String(text || '').trim();
  if (!t) return null;
  const short = t.length <= 160 && !t.includes('\n');
  return <p className={short ? 'jx-narr jx-hand-display' : 'jx-narr jx-hand'}>{t}</p>;
}
