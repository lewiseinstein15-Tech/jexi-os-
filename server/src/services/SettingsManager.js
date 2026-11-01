import fs from 'fs';
import path from 'path';

/**
 * M15 — TEST ISOLATION.
 *
 * The settings file used to be pinned to `process.cwd()/settings.json` at
 * module-load time. Any test that spawned the server (or imported a service
 * that reads settings) with cwd = server/ therefore read and wrote the REAL
 * `server/settings.json`: a test could overwrite a developer's saved provider
 * config, and a developer's saved config could leak into a test and change its
 * result. Both directions are the same bug.
 *
 * `JEXI_SETTINGS_FILE` pins the path explicitly, which is what a test harness
 * sets to a temp file. It is resolved per call (not at import) so a test can
 * set it AFTER the module graph is loaded. Absent the env var the behaviour is
 * unchanged: cwd/settings.json.
 */
export function settingsFile() {
  const pinned = process.env.JEXI_SETTINGS_FILE;
  if (pinned && String(pinned).trim()) return String(pinned);
  return path.join(process.cwd(), 'settings.json');
}

export function loadSettings() {
  try {
    const file = settingsFile();
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
  } catch (e) { console.error('Settings load error:', e); }
  // githubToken was REMOVED (one-time-paste order): GitHub auth is a
  // memory-only session key or the GITHUB_TOKEN env var — never this file.
  return { geminiKey: '', groqKey: '' };
}

export function saveSettings(settings) {
  try {
    // one-time-paste order: the GitHub PAT is NEVER persisted — strip it at
    // the single choke point so no caller can store one by accident.
    const clean = { ...(settings || {}) };
    delete clean.githubToken;
    if (clean.connectors && clean.connectors.github && clean.connectors.github.auth) {
      clean.connectors = { ...clean.connectors, github: { ...clean.connectors.github, auth: { ...clean.connectors.github.auth } } };
      delete clean.connectors.github.auth.token;
    }
    const file = settingsFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(clean, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('Settings save error:', e);
    return false;
  }
}
