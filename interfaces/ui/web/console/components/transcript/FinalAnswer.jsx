/**
 * components/transcript/FinalAnswer.jsx (ui-rebuild-premium-v2)
 *
 * The answer block. One real row (the merged 'stream' NDJSON deltas) renders
 * in two states:
 *   - streaming: growing text + blinking accent cursor (token-by-token, live)
 *   - completed: the final answer — coral left border, Inter prose for
 *     paragraphs, JetBrains Mono for fenced code blocks
 *
 * Mini-markdown, honest scope: fenced code blocks + paragraph breaks are
 * rendered live as they stream; nothing else is reinterpreted. The raw text
 * is exactly what the backend streamed.
 */

function renderSegments(content) {
  const parts = String(content || '').split(/```/);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      // fenced code — first line may be a language tag
      const lines = part.split('\n');
      if (lines.length > 1 && /^[a-zA-Z0-9_-]{0,20}$/.test(lines[0].trim())) lines.shift();
      return (
        <pre key={i} className="jx-answer-code"><code>{lines.join('\n')}</code></pre>
      );
    }
    const paras = part.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    return paras.map((p, j) => (
      <p key={`${i}-${j}`} className="jx-answer-para jx-prose">{p}</p>
    ));
  });
}

export default function FinalAnswer({ content, streaming }) {
  if (!content) return null;
  return (
    <div className={'jx-answer' + (streaming ? ' is-streaming' : ' is-final')}>
      {renderSegments(content)}
      {streaming ? <span className="jx-cursor" aria-hidden="true" /> : null}
    </div>
  );
}
