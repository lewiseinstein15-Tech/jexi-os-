import { useHud } from '../ConsoleApp';

/* <ToolCalls /> — Phase 7(F): renders ONLY hud.toolCalls — the real
   recorded calls (name, status, durationMs, at) from the kernel executor
   seam, plus pending/stale counters. No local-bus echo anymore: the HUD
   is the single source of truth. Absent section = honest "no data". */
export default function ToolCalls() {
  const { hud } = useHud();
  const toolCalls = hud?.toolCalls ?? null;

  if (!toolCalls) {
    return (
      <>
        <div className="ph" style={{ marginTop: 16 }}>
          <h3>Recent Tool Calls</h3>
          <div className="rule" />
          <span className="meta">hud.toolCalls</span>
        </div>
        <div style={{ border: '1px solid var(--jcx-line)', borderRadius: 10, background: 'var(--jcx-panel)', overflow: 'hidden' }}>
          <div className="empty" style={{ margin: 10 }}>no data — the payload carries no toolCalls section</div>
        </div>
      </>
    );
  }

  const statusTone = { ok: 'var(--jcx-up)', fail: 'var(--jcx-down)', blocked: 'var(--jcx-gold)' };
  const rows = toolCalls.recent || [];

  return (
    <>
      <div className="ph" style={{ marginTop: 16 }}>
        <h3>Recent Tool Calls</h3>
        <div className="rule" />
        <span className="meta">{rows.length} recorded · {toolCalls.pending} pending · {toolCalls.stale} stale</span>
      </div>
      <div style={{ border: '1px solid var(--jcx-line)', borderRadius: 10, background: 'var(--jcx-panel)', overflow: 'hidden' }}>
        {rows.length === 0 && (
          <div className="empty" style={{ margin: 10 }}>no tool calls recorded yet — they appear the moment the kernel executes one</div>
        )}
        {rows.map((c, i) => (
          <div className="tool" key={`${c.at}-${c.name}-${i}`}>
            <span className="sdot s" style={{ background: statusTone[c.status] || 'var(--jcx-ink-3)' }} />
            <span className="tn">{c.name}</span>
            <span className="ta">{c.status} · {c.durationMs}ms</span>
            <span className="td">{String(c.at || '').slice(11, 19)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
