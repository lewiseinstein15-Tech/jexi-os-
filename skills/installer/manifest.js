/**
 * JEXI OS — UNIVERSAL SKILL INSTALLER — manifest.js
 *
 * Tracks what was installed where: one JSON per root at
 * <root>/.jexi/installer-manifest.json. Each harness entry records every
 * installed file with its sha256 at write time — this is what makes
 * reinstall idempotent and uninstall clean.
 */
import fs from 'node:fs';
import path from 'node:path';

export function manifestPath(root) {
  return path.join(root, '.jexi', 'installer-manifest.json');
}

export function load(root) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(root), 'utf8'));
  } catch {
    return { kind: 'jexi.installer.manifest', version: 1, harnesses: {} };
  }
}

export function save(root, manifest) {
  const p = manifestPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n');
  return p;
}

export function recordInstall(root, { harnessId, displayName, dir, style, source, files }) {
  const manifest = load(root);
  manifest.harnesses[harnessId] = {
    displayName,
    dir,
    style,
    source,
    installedAt: new Date().toISOString(),
    skills: files.reduce((acc, f) => {
      const skill = f.skill;
      (acc[skill] ||= []).push({ path: f.absPath, sha256: f.sha256, bytes: f.bytes });
      return acc;
    }, {}),
  };
  return save(root, manifest);
}

export function recordRemove(root, harnessId) {
  const manifest = load(root);
  const entry = manifest.harnesses[harnessId] ?? null;
  if (entry) {
    delete manifest.harnesses[harnessId];
    save(root, manifest);
  }
  return entry;
}
