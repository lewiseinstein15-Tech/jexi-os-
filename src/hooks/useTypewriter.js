import { useState, useEffect } from 'react';

/**
 * Reveals text progressively (typewriter effect) for finished JEXI messages.
 * Typing speed scales with length so a reply takes ~2-4s; very long answers
 * appear instantly so they never feel tedious.
 */
export function useTypewriter(text, { baseSpeed = 16 } = {}) {
  const [out, setOut] = useState('');

  useEffect(() => {
    if (text == null) { setOut(''); return; }
    if (text.length > 5000) { setOut(text); return; } // instantly for monster answers
    setOut('');
    const chunk = Math.max(2, Math.min(14, Math.floor(text.length / 110)));
    const id = setInterval(() => {
      setOut(prev => {
        const next = prev.length + chunk;
        return next >= text.length ? text : text.slice(0, next);
      });
    }, baseSpeed);
    return () => clearInterval(id);
  }, [text, baseSpeed]);

  return out;
}
