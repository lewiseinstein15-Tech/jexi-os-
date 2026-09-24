// research/tracking/log.js
// results.tsv = the COMPLETE log (karpathy/autoresearch dual-tracking: git
// branch keeps only successes, the TSV keeps everything — kept, discarded,
// crashed). Append-only, tab-separated, header written once.
import { appendFile, writeFile, readFile } from 'node:fs/promises';

const HEADER = ['experimentId', 'verdict', 'metric', 'previousBest', 'delta', 'durationMs', 'exitCode', 'note'];
const VERDICTS = new Set(['kept', 'discarded', 'crashed']);

function tsvEscape(v) {
  return String(v).replace(/\t/g, '\\t').replace(/\n/g, '\\n');
}

function tsvRow(values) {
  return values.map(tsvEscape).join('\t') + '\n';
}

// CONTRACT
//   log.append(record) — appends one row to results.tsv.
//   record: { experimentId, verdict: 'kept'|'discarded'|'crashed',
//             metric, previousBest, durationMs, exitCode, note }
export function createLog({ resultsPath } = {}) {
  if (!resultsPath) throw new Error('createLog requires resultsPath');

  async function ensureHeader() {
    let current = '';
    try {
      current = await readFile(resultsPath, 'utf8');
    } catch {
      // absent — write header below
    }
    if (current === '') await writeFile(resultsPath, tsvRow(HEADER), 'utf8');
  }

  async function append(record) {
    const verdict = VERDICTS.has(record.verdict) ? record.verdict : 'crashed';
    const num = (v) => (Number.isFinite(v) ? String(v) : '');
    const delta =
      Number.isFinite(record.metric) && Number.isFinite(record.previousBest)
        ? String(record.metric - record.previousBest)
        : '';
    await ensureHeader();
    await appendFile(
      resultsPath,
      tsvRow([
        record.experimentId ?? 'experiment',
        verdict,
        num(record.metric),
        num(record.previousBest),
        delta,
        num(record.durationMs),
        num(record.exitCode),
        record.note ?? '',
      ]),
      'utf8',
    );
  }

  async function rows() {
    let text = '';
    try {
      text = await readFile(resultsPath, 'utf8');
    } catch {
      return [];
    }
    const [head, ...rest] = text.split('\n').filter((l) => l.length > 0);
    if (!head) return [];
    const cols = head.split('\t');
    return rest.map((line) => {
      const cells = line.split('\t');
      const row = {};
      cols.forEach((c, i) => {
        row[c] = cells[i] ?? '';
      });
      return row;
    });
  }

  return { append, rows };
}
