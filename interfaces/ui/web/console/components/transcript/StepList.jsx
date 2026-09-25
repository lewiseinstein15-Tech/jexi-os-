/**
 * components/transcript/StepList.jsx (ui-rebuild-premium-v2)
 *
 * Arena-style numbered step list with REAL state derivation:
 *   - plan steps (from the /api/chat 'plan' event, relayed through the
 *     decision narration) render as PENDING — they were announced by the
 *     planner, not executed yet.
 *   - progress/finding narration rows (from 'log' / 'narration' NDJSON
 *     events) render as COMPLETED — the pipeline logged them as happened.
 *   - the LAST executed step stays RUNNING while the turn streams.
 *   - a failed turn marks nothing retroactively: rows show what really
 *     happened; the turn footer carries the failure.
 *
 * States (visually distinct, per spec):
 *   pending  · muted, dotted      running ▸ accent pulse
 *   done     ✓ green, solid       failed ✗ danger        skipped — strikethrough
 */

function StepRow({ n, text, state, agent }) {
  const icon =
    state === 'done' ? '✓' :
    state === 'running' ? '▸' :
    state === 'failed' ? '✗' :
    state === 'skipped' ? '—' : '·';
  return (
    <div className={`jx-step is-${state}`}>
      <span className="jx-step-ic" aria-hidden="true">{icon}</span>
      <span className="jx-step-no jx-num">{String(n).padStart(2, '0')}</span>
      <span className="jx-step-text">
        {agent ? <span className="jx-step-agent">{agent}</span> : null}
        {text}
      </span>
    </div>
  );
}

export default function StepList({ planSteps = [], steps = [], streaming }) {
  if (!planSteps.length && !steps.length) return null;
  const lastIdx = streaming ? steps.length - 1 : -1;

  return (
    <div className="jx-steps">
      {steps.map((s, i) => (
        <StepRow key={`s${i}`} n={i + 1} text={s.text} agent={s.agent}
          state={i === lastIdx ? 'running' : (s.state || 'done')} />
      ))}
      {planSteps.map((p, i) => (
        <StepRow key={`p${i}`} n={steps.length + i + 1} text={p} state="pending" />
      ))}
    </div>
  );
}
