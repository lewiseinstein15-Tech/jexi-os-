/**
 * B183 — TEAM ROUTER (Nova's dispatcher): routes REAL chat through the
 * B180 agent team. Sits in the chat pipeline before the heavy orchestrator:
 *   - coding / build requests      → Ada (dev) via the DSH coding loop
 *   - research / compare / news    → Kito (research) + Nova's synthesis
 *   - scheduling / recurring asks  → Tari (scheduler)
 *   - delivery / notify asks       → Zuri (comms)
 *   - everything else              → null (the normal pipeline stays)
 * Conservative: only fires on clear signals; unknown input passes through.
 */

import { scheduleJob, jobStatuses } from './AgentGateway.js';
import { loadProfile, rememberFor } from './AgentProfiles.js';
import { recallSkills } from './SkillLoop.js';

const DEV_RE = /\b(build|create|make|code|develop|implement|fix|debug|refactor|deploy)\b[^.?!]{0,60}\b(app|application|website|web ?app|api|server|backend|frontend|game|tool|script|site|system|cli|bot|program|calculator|dashboard|tracker|clone)\b/i;
const DEV_RE2 = /\b(fix|debug|refactor)\b[^.?!]{0,50}\b(bug|error|crash|page|component|function|code|test|file)\b/i; // 'fix the bug in my login page'
const RESEARCH_RE = /\b(research|compare|investigate|find out|latest|news|what('s| is) (new|happening)|sources? on|deep dive|analysis of|market|statistics|data on)\b/i;
const SCHEDULE_RE = /\b(every (morning|day|evening|hour|week|weekday)|daily|weekly|each day|every \d+ (minutes?|hours?)|at \d{1,2}(:\d{2})? ?(am|pm) (every|each)|remind me (every|daily|weekly)|run this (every|daily|weekly))\b/i;
const DELIVER_RE = /\b(send|email|deliver|notify|message me|ping me|push to github|open a pr|commit and push)\b/i;

/** → { team: 'dev'|'research'|'scheduler'|'comms', why } | null */
export function routeToTeam(query, plan = {}) {
  const q = String(query || '');
  if (SCHEDULE_RE.test(q)) return { team: 'scheduler', why: 'recurring/scheduled work detected' };
  if (/remind me|notify me/.test(q) && DELIVER_RE.test(q)) return { team: 'comms', why: 'delivery/reminder request' };
  // research wins over dev only when the dev signal is absent (compound
  // "research then build" goes to dev, which researches inside its loop)
  if (DEV_RE.test(q) || DEV_RE2.test(q) || plan.intent === 'code_task') return { team: 'dev', why: 'build/code request' };
  if (RESEARCH_RE.test(q) || plan.intent === 'research') return { team: 'research', why: 'research/analysis request' };
  return null;
}

/**
 * Handle a routed request with the named team. Returns the final summary
 * (already user-ready) or null to fall through to the normal pipeline.
 */
export async function runTeam(team, query, { sendEvent = () => {}, convId = null, plan = {} } = {}) {
  if (team === 'scheduler') {
    const { parseNaturalSchedule } = await import('./AgentGateway.js');
    const sched = parseNaturalSchedule(query);
    const agent = 'research';
    const { job, human } = scheduleJob({ agent, prompt: cleanPromptForSchedule(query), schedule: sched.human, deliver: { channel: 'file' }, origin: convId || 'chat' });
    rememberFor('scheduler', 'task', `scheduled ${human}: ${query.slice(0, 120)}`, { jobId: job.id });
    return `### ⏰ Scheduled — Tari\n\nDone: I'll run this **${human}** (next: ${new Date(job.nextRun).toLocaleString()}).\n\nThe job runs unattended — results land in your outbox and I'll report in chat. Check anytime: \`/agents\`.`;
  }

  if (team === 'dev') {
    const { runDshCoding } = await import('./DshCoding.js');
    const profile = loadProfile('dev');
    sendEvent('log', { agent: profile?.displayName || 'Ada', message: '🧑‍💻 Ada (Dev) taking this — build → run → fix loop.' });
    const skills = recallSkills('dev', query, { limit: 2 });
    if (skills.length) sendEvent('log', { agent: 'Ada', message: `📚 reusing ${skills.length} saved skill(s): ${skills.map((s) => s.name).join(', ')}.` });
    const built = await runDshCoding({
      goal: query,
      plan: '',
      sendEvent,
      owner: convId || 'dev-team',
    });
    if (built && built.files && built.files.length) {
      // B186 — surface a REAL preview link when the build is a web app
      const { WORKSPACE_DIR } = await import('../config.js');
      const { getBackendBase } = { getBackendBase: () => '' }; // relative link works on same origin
      const entry = built.files.find((f) => /^index\.html$/i.test(f.name)) || built.files.find((f) => /\.html$/i.test(f.name));
      const filesLine = built.files.slice(0, 8).map((f) => `\`${f.name}\``).join(', ') + (built.files.length > 8 ? ` +${built.files.length - 8} more` : '');
      // B188 — publish web builds to the SEPARATE workspace home (free Pages)
      // and hand the user a real PUBLIC link that works on any phone.
      let preview = '';
      if (entry) {
        try {
          const { publishProject } = await import('./WorkspacePublisher.js');
          sendEvent('log', { agent: 'Ada', message: '🚀 publishing to my workspace…' });
          const pub = await publishProject({
            name: slugFor(query),
            title: String(query).slice(0, 60),
            brief: String(query).slice(0, 160),
            files: built.files.map((f) => ({ name: f.name, code: f.code })),
            entry: entry.name,
          });
          preview = pub.ok
            ? `\n\n**🔗 Open it live (works on any device):** ${pub.url}\n*Also on my workspace home: ${pub.indexUrl} — auto-cleans when the project is done.*`
            : `\n\n**🔗 Live preview:** [Open ${entry.name}](/preview/${encodeURIComponent(entry.name)})`;
        } catch (e) {
          preview = `\n\n**🔗 Live preview:** [Open ${entry.name}](/preview/${encodeURIComponent(entry.name)})`;
        }
      } else {
        preview = '\n\n*Tip: ask for a web version (\'as a web app with index.html\') and I\'ll publish it to my workspace with a live public link.*';
      }
      return `### 🛠 Built by Ada (Dev)\n\n${built.summary || `${built.files.length} file(s) created and run.`}\n\n**Files:** ${filesLine}${preview}`;
    }
    return null; // loop produced nothing → fall back to the classic pipeline
  }

  if (team === 'research') {
    // Kito researches through the existing whole-internet research team; Nova
    // folds the result. (Keeps one research implementation — extends, not
    // duplicates.)
    return null; // the orchestrator's research node already runs Kito's lane
  }

  return null;
}

function cleanPromptForSchedule(q) {
  return String(q)
    .replace(/\b(every (morning|day|evening|hour|week|weekday)|daily|weekly|each day|remind me|run this|at \d{1,2}(:\d{2})? ?(am|pm)?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400) || 'the recurring task';
}

export function teamStatusLine() {
  const jobs = jobStatuses();
  const active = jobs.filter((j) => j.nextRun < Number.MAX_SAFE_INTEGER).length;
  return active;
}

function slugFor(q) {
  return String(q).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 5).join('-').slice(0, 40) || 'project';
}
