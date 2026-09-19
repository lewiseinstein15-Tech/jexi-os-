// research/tracking/dual.js
// Keeps both trackers in sync (karpathy/autoresearch dual tracking): one call
// records the verdict in results.tsv (complete log) AND moves the git frontier
// (commits on keep, resets on discard/crash).
//
// results.tsv is kept UNTRACKED inside the experiment workspace (auto-written
// .git/info/exclude entry): the frontier's reset --hard must never rewrite
// history on the complete log — the TSV records everything, the branch only
// successful code states. Committed code is the frontier; the TSV is the
// sidecar ledger and survives every reset.
import { createFrontier } from './frontier.js';
import { createLog } from './log.js';
import { join } from 'node:path';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';

async function excludeResultsFromGit(repoDir, resultsPath) {
  try {
    const abs = join(repoDir, '.git', 'info', 'exclude');
    await mkdir(join(repoDir, '.git', 'info'), { recursive: true });
    let text = '';
    try {
      text = await readFile(abs, 'utf8');
    } catch {
      // no exclude file yet
    }
    const wsNorm = repoDir.replaceAll('\\', '/');
    const pathNorm = resultsPath.replaceAll('\\', '/');
    const rel = pathNorm.startsWith(wsNorm + '/') ? pathNorm.slice(wsNorm.length + 1) : pathNorm;
    const marker = '# phase21 dual-tracking: results.tsv is the untracked complete log';
    // real newlines, explicit concatenation — the pattern must be its own line
    const block = marker + '\n' + '/' + rel + '\n';
    if (!text.includes(marker)) {
      await appendFile(abs, block, 'utf8');
    }
  } catch {
    // non-fatal: frontier.commitOrReset also unstages neverTrack paths
  }
}

// CONTRACT
//   dual.track(experiment) -> { verdict, ...frontierResult, row }
// experiment: { id, kept, metric, previousBest, evidence: { stdout, exitCode, durationMs }, crashed }
export function createDualTracker({ repoDir, resultsPath, branch = 'frontier' } = {}) {
  const wsNorm = String(repoDir).replaceAll('\\', '/');
  const pathNorm = String(resultsPath).replaceAll('\\', '/');
  const resultsRel = pathNorm.startsWith(wsNorm + '/') ? pathNorm.slice(wsNorm.length + 1) : pathNorm;
  const frontier = createFrontier({ repoDir, branch, neverTrack: [resultsRel] });
  const log = createLog({ resultsPath });

  return {
    frontier,
    log,
    async track(experiment) {
      const { id, kept, metric, previousBest, evidence = {}, crashed } = experiment;
      const verdict = crashed ? 'crashed' : kept ? 'kept' : 'discarded';

      // The complete log lands BEFORE any git op: append + flush to disk so a
      // reset can never race the record of the experiment it is resetting.
      await excludeResultsFromGit(repoDir, resultsPath);
      const row = {
        experimentId: id,
        verdict,
        metric,
        previousBest,
        durationMs: evidence.durationMs,
        exitCode: evidence.exitCode,
        note: '',
      };
      await log.append(row);

      const frontierResult = await frontier.commitOrReset(id, kept);
      row.note =
        frontierResult.action === 'commit'
          ? `frontier:${frontierResult.commit.slice(0, 7)}`
          : 'workspace reset to frontier';

      return { verdict, ...frontierResult, row };
    },
  };
}
