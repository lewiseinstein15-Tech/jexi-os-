// Phase 11 Scope C — crash recovery: checkpoint + events journal.
//
// Cache layout (documented in README.md):
//   <cacheRoot>/state.json         — last checkpoint (atomic tmp+rename)
//   <cacheRoot>/events.journal     — append-only JSONL event log
//   <cacheRoot>/daemon.json        — live endpoint file (removed on clean stop)
//   <cacheRoot>/logs/daemon.log    — lifecycle log
//
// Recovery on daemon start:
//   1. load checkpoint (jobs + seq watermark)
//   2. replay journal events after the watermark
//   3. jobs found in `running|queued` are marked `interrupted`; a still-live
//      worker pid recorded in the journal is verified (argv must be
//      phase11-index.mjs) and SIGKILLed (stale-worker reclaim)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export class Journal {
  constructor(cacheRoot) {
    this.file = path.join(cacheRoot, 'events.journal');
    this.seq = 0;
    if (fs.existsSync(this.file)) {
      for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { this.seq = Math.max(this.seq, JSON.parse(line).seq); } catch { /* torn last line after crash — ignored by design */ }
      }
    }
  }

  append(type, data = {}) {
    const ev = { seq: ++this.seq, ts: new Date().toISOString(), type, ...data };
    fs.appendFileSync(this.file, JSON.stringify(ev) + '\n');
    return ev;
  }

  /** Events with seq > watermark, parsed. A torn trailing line is skipped. */
  after(watermark) {
    if (!fs.existsSync(this.file)) return [];
    const out = [];
    for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.seq > watermark) out.push(ev);
      } catch { /* torn line */ }
    }
    return out;
  }
}

export class Checkpoint {
  constructor(cacheRoot) {
    this.file = path.join(cacheRoot, 'state.json');
  }

  save(state) {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
    fs.renameSync(tmp, this.file);
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return null;
    }
  }
}

export function cacheLayout(cacheRoot) {
  return {
    cacheRoot,
    endpoint: path.join(cacheRoot, 'daemon.json'),
    checkpoint: path.join(cacheRoot, 'state.json'),
    journal: path.join(cacheRoot, 'events.journal'),
    logs: path.join(cacheRoot, 'logs'),
  };
}

/** Kill a stale index worker left behind by a crashed daemon (pid + argv check). */
export function reclaimStaleWorker(pid) {
  if (!pid || pid === process.pid) return { reclaimed: false, reason: 'no pid' };
  try {
    process.kill(pid, 0); // alive?
  } catch {
    return { reclaimed: false, reason: `pid ${pid} already gone` };
  }
  let argv = '';
  try {
    // /proc first (no external dependency); ps fallback.
    try {
      argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
    } catch {
      argv = execFileSync('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8' }).trim();
    }
    if (!argv.includes('phase11-index.mjs')) {
      return { reclaimed: false, reason: `pid ${pid} is not an index worker: ${argv.slice(0, 80)}` };
    }
    process.kill(pid, 'SIGKILL');
    return { reclaimed: true, pid, argv: argv.slice(0, 100) };
  } catch (err) {
    return { reclaimed: false, reason: `kill failed: ${err.message}` };
  }
}

/**
 * Full recovery pass. Returns the recovered state + what the journal replay did.
 * Sessions are NOT resurrected (their TCP connections died with the crash);
 * the journal keeps their history for audit, and clients re-register.
 */
export function recover(cacheRoot, log = () => {}) {
  const ck = new Checkpoint(cacheRoot);
  const journal = new Journal(cacheRoot);
  const state = ck.load() || { jobs: {}, watchers: {}, seq: 0 };
  const replay = journal.after(state.seq ?? 0);

  for (const ev of replay) {
    if (ev.type === 'job-started' && ev.job) state.jobs[ev.job.id] = { ...ev.job, status: 'running' };
    if (ev.type === 'job-completed' && ev.jobId && state.jobs[ev.jobId]) {
      state.jobs[ev.jobId] = { ...state.jobs[ev.jobId], status: 'completed', stats: ev.stats || null };
    }
    if (ev.type === 'job-cancelled' && ev.jobId && state.jobs[ev.jobId]) {
      state.jobs[ev.jobId] = { ...state.jobs[ev.jobId], status: 'cancelled' };
    }
    if (ev.type === 'watcher-registered' && ev.watcher) state.watchers[ev.watcher.id] = ev.watcher;
    if (ev.type === 'watcher-stopped' && ev.watcherId && state.watchers[ev.watcherId]) {
      delete state.watchers[ev.watcherId];
    }
    state.seq = ev.seq;
  }

  const interrupted = [];
  const reclaims = [];
  for (const job of Object.values(state.jobs)) {
    if (job.status === 'running' || job.status === 'queued') {
      job.status = 'interrupted';
      interrupted.push(job.id);
      const r = reclaimStaleWorker(job.pid);
      r.reclaimed && reclaims.push(r);
    }
  }

  log(`recovery: checkpoint seq=${state.seq ?? 0}, replayed ${replay.length} journal event(s), interrupted ${interrupted.length} job(s), reclaimed ${reclaims.length} stale worker(s)`);
  return { state, replay, interrupted, reclaims };
}
