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
    const chunk = Math.max(2, Math.min(14, Math.floor(text.length / 110)));
    const id = setInterval(() => {
      setOut(prev => {
        const next = prev.length + chunk;
        const value = next >= text.length ? text : text.slice(0, next);
        shownRef.current = value;
        return value;
      });
    }, baseSpeed);
    return () => clearInterval(id);
  }, [text, baseSpeed]);

  return out;
}
