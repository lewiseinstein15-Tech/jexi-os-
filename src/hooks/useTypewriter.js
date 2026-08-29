import { useState, useEffect, useRef } from 'react';

/**
 * Reveals text progressively (typewriter effect) for finished JEXI messages.
 * Typing speed scales with length so a reply takes ~2-4s; very long answers
 * appear instantly so they never feel tedious.
 *
 * Streaming-safety fix: when the text GROWS from what is already shown
 * (live deltas appended to the same message), the growth is adopted
 * instantly instead of restarting the typewriter from zero. Restarting made
 * every delta re-flow the whole message — which, combined with auto-scroll,
 * made long answers impossible to read or scroll.
 */
export function useTypewriter(text, { baseSpeed = 16 } = {}) {
  const [out, setOut] = useState('');
  const shownRef = useRef(''); // what is currently revealed

  useEffect(() => {
    if (text == null) { shownRef.current = ''; setOut(''); return; }
    if (text.length > 5000) { shownRef.current = text; setOut(text); return; } // monster answers: instant

    const shown = shownRef.current;
    // Streaming append: new text extends what's already on screen → adopt it
    // in full, no restart.
    if (shown && text.length > shown.length && text.startsWith(shown)) {
      shownRef.current = text;
      setOut(text);
      return;
    }

    shownRef.current = '';
    setOut('');
    // B174 — LINE-CHUNKED reveal: finished answers appear one whole line at a
    // time (fast cadence, same ~2-4s feel) so a formula is NEVER sliced
    // mid-LaTeX — char-by-char typing showed "\frac{\te…" garbage while
    // racing the reveal. Lines land complete and render as real math.
    const lineEnds = [];
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lineEnds.push(i + 1);
    lineEnds.push(text.length);
    const linesPerTick = Math.max(1, Math.round(lineEnds.length / 45));
    let li = 0;
    const id = setInterval(() => {
      li = Math.min(lineEnds.length, li + linesPerTick);
      const value = text.slice(0, lineEnds[li - 1] || text.length);
      shownRef.current = value;
      setOut(value);
      if (li >= lineEnds.length) clearInterval(id);
    }, Math.max(baseSpeed, 45));
    return () => clearInterval(id);
  }, [text, baseSpeed]);

  return out;
}
