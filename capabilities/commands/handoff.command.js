/**
 * JEXI OS — COMMANDS — /handoff (Phase 7 G).
 *
 * Writes STATE.md for the next agent from the REAL runtime state:
 *   Now          — HUD one-line + active mission
 *   Just landed  — last 3 git commits of the working repo
 *   Next         — open todos / first incomplete plan step
 *   Open questions — risk signals + failing checks
 *   Watch out    — HUD risk level + stale pending tool calls
 */

import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { stateFilePath, hudSnapshot, gitBrief, serverMod, clampText } from './_context.js';

function nowLine(hud, git) {
  const bits = [];
  if (hud?.revision != null) bits.push(`hud rev ${hud.revision}`);
  if (hud?.cost?.sessionUsd != null) bits.push(`session $${hud.cost.sessionUsd.toFixed?.(6) ?? hud.cost.sessionUsd}`);
  if (hud?.risk?.level) bits.push(`risk ${hud.risk.level}`);
  return bits.length ? bits.join(' · ') : (git.sha ? `last commit ${git.sha}` : 'runtime idle');
}

export default {
  name: 'handoff',
  aliases: [],
  description: 'Write STATE.md (Now / Just landed / Next / Open questions / Watch out) for the next agent',
  category: 'relay',
  args: [
    { name: 'out', required: false, type: 'path', default: '', description: 'override the STATE.md path (default: <DATA_DIR>/handoff/STATE.md)' },
    { name: 'note', required: false, type: 'string', default: '', description: 'a free-text note to embed under Now' },
  ],
  async handler(args, ctx) {
    const hudRaw = ctx.hud || await hudSnapshot();
    const hud = hudRaw?.payload || hudRaw; // snapshot() returns {payload,…} or a raw payload
    const git = gitBrief(process.cwd());

    // Next: todos first, then plan
    let next = [];
    try {
      const T = await serverMod('src/services/TodoStore.js');
      const todos = T?.todoList?.() || [];
      next = todos.filter((t) => !t.done).slice(0, 5).map((t) => (typeof t === 'string' ? t : t.text || t.title || String(t)));
    } catch { /* todos optional */ }
    if (!next.length) {
      try {
        const P = await serverMod('src/services/PlanStore.js');
        const plan = P?.planGet?.();
        const open = (plan?.steps || []).filter((s) => s.status !== 'completed' && s.status !== 'done');
        next = open.slice(0, 5).map((s) => `${s.text || s.title || s.description || 'plan step'} (plan: ${plan?.title || 'active'})`);
      } catch { /* plan optional */ }
    }
    if (!next.length) next.push('(nothing queued — pick the next mission from the backlog)');

    // Watch out: risk + failing checks + pending calls
    const watch = [];
    if (hud?.risk?.level && hud.risk.level !== 'normal') watch.push(`risk level: ${hud.risk.level}${hud.risk.reasons?.length ? ` (${hud.risk.reasons.join('; ')})` : ''}`);
    const failedChecks = Object.entries(hud?.checks || {}).filter(([, v]) => v && v.status === 'fail');
    for (const [k, v] of failedChecks.slice(0, 3)) watch.push(`failing check: ${k} — ${clampText(v.detail || '', 80)}`);
    const stale = (hud?.toolCalls?.pending || []).length;
    if (stale) watch.push(`${stale} tool call(s) pending`);
    if (!watch.length) watch.push('(nothing — clean state)');

    // Open questions: active mission + note
    const open = [];
    if (args.note) open.push(String(args.note));
    try {
      const M = await serverMod('src/services/director/Mission.js');
      const running = (M?.listMissions?.(null, 20) || []).find((m) => m.state === 'running');
      if (running) open.push(`mission ${running.id} still running: ${clampText(running.goal || running.objective || '', 120)}`);
    } catch { /* missions optional */ }
    if (!open.length) open.push('(none recorded)');

    const file = args.out ? path.resolve(String(args.out)) : await stateFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });

    const md = [
      `# STATE.md — JEXI handoff`,
      ``,
      `_written ${new Date().toISOString()} by /handoff (agent: ${ctx.agent.name}, session: ${ctx.session.id || 'n/a'})_`,
      ``,
      `## Now`,
      nowLine(hud, git),
      args.note ? `- note: ${args.note}` : '',
      git.sha ? `- repo: ${git.branch} @ ${git.sha} — ${git.subject}` : '',
      ``,
      `## Just landed`,
      git.subject ? gitBriefCommits().join('\n') : '(git context unavailable)',
      ``,
      `## Next`,
      ...next.map((n) => `- ${n}`),
      ``,
      `## Open questions`,
      ...open.map((o) => `- ${o}`),
      ``,
      `## Watch out`,
      ...watch.map((w) => `- ${w}`),
      ``,
    ].filter((l) => l !== '').join('\n');

    fs.writeFileSync(file, md, 'utf8');

    return {
      ok: true,
      summary: `STATE.md written → ${file} (Next: ${next.length} item(s), Watch out: ${watch[0].startsWith('(') ? 'clean' : `${watch.length} item(s)`})`,
      path: file,
      sections: { now: true, justLanded: !!git.sha, next: next.length, openQuestions: open.length, watchOut: watch.length },
    };
  },
};

function gitBriefCommits() {
  try {
    return execFileSync('git', ['log', '-3', '--pretty=- %h %s'], { cwd: process.cwd(), timeout: 4000 }).toString().trim().split('\n');
  } catch { return ['- (git log unavailable)']; }
}
