import fs from 'fs';
import path from 'path';

const SETTINGS_FILE = path.join(process.cwd(), 'settings.json');

export function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    }
  } catch (e) { console.error('Settings load error:', e); }
  // Changed from zhipuKey to geminiKey; githubToken powers the GitHub Agent
  // (commits, pushes, PRs) — read in GitHubAgent.js as GITHUB_TOKEN || GH_TOKEN || settings
  return { geminiKey: '', groqKey: '', githubToken: '' };
}

export function saveSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('Settings save error:', e);
    return false;
  }
}
