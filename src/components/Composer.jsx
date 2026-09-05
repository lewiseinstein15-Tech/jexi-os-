import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Send, Square } from 'lucide-react';

/**
 * B195 — COMPOSER (isolated, real-app behavior).
 *
 * Owns its draft text so every keystroke re-renders ONLY this small
 * component — the message list never re-renders while typing (that was the
 * phone "weird/laggy typing" bug: a long conversation re-rendered per letter).
 *
 * Real-app behaviors:
 *  - You can KEEP TYPING while she answers (input never dies).
 *  - Enter sends; Shift+Enter new-lines; autosizes 1→5 rows.
 *  - Send while she's busy → the message QUEUES and fires the moment the
 *    current turn ends (WhatsApp/ChatGPT feel), with a small "queued" chip.
 *  - Stop button always available while processing.
 *  - Double-tap guard (300ms) — no accidental double-sends on touch.
 *  - Keyboard-aware: rides above the virtual keyboard on overlay-keyboard
 *    browsers via the visual-viewport listener.
 */
/*
 * B225 — VOICE INPUT: the user's own browser is the microphone. The system
 * runs no local mic daemon (documented limitation), so speech capture rides
 * the Web Speech API — zero keys, zero server cost, free tier forever.
 * Feature-detected: a browser without a speech engine renders NO mic button
 * (absence is honest — never a dead button). WebView-based Android shells
 * (the APK) lack SpeechRecognition → no button there either, honestly.
 */
const SpeechRecognitionCtor = typeof window !== 'undefined'
  && (window.SpeechRecognition || window.webkitSpeechRecognition) ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

function Composer({ isProcessing, onSendText, onStop }) {
  const [text, setText] = useState('');
  const [queued, setQueued] = useState(null); // queued message while busy
  const [listening, setListening] = useState(false);
  const [micNote, setMicNote] = useState(null); // honest error surfaced, never swallowed
  const lastSend = useRef(0);
  const taRef = useRef(null);
  const recRef = useRef(null);
  const baseTextRef = useRef(''); // draft when listening started

  const autosize = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(120, el.scrollHeight)}px`;
  }, []);

  const stopMic = useCallback(() => {
    try { recRef.current && recRef.current.stop(); } catch { /* already stopped */ }
    setListening(false);
  }, []);

  const toggleMic = useCallback(() => {
    if (listening) { stopMic(); return; }
    if (!SpeechRecognitionCtor) return; // unreachable: button is not rendered
    const rec = new SpeechRecognitionCtor();
    rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    baseTextRef.current = text;
    rec.onresult = (ev) => {
      let finalText = '';
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      const base = baseTextRef.current;
      setText(`${base ? `${base} ` : ''}${finalText}${interim}`.trimStart());
      autosize();
    };
    rec.onerror = (ev) => {
      const honest = ev.error === 'not-allowed' || ev.error === 'service-not-allowed'
        ? 'Microphone blocked — allow mic access in the browser settings.'
        : ev.error === 'no-speech'
          ? 'Nothing heard — tap the mic and try again.'
          : `Voice input error: ${ev.error}`;
      setMicNote(honest);
      setTimeout(() => setMicNote(null), 4000);
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    try { rec.start(); setListening(true); setMicNote(null); }
    catch { setMicNote('Could not start the microphone.'); }
  }, [listening, stopMic, text, autosize]);

  // never leave a recognizer running after unmount
  useEffect(() => () => { try { recRef.current && recRef.current.stop(); } catch { /* gone */ } }, []);


  // fire the queued message the moment she finishes
  useEffect(() => {
    if (!isProcessing && queued !== null) {
      const q = queued;
      setQueued(null);
      onSendText(q);
    }
  }, [isProcessing, queued, onSendText]);

  // keyboard guard (overlay keyboards: mobile Chrome/Samsung/Brave)
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return undefined;
    const onVV = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb', kb > 40 ? `${Math.round(kb)}px` : '0px');
    };
    vv.addEventListener('resize', onVV);
    vv.addEventListener('scroll', onVV);
    return () => { vv.removeEventListener('resize', onVV); vv.removeEventListener('scroll', onVV); };
  }, []);

  const submit = useCallback(() => {
    const now = Date.now();
    if (now - lastSend.current < 300) return; // double-tap guard
    const t = text.trim();
    if (!t) return;
    lastSend.current = now;
    if (isProcessing) { setQueued(t); setText(''); requestAnimationFrame(() => { if (taRef.current) taRef.current.style.height = 'auto'; }); return; }
    setText('');
    requestAnimationFrame(() => {
      if (taRef.current) taRef.current.style.height = 'auto';
      // keep the keyboard OPEN between messages (real chat apps do) — only
      // blur on small screens if the user tapped elsewhere; do nothing here.
    });
    onSendText(t);
  }, [text, isProcessing, onSendText]);

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  const canSend = text.trim().length > 0;

  return (
    <div className="jx-composerwrap">
      {micNote && <div className="jx-micnote" role="status">{micNote}</div>}
      {queued !== null && (
        <div className="jx-queued">
          <span className="qdot" /> queued: “{queued.length > 40 ? `${queued.slice(0, 40)}…` : queued}” — sends when I finish
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="jx-bar" style={{ marginBottom: 0 }}>
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          onChange={(e) => { setText(e.target.value); autosize(); }}
          onKeyDown={onKeyDown}
          placeholder={isProcessing ? 'Type your next message…' : 'Message JEXI…'}
          className="jx-input"
          enterKeyHint="send"
          autoComplete="off"
        />
        {SpeechRecognitionCtor && (
          <button
            type="button"
            onClick={toggleMic}
            className={listening ? 'jx-sendbtn mic live' : 'jx-sendbtn mic'}
            title={listening ? 'Stop voice input' : 'Voice input'}
            aria-label={listening ? 'Stop voice input' : 'Voice input'}
            aria-pressed={listening}
          >
            <Mic size={15} />
          </button>
        )}
        {isProcessing && (
          <button type="button" onClick={onStop} className="jx-sendbtn stop" title="Stop" aria-label="Stop">
            <Square size={15} />
          </button>
        )}
        <button type="submit" disabled={!canSend} className="jx-sendbtn" title={queued !== null ? 'Queued' : 'Send'} aria-label="Send">
          <Send size={15} />
        </button>
      </form>
    </div>
  );
}

export default memo(Composer);
