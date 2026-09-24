import { useEffect, useRef } from 'react';
import { mount } from '../../ui/web/console/chat/mount.js';

/**
 * PHASE 24 SCOPE B — LEGACY ChatWindow DEPRECATED.
 *
 * The pre-Phase-24 rendering (TeamLive / ComputerPanel / MissionInlineCard /
 * framer-motion surfaces) is REMOVED. It lives in git history (main @
 * 6db21f3, src/components/ChatWindow.jsx) and is no longer mounted anywhere.
 *
 * This component is now a thin wrapper that mounts the Phase 24 chat
 * surface (ui/web/console/chat/mount.js), which consumes the Phase 16
 * runtime as a library. Unmounts cleanly on cleanup.
 */
export default function ChatWindow({ sessionId = 'console-main', backendUrl = '/api/health' }) {
  const ref = useRef(null);

  useEffect(() => {
    const handle = mount(ref.current, { sessionId, backendUrl });
    return () => handle.unmount();
  }, [sessionId, backendUrl]);

  return <div className="p24-chatwindow" ref={ref} style={{ height: '100%', minHeight: 0 }} />;
}
