import { useState } from 'react';
import { Terminal, Search, Pencil, Loader2, Check, X, ChevronDown } from 'lucide-react';

/**
 * StepRow — ONE tool call as a single transcript line (Claude Code style):
 *
 *   [icon] used <Tool> [hint]   ✓/spinner/X   180ms        ⌄
 *
 * No card, no bubble, no border, no background — the row sits directly in
 * the transcript flow with only its own horizontal layout. Click (or the
 * chevron) expands the raw command + full output underneath.
 *
 * Props: { tool, label, status, durationMs, detail }
 *   tool: 'Bash' | 'Read' | 'Edit' (picks the icon)
 *   label: collapsed one-line label, e.g. "used Bash · npm test"
 *   status: 'running' | 'success' | 'error'
 *   durationMs: number — shown after the status icon
 *   detail: raw command + full output, revealed on expand
 */
export function formatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1000) return `${Math.round(n)}ms`;
  if (n < 60000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.floor(n / 60000)}m ${Math.round((n % 60000) / 1000)}s`;
}

const ICONS = { Bash: Terminal, Read: Search, Edit: Pencil };

export default function StepRow({ tool, label, status, durationMs, detail }) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS[tool] || Search;
  const dur = formatDuration(durationMs);

  return (
    <div className="jx-step">
      <button
        type="button"
        className="jx-step-line"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={open ? 'Collapse output' : 'Expand raw command + output'}
      >
        <span className="jx-step-ic" aria-hidden="true">
          <Icon size={14} strokeWidth={2} />
        </span>
        <span className="jx-step-label jx-hand">{label || `used ${tool || 'tool'}`}</span>
        <span className="jx-step-status" aria-label={status}>
          {status === 'running' && <Loader2 size={13} strokeWidth={2.4} className="jx-spin" />}
          {status === 'success' && <Check size={14} strokeWidth={2.6} className="jx-ok" />}
          {status === 'error' && <X size={14} strokeWidth={2.6} className="jx-err" />}
        </span>
        {dur && <span className="jx-step-dur">{dur}</span>}
        <span className={`jx-step-chev${open ? ' open' : ''}`} aria-hidden="true">
          <ChevronDown size={14} strokeWidth={2.2} />
        </span>
      </button>
      {open && detail != null && String(detail).trim() !== '' && (
        <pre className="jx-step-detail">{String(detail).slice(0, 6000)}</pre>
      )}
    </div>
  );
}

/**
 * foldTrace — group CONSECUTIVE completed same-tool steps into ONE summary
 * row ("Ran 3 commands", "Explored 2 reads"). Running rows never fold (the
 * live spinner must stay visible). Grouping is a pure view derivation over
 * the ordered event trace, so the live stream stays one-event-at-a-time.
 */
const GROUP_LABEL = {
  Bash: (n) => `Ran ${n} command${n === 1 ? '' : 's'}`,
  Read: (n) => `Explored ${n} read${n === 1 ? '' : 's'}`,
  Edit: (n) => `Edited ${n} file${n === 1 ? '' : 's'}`,
};

export function foldTrace(trace) {
  const out = [];
  let i = 0;
  while (i < trace.length) {
    const e = trace[i];
    if (e && e.kind === 'step' && e.status !== 'running') {
      let j = i + 1;
      while (
        j < trace.length &&
        trace[j] && trace[j].kind === 'step' &&
        trace[j].status !== 'running' &&
        trace[j].tool === e.tool
      ) j++;
      const run = trace.slice(i, j);
      if (run.length >= 2) {
        const failed = run.filter((r) => r.status === 'error').length;
        const totalMs = run.reduce((a, r) => a + (Number(r.durationMs) || 0), 0);
        const detail = run
          .map((r) => `— ${r.label || r.tool}\n${String(r.detail || '').slice(0, 2000)}`)
          .join('\n\n')
          .slice(0, 6000);
        out.push({
          kind: 'step', group: true, tool: e.tool,
          label: (GROUP_LABEL[e.tool] || ((n) => `Used ${e.tool} ×${n}`))(run.length),
          status: failed > 0 ? 'error' : 'success',
          durationMs: totalMs, detail,
          key: run.map((r) => r.id).join('+'),
        });
        i = j;
        continue;
      }
    }
    out.push(e);
    i++;
  }
  return out;
}
