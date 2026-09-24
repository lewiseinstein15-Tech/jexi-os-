import { useMemo } from 'react';

/**
 * B208 — TEAM LIVE: the boss-and-employees strip above the chat.
 *
 *   JEXI (Director) → [Zola · Research] [Forge · Engineering] [Vera · Verification]
 *
 * Every card state is driven by REAL Director events only:
 *   standby → ready → working → delivered → verifying → verified → recovering
 * The employee name is primary; the model lane is secondary metadata (and
 * never a raw model id). The strip is layout-safe by construction (B207
 * lessons: max-width caps, min-width:0, ellipsis instead of nowrap blowouts).
 */

const STATUS_DOT = {
  standby: '#6b7280', ready: '#38bdf8', working: '#a78bfa', delivered: '#34d399',
  verifying: '#fbbf24', verified: '#10b981', recovering: '#f97316',
};
const STATUS_WORD = {
  standby: 'Standby', ready: 'Ready', working: 'Working', delivered: 'Delivered',
  verifying: 'Verifying', verified: 'Verified', recovering: 'Recovering',
};

function safeText(v, n) {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return s.slice(0, n);
}

export default function TeamLive({ team, live }) {
  const data = useMemo(() => {
    if (!team || !Array.isArray(team.employees) || !team.employees.length) return null;
    return {
      objective: safeText(team.objective, 96),
      active: Boolean(live && team.active !== false),
      employees: team.employees
        .filter((e) => e && e.agentId && e.agentId !== 'jexi')
        .map((e) => ({
          key: safeText(e.agentId, 32),
          name: safeText(e.name, 22) || safeText(e.agentId, 22),
          status: STATUS_WORD[e.status] ? e.status : 'standby',
          currentTask: safeText(e.currentTask, 90),
          provider: safeText(e.provider, 18),
        })),
    };
  }, [team, live]);

  if (!data) return null;

  return (
    <div className={`jx-team${data.active ? ' live' : ''}`} aria-label="JEXI's team">
      <div className="jx-team-boss">
        <span className={`jx-team-boss-dot${data.active ? ' pulse' : ''}`} aria-hidden="true" />
        <span className="jx-team-boss-name">JEXI</span>
        <span className="jx-team-boss-role">Director</span>
      </div>
      {data.objective ? <div className="jx-team-objective">{data.objective}</div> : null}
      <div className="jx-team-cards" role="list">
        {data.employees.map((e) => (
          <div className="jx-team-card" role="listitem" key={e.key}>
            <div className="jx-team-card-head">
              <span className="jx-team-dot" style={{ background: STATUS_DOT[e.status] || STATUS_DOT.standby }} aria-hidden="true" />
              <span className="jx-team-name">{e.name}</span>
              <span className="jx-team-status">{STATUS_WORD[e.status]}</span>
            </div>
            {e.currentTask ? <div className="jx-team-task">{e.currentTask}</div> : null}
            {e.provider ? <div className="jx-team-model">{e.provider} lane</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
