/**
 * Narration — the agent's own first-person words between tool calls.
 * A plain paragraph in the transcript flow: NO card, NO background,
 * NO border. Handwriting comes from the existing app-wide .jx-hand
 * class (var(--hand)) — no new font introduced.
 */
export default function Narration({ text }) {
  const t = String(text || '').trim();
  if (!t) return null;
  return <p className="jx-narr jx-hand">{t}</p>;
}
