/**
 * JEXI OS — CROSS-HARNESS ADAPTERS — install (Phase 7 H).
 *
 * Writes converted files into a harness's config dir. Idempotent by design:
 *   - existing file with identical content → NOT rewritten (identical++)
 *   - existing file with different content → rewritten (changed++)
 *   - new file → created (created++)
 * A second install run must therefore produce zero writes and zero new
 * files (drift-free, duplicate-free).
 *
 * dryRun: report exactly what WOULD happen, touch nothing.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/** Convert the file list once into a comparable form (path → sha256). */
function digest(content) {
  return crypto.createHash('sha256').update(String(content), 'utf8').digest('hex').slice(0, 16);
}

/**
 * writeConverted({ converted, targetRoot, dryRun }) → result
 *   converted.files: [{ path, content, kind }]   paths RELATIVE to targetRoot
 *   result: { targetRoot, dryRun, created, changed, identical, paths, bytes }
 */
export function writeConverted({ converted, targetRoot, dryRun = false }) {
  const files = converted?.files || [];
  const result = { targetRoot, dryRun: !!dryRun, created: 0, changed: 0, identical: 0, paths: [], bytes: 0 };

  for (const f of files) {
    const rel = String(f.path).replace(/^\//, '');
    const abs = path.join(targetRoot, rel);
    const content = String(f.content ?? '');
    const exists = fs.existsSync(abs);

    if (exists) {
      const current = fs.readFileSync(abs, 'utf8');
      if (current === content) {
        result.identical += 1;
        result.paths.push({ path: abs, action: 'identical', kind: f.kind });
        continue;
      }
      if (!dryRun) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
      }
      result.changed += 1;
      result.bytes += Buffer.byteLength(content, 'utf8');
      result.paths.push({ path: abs, action: dryRun ? 'would-change' : 'changed', kind: f.kind });
    } else {
      if (!dryRun) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
      }
      result.created += 1;
      result.bytes += Buffer.byteLength(content, 'utf8');
      result.paths.push({ path: abs, action: dryRun ? 'would-create' : 'created', kind: f.kind });
    }
  }

  result.writes = result.created + result.changed; // second run of an idempotent install → 0
  result.fingerprint = digest(files.map((f) => `${f.path}:${f.content}`).join('\n\u0000\n'));
  return result;
}
