import { useEffect, useRef } from 'react';
import { mount } from '../chat/mount.js';
import { loadTranscript } from '../chat/sessions.js';

/**
 * shell/ChatView.jsx (ui-rebuild-premium-v2 BUG 3) — the chat route wrapper
 * that lives INSIDE the console zone (interfaces/ui/web/console/), replacing
 * the Shell's import of the legacy out-of-zone ChatWindow (interfaces/
 * console/components/ChatWindow.jsx — untouched on disk, still mounted
 * nowhere else it wasn't before).
 *
 * Same mount contract, one addition: a session switch remounts with that
 * session's localStorage snapshot (chat/sessions.js) seeded into the
 * transcript, so clicking a history entry restores the conversation — even
 * after a page reload. `key={sessionId}` at the call site forces the
 * remount; unmount flushes the final snapshot back to storage.
 */
export default function ChatView({ sessionId, backendUrl = '/api/health' }) {
  const ref = useRef(null);

  useEffect(() => {
    const handle = mount(ref.current, {
      sessionId,
      backendUrl,
      snapshotRows: loadTranscript(sessionId),
    });
    return () => handle.unmount();
  }, [sessionId, backendUrl]);

  return <div className="p24-chatwindow" ref={ref} style={{ height: '100%', minHeight: 0 }} />;
}
