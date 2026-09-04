import { motion } from 'framer-motion';

/**
 * JEXI CORE — the signature visual (spec §6).
 *
 * A single glowing node that visualizes what JEXI is doing right now:
 * - At rest: a plain conic ring, slowly rotating, dim brand glow.
 * - While working: the ring grows one segment per agent in the composed
 *   team, each pre-colored by that agent's identity color but dim/hollow
 *   (pending). As agents run, segments fill solid; the active segment
 *   pulses. On completion all segments flash and collapse back to idle.
 *
 * Segments are SVG circle arcs (strokeDasharray/offset), so the ring works
 * whether the team has 2 agents or 12.
 */

const AGENT_COLOR = {
  Planner: '#22D3EE',
  Architect: '#A78BFA',
  Product: '#FBBF24',
  Designer: '#F472B6',
  Engineer: '#A78BFA',
  Coder: '#00D26A',
  'QA Lead': '#FBBF24',
  Reviewer: '#A1A1AA',
  'Security Officer': '#FB7185',
  Shipper: '#FBBF24',
  Reflector: '#34D399',
  Runner: '#F472B6',
  Debugger: '#FB7185',
  'Memory Agent': '#F472B6',
  Reasoner: '#A78BFA',
  Searcher: '#22D3EE',
  Synthesizer: '#A78BFA',
  'Query Analyzer': '#22D3EE',
  Extractor: '#22D3EE',
  'Re-Ranker': '#A1A1AA',
  ReRanker: '#A1A1AA',
  Researcher: '#34D399',
  Scholar: '#34D399',
  'News Scout': '#34D399',
  'News Filter': '#FBBF24',
  'News Editor': '#34D399',
  Navigator: '#22D3EE',
  Vision: '#F472B6',
  'GitHub Agent': '#E4E4E7',
  'Data Analyst': '#22D3EE',
  'DevOps Agent': '#22D3EE',
  'Technical Writer': '#FBBF24',
  Translator: '#34D399',
  'Performance Engineer': '#FBBF24',
  'Fact Checker': '#A78BFA',
  Critic: '#A78BFA',
  'Self-Diagnose': '#FB7185',
  SelfDiagnose: '#FB7185',
  Books: '#FBBF24',
  'Computer Use Agent': '#34D399',
  JEXI: '#00D26A',
};
const FALLBACK_COLOR = '#A1A1AA';

export function coreColor(agentName) {
  return AGENT_COLOR[agentName] || FALLBACK_COLOR;
}

/**
 * Renders the orbital ring.
 * @param {number} size   rendered diameter (32 mini / 120 hero)
 * @param {string[]} roster ordered agent names in the composed team
 * @param {string} activeAgent current running agent (or null)
 * @param {boolean} running true while a task is in flight
 * @param {boolean} done true when the last run completed
 */
export default function JexiCore({ size = 32, roster = [], activeAgent = null, running = false, done = false }) {
  const team = (roster || []).filter(Boolean);
  const n = Math.max(team.length, 0);
  const idle = !running && !done;

  const stroke = Math.max(2.5, size * 0.09);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gap = n > 1 ? Math.min(4, c / n / 8) : 0;
  const segLen = n > 0 ? (c / n) - gap : 0;

  const activeIdx = team.indexOf(activeAgent);
  // Which segments have "run" (everything before the active one, plus the active).
  const runCount = activeIdx >= 0 ? activeIdx + 1 : n;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      {/* Soft brand glow behind the whole core */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(0,255,157,0.28), transparent 70%)',
          opacity: running ? 0.9 : done ? 0.5 : 0.35,
          transition: 'opacity 0.4s ease',
        }}
      />

      {/* Rotating conic ring (always present — the "breathing" baseline) */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background: 'conic-gradient(from 0deg, rgba(0,255,157,0.0), rgba(0,255,157,0.5), rgba(0,255,157,0.0) 60%)',
          WebkitMask: 'radial-gradient(circle, transparent 62%, #000 63%)',
          mask: 'radial-gradient(circle, transparent 62%, #000 63%)',
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
      />

      {/* Segment arcs — one per agent in the team */}
      {n > 0 && (
        <svg width={size} height={size} className="absolute inset-0">
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {team.map((name, i) => {
              const color = coreColor(name);
              const isActive = running && i === activeIdx;
              const hasRun = running ? i <= activeIdx : done ? true : false;
              return (
                <motion.circle
                  key={name + i}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={color}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  strokeDasharray={`${isActive ? segLen * 0.55 : segLen} ${c - (isActive ? segLen * 0.55 : segLen)}`}
                  strokeDashoffset={-i * (segLen + gap)}
                  initial={false}
                  animate={{
                    opacity: isActive ? 1 : hasRun ? 0.95 : 0.28,
                    filter: isActive ? 'drop-shadow(0 0 4px ' + color + ')' : 'none',
                  }}
                  transition={{ duration: 0.25 }}
                />
              );
            })}
          </g>
        </svg>
      )}

      {/* Center disc — dark with the JEXI mark */}
      <div
        className="relative rounded-full flex items-center justify-center"
        style={{
          width: size * 0.52,
          height: size * 0.52,
          background: 'radial-gradient(circle at 35% 30%, #1a1a20, #0b0b10 70%)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: running ? `0 0 ${size * 0.3}px rgba(0,255,157,0.35)` : done ? `0 0 ${size * 0.2}px rgba(0,255,157,0.2)` : 'none',
          transition: 'box-shadow 0.4s ease',
        }}
      >
        {running ? (
          <span className="flex gap-[2px]">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="rounded-full bg-brand"
                style={{
                  width: Math.max(2, size * 0.07),
                  height: Math.max(2, size * 0.07),
                  animation: `bounceDot 0.6s ease-in-out ${i * 0.15}s infinite`,
                }}
              />
            ))}
          </span>
        ) : done ? (
          <span className="text-brand" style={{ fontSize: size * 0.3, fontWeight: 700 }}>✓</span>
        ) : (
          <span
            className="rounded-full"
            style={{ width: Math.max(3, size * 0.1), height: Math.max(3, size * 0.1), background: '#00D26A', boxShadow: '0 0 6px rgba(0,210,106,0.5)' }}
          />
        )}
      </div>
    </div>
  );
}
