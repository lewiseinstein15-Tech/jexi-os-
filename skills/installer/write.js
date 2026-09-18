/**
 * JEXI OS — UNIVERSAL SKILL INSTALLER — write.js
 *
 * The write layer: for each (harness, skill) produce the file plan, compare
 * sha256 against what is on disk (and the manifest), and write only what
 * changed. That makes install IDEMPOTENT: a re-run touches nothing and
 * reports unchanged counts. Uninstall deletes exactly the recorded files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { planFiles, sha256 } from './convert.js';
import { load as loadManifest, recordInstall, recordRemove } from './manifest.js';

/**
 * Install skills to one harness target.
 * dryRun=true → identical plan, zero writes.
 */
export function install(target, skills, { root, source, dryRun = false } = {}) {
  const actions = [];
  for (const skill of skills) {
    for (const f of planFiles(skill, target.style)) {
      const absPath = path.join(target.dir, f.relPath);
      const hash = sha256(f.content);
      const exists = fs.existsSync(absPath);
      const current = exists ? sha256(fs.readFileSync(absPath, 'utf8')) : null;
      actions.push({
        skill: skill.slug,
        absPath,
        content: f.content,
        sha256: hash,
        bytes: Buffer.byteLength(f.content),
        state: !exists ? 'created' : current === hash ? 'unchanged' : 'updated',
        wouldWrite: !exists || current !== hash,
      });
    }
  }
  const summary = {
    harness: target.id,
    displayName: target.displayName,
    dir: target.dir,
    style: target.style,
    dryRun,
    files: actions.length,
    created: actions.filter((a) => a.state === 'created').length,
    updated: actions.filter((a) => a.state === 'updated').length,
    unchanged: actions.filter((a) => a.state === 'unchanged').length,
  };
  if (!dryRun) {
    for (const a of actions) {
      if (!a.wouldWrite) continue;
      fs.mkdirSync(path.dirname(a.absPath), { recursive: true });
      fs.writeFileSync(a.absPath, a.content);
    }
    recordInstall(root, { harnessId: target.id, displayName: target.displayName, dir: target.dir, style: target.style, source, files: actions });
  }
  return { ...summary, actions };
}

/** Remove every file recorded for a harness; prune empty dirs. */
export function uninstall(target, { root } = {}) {
  const entry = recordRemove(root, target.id);
  if (!entry) return { harness: target.id, removed: false, reason: 'no manifest entry — nothing was installed by this installer' };
  let removed = 0;
  for (const [skill, files] of Object.entries(entry.skills)) {
    for (const f of files) {
      if (fs.existsSync(f.path)) {
        fs.rmSync(f.path, { force: true });
        removed += 1;
      }
      let dir = path.dirname(f.path);
      while (dir.startsWith(entry.dir) && dir !== entry.dir) {
        try {
          if (fs.readdirSync(dir).length === 0) { fs.rmdirSync(dir); dir = path.dirname(dir); } else break;
        } catch { break; }
      }
    }
  }
  return { harness: target.id, removed: true, filesRemoved: removed, dir: entry.dir };
}

/** Installed-skills view for --list (manifest-driven, falls back to disk). */
export function installedReport(target, { root } = {}) {
  const manifest = loadManifest(root);
  const entry = manifest.harnesses[target.id];
  if (!entry) return { harness: target.id, displayName: target.displayName, installed: false };
  return {
    harness: target.id,
    displayName: target.displayName,
    installed: true,
    installedAt: entry.installedAt,
    dir: entry.dir,
    style: entry.style,
    skills: Object.keys(entry.skills).sort(),
    fileCount: Object.values(entry.skills).reduce((n, fs2) => n + fs2.length, 0),
  };
}
