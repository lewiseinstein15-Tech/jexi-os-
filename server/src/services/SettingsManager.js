import fs from 'fs';
import path from 'path';

const SETTINGS_FILE = path.join(process.cwd(), 'settings.json');

export function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
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
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(clean, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('Settings save error:', e);
    return false;
  }
}
