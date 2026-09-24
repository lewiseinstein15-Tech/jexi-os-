/**
 * JEXI OS — Phase 28 Scope C — typed-edge KG: extraction CLI.
 *   node brain/kg/extract-cli.js <repoPath> [--stale] [--json]
 * --stale: only re-extract stale pages; default: extract all.
 * Prints a deterministic JSON summary. Exit 0 ok / 1 usage error.
 */
import { extractStale } from './index.js';

const args = process.argv.slice(2);
const repoPath = args.find((a) => !a.startsWith('--'));
const onlyStale = args.includes('--stale');

if (!repoPath) {
  console.error('usage: node brain/kg/extract-cli.js <repoPath> [--stale]');
  process.exit(1);
}
const res = extractStale(repoPath, { onlyStale });
console.log(JSON.stringify(res, null, 2));
