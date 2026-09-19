// research/tracking/frontier.js
// Git branch = frontier of successful experiments only (karpathy/autoresearch,
// MIT dual-tracking pattern): on improve -> git commit; on no-improve ->
// git reset, so the branch tip is always the best-known state.
//
// SAFETY: frontier operations run inside a DEDICATED experiment workspace repo
// (a scratch git repo owned by the loop). By construction this refuses to run
// against the host JEXI repository — dual tracking must never mutate repo
// history; the phase contract's reset semantics apply to the experiment sandbox.
import { execFile } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST_REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function git(repoDir, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: repoDir, timeout: 15000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args.join(' ')} failed: ${stderr || err.message}`));
      else resolve(stdout.trim());
    });
  });
}

// CONTRACT
//   frontier.commitOrReset(experimentId, kept) -> { action: 'commit'|'reset', commit?: sha }
//   frontier.tip() -> current HEAD sha
//   frontier.log() -> raw `git log --oneline` of the frontier branch
export function createFrontier({ repoDir, branch = 'frontier', allowHostRepo = false, neverTrack = [] } = {}) {
  if (!repoDir) throw new Error('createFrontier requires repoDir');
  const rootNorm = HOST_REPO_ROOT.replace(/\\/g, '/');
  const dirNorm = String(repoDir).replace(/\\/g, '/');
  if (!allowHostRepo && (dirNorm === rootNorm || dirNorm.startsWith(rootNorm + '/') === false)) {
    if (dirNorm === rootNorm) {
      throw new Error('frontier refuses to operate on the host JEXI repository');
    }
    // paths outside the workspace tree are also refused unless explicitly allowed
    if (!dirNorm.includes('/research/.probes/')) {
      throw new Error(`frontier repoDir must live under research/.probes/ (got ${repoDir})`);
    }
  }

  async function commitOrReset(experimentId, kept) {
    if (kept) {
      // neverTrack paths (e.g. the complete-log results.tsv) must never enter a
      // frontier commit: unstage them explicitly after add -A.
      for (const p of neverTrack) {
        await git(repoDir, ['rm', '--cached', '-r', '-q', '--ignore-unmatch', p]);
      }
      await git(repoDir, ['add', '-A']);
      for (const p of neverTrack) {
        await git(repoDir, ['reset', '-q', '--', p]);
      }
      await git(repoDir, [
        '-c', 'user.email=research@jexi.local',
        '-c', 'user.name=jexi-research',
        'commit', '-m', `experiment: ${experimentId} (kept)`,
      ]);
      // git commit prints a human summary line; the sha comes from rev-parse.
      const sha = await git(repoDir, ['rev-parse', 'HEAD']);
      return { action: 'commit', commit: sha };
    }
    // not kept (discarded OR crashed): the workspace returns to the frontier tip
    await git(repoDir, ['reset', '--hard', branch]);
    return { action: 'reset' };
  }

  return {
    repoDir,
    branch,
    commitOrReset,
    tip: () => git(repoDir, ['rev-parse', branch]),
    log: () => git(repoDir, ['log', '--oneline', branch]),
    status: () => git(repoDir, ['status', '--porcelain']),
  };
}
