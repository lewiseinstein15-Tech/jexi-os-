/**
 * ARENA ASTRA REBUILD — User Profile (spec Part 31).
 *
 * Persistent, PRIVATE owner profile for JEXI. Stored at
 * DATA_DIR/profile.json (created with safe defaults on first boot).
 *
 * PRIVACY: this module NEVER exposes the full profile over the API.
 * Public surfaces get `publicPersona()` only (first name + creator credit).
 * The full profile is for JEXI's own behavior (tone, instructions, honesty).
 */

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';

const PROFILE_FILE = path.join(DATA_DIR, 'profile.json');

const DEFAULT_PROFILE = {
  preferredName: 'Lewis',
  projectIdentity: 'Lewis Einstein',
  github: 'lewiseinstein15-Tech',
  context: 'Kenya',
  education: 'BSc Computer Science student at Kibabii University — wants practical engineering ability, not only theory.',
  career: ['AI engineering', 'machine learning', 'data science', 'software engineering', 'data engineering'],
  environment: {
    primary: 'Android/phone-based (Termux, Ubuntu via proot-distro, Node.js, npm, Git, GitHub, llama.cpp, Ollama, local GGUF models)',
    notes: 'Never assume a powerful desktop. Distinguish Android/Termux from desktop Linux. Account for ARM64. Keep instructions practical.',
  },
  projects: {
    main: 'JEXI OS — Lewis\'s major AI systems project. Lewis is the creator/owner.',
    earlier: 'Noctryx AI — an important earlier AI project. Never confuse with JEXI.',
    market: 'JEXI Market — separate specialist market-analysis system. Architecturally independent; external capability only.',
  },
  models: {
    interests: ['Qwen', 'DeepSeek', 'Ollama', 'local models', 'free/low-cost providers'],
    rule: 'Never assume Lewis wants to pay for an API. Local models must work directly. The model is replaceable; JEXI is the system.',
  },
  philosophy: {
    noFake: 'No fake capabilities, telemetry, progress, agents, browser functionality, or autonomy. If it does not work, say so.',
    truth: 'Prefer "I can\'t confirm that yet" over guessing. Never fabricate tests, sources, capabilities, execution, progress, memory, research, or API responses.',
  },
  ui: {
    likes: ['human-designed interfaces', 'premium cinematic UI', 'meaningful animation', 'warm orange/coral/salmon on dark', 'handwritten JEXI typography', 'clean conversation', 'responsive desktop + phone'],
    dislikes: ['generic AI dashboards', 'clutter', 'too many buttons', 'excessive cards', 'fake AI activity', 'neon-green identity', 'manual agent management'],
  },
  conversation: {
    wantsLiveTalk: 'Lewis wants to SEE JEXI talking while she works — meaningful updates from real runtime events, not "Task running...".',
    style: 'Casual ("bro", humor, emojis, direct). JEXI mirrors tone when appropriate but never sacrifices correctness for humor.',
    address: 'JEXI may call him "Boss" when natural.',
  },
  relationship: 'Lewis is JEXI\'s creator and owner. "Who built you?" → "Lewis built me." Never expose credentials, private config, or security internals.',
};

let cache = null;

export function loadProfile() {
  if (cache) return cache;
  try {
    if (fs.existsSync(PROFILE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
      cache = { ...DEFAULT_PROFILE, ...raw };
      return cache;
    }
  } catch {}
  cache = { ...DEFAULT_PROFILE };
  try {
    fs.mkdirSync(path.dirname(PROFILE_FILE), { recursive: true });
    fs.writeFileSync(PROFILE_FILE, JSON.stringify(cache, null, 2));
  } catch {}
  return cache;
}

/** Update allowed personal fields (owner-only route). */
export function updateProfile(patch = {}) {
  const p = loadProfile();
  const allowed = ['preferredName', 'projectIdentity', 'context', 'education'];
  for (const k of allowed) {
    if (typeof patch[k] === 'string' && patch[k].trim()) p[k] = patch[k].trim().slice(0, 200);
  }
  try { fs.writeFileSync(PROFILE_FILE, JSON.stringify(p, null, 2)); } catch {}
  cache = p;
  return publicPersona();
}

/** The ONLY profile shape ever sent to clients. */
export function publicPersona() {
  const p = loadProfile();
  return { name: p.preferredName, identity: p.projectIdentity, creatorCredit: `${p.preferredName} built me.` };
}

/** System-prompt fragment: how JEXI should behave for Lewis (no secrets). */
export function behaviorBrief() {
  const p = loadProfile();
  return [
    `Owner: ${p.preferredName} (${p.projectIdentity}). Call him "Boss" when natural.`,
    `Mirror his tone (casual/playful ↔ serious/professional) without losing accuracy.`,
    `Truth first: ${p.philosophy.truth}`,
    `No fakes: ${p.philosophy.noFake}`,
    `Environment: ${p.environment.primary}`,
    `Main project: ${p.projects.main}`,
    `Talk while working: ${p.conversation.wantsLiveTalk}`,
  ].join('\n');
}

export const UserProfile = { loadProfile, updateProfile, publicPersona, behaviorBrief };
