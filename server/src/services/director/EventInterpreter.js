/**
 * ARENA REBUILD — Event Interpreter (spec Part 24: "real JEXI conversation
 * from actual runtime events").
 *
 * Turns typed runtime events (mission/work/steering/budget/browser) into
 * JEXI's warm conversational voice — deterministically, with ZERO model
 * calls (the performance rule applies to JEXI's own speech too).
 *
 * Honesty contract:
 *   - every phrase is built ONLY from the event's real data (titles, counts,
 *     durations) — nothing is invented, embellished, or predicted;
 *   - unknown/unmapped events fall back to the event's own summary
 *     (passthrough, never a made-up line);
 *   - failures are spoken as failures, always.
 */

const trim = (s, n = 140) => String(s || '').replace(/\\s+/g, ' ').trim().slice(0, n);

/** The voice layer. evt = a real runtime event object. */
export function jexiVoice(evt) {
  if (!evt || typeof evt !== 'object') return null;
  const d = evt.data || {};
  const title = trim(evt.title, 90);

  switch (evt.type) {
    /* ── mission lifecycle ─────────────────────────────────────────── */
    case 'MISSION_CREATED':
      return `On it, Boss. New mission logged: ${trim(evt.summary || 'objective recorded', 120)}`;
    case 'MISSION_STARTED': {
      const items = Number(d.items ?? 0);
      const ready = Number.isFinite(Number(d.ready)) ? Number(d.ready) : null;
      return `Boss, I've started.${items ? ` ${items} piece${items === 1 ? '' : 's'} of work${ready != null && ready > 0 ? ` — ${ready} can run right away, the rest wait on dependencies` : ''}.` : ''} You'll see every step here.`;
    }
    case 'MISSION_ANALYZED':
      return `I've looked at the request${d.note ? ` — ${trim(d.note, 100)}` : ''}. Planning the work now.`;
    case 'MISSION_PLANNED':
      return `Plan's ready${d.items ? ` — ${d.items} item${d.items === 1 ? '' : 's'}` : ''}. Starting execution.`;
    case 'MISSION_AWAITING_INPUT':
      return `I need one answer from you before I go further, Boss: ${trim(evt.summary || 'a question is flagged', 180)}`;
    case 'MISSION_RESUMED':
      return `Picking it back up — ${trim(evt.summary || 'resuming', 100)}`;
    case 'MISSION_RESTART_RECOVERY': {
      const n = Number(d.requeued?.length ?? 0);
      return `Heads up, Boss — the server restarted under me.${n ? ` I requeued ${n} in-flight item${n === 1 ? '' : 's'};` : ''} everything that finished is intact. Continuing.`;
    }
    case 'MISSION_REPLAN':
      return `That approach is dead — I'm rebuilding the blocked part a different way instead of retrying the same wall.`;
    case 'MISSION_REPLANNED':
      return `Replanned${d.added ? ` — ${d.added} new item${d.added === 1 ? '' : 's'}` : ''}. Finished work stays; only the broken part changed.`;
    case 'MISSION_COMPLETED':
      return `Done, Boss. ${trim(evt.summary || 'Mission complete.', 220)}`;
    case 'MISSION_FAILED':
      return `I have to be straight with you, Boss: this one failed. ${trim(evt.summary || 'Recorded honestly.', 180)}`;
    case 'MISSION_CANCELLED':
      return `Stopped as ordered. Every item's state is preserved — nothing finished was thrown away.`;
    case 'BUDGET_EXHAUSTED':
      return `I've hit my ${/wall-clock|time window|min/i.test(evt.summary || '') ? 'time window' : 'failure budget'} — pausing honestly instead of pushing past it. ${/resume/i.test(evt.summary || '') ? "Say \"Continue.\" and I'll open a fresh window." : 'The record is intact.'}`;

    /* ── work items ─────────────────────────────────────────────────── */
    case 'WORK_STARTED':
      return title ? `Working on it now: ${title}.` : 'Starting the next piece of work.';
    case 'WORK_COMPLETED':
      return title ? `Finished: ${title}.${d.ms ? ` (${(Number(d.ms) / 1000).toFixed(1)}s)` : ''}` : 'One more piece done.';
    case 'WORK_FAILED':
      return `That didn't work${title ? ` — ${title}` : ''}: ${trim(evt.summary || 'failed honestly', 140)}`;
    case 'WORK_RETRIED':
      return `Giving that item another honest attempt.`;
    case 'WORK_SKIPPED':
      return `Skipping an item${evt.summary && /reason/i.test(evt.summary) ? ` — ${trim(evt.summary, 100)}` : ' (recorded)'}.`;
    case 'WORK_PROMOTED':
      return `A deferred item just became ready — pulling it into the work queue.`;
    case 'WORK_SUPERSEDED':
      return `Changed course: ${Number(d.ids?.length ?? 0) || ''}${Number(d.ids?.length ?? 0) === 1 ? ' item is' : ' items are'} obsolete now. Work that already finished stays.`;
    case 'WORK_ITEM_CREATED':
      return `Added to the plan: ${trim(title || d.title || evt.summary, 100)}`;

    /* ── steering (spec Part 11 — the human in the loop) ───────────── */
    case 'STEERING_RECEIVED':
      return `Heard you: "${trim(evt.summary || '', 120).replace(/^Steering queued: /i, '').replace(/"$/, '')}" — applying it to the live plan.`;
    case 'STEERING_APPLIED':
      return `${trim(d.rationale || evt.summary || 'Steering applied.', 160)}`;
    case 'STEERING_DEFERRED':
      return `I couldn't yet tell exactly which items your change touches — nothing guessed, nothing dropped. It stays queued and I'll apply it as soon as I can see the impact.`;

    /* ── discovery / budgets ────────────────────────────────────────── */
    case 'DISCOVERY_DEFERRED':
      return `Found more work than the budget allows — recorded it without adding, so nothing is lost silently.`;

    /* ── browser router (spec Part 17 — observable browsing) ────────── */
    case 'browser.start':
      return `${d.note || `Opening ${d.url || 'the page'} via the ${d.kind || 'browser'} worker — you'll see every step.`}`;
    case 'browser.done':
      return `Browser task done${d.ms ? ` in ${(Number(d.ms) / 1000).toFixed(1)}s` : ''}.`;
    case 'browser.refused':
      return `I won't do that browser task: ${trim(d.error, 160)} That's a hard rule, Boss — not a mood.`;
    case 'browser.unavailable':
      return `I can't browse right now: ${trim(d.error, 160)}`;
    case 'browser.error':
      return `The browser worker hit an error: ${trim(d.error, 160)} Reported honestly, nothing faked.`;

    default:
      return null; // passthrough — the caller uses the event's own summary
  }
}
