// Phase 11 Scope E — Instagram channel (Tier 2 — login wall, reported honestly).
import { makeWallChannel, loginWallDetected } from './wall.factory.js';
import { probeCheck } from './_shared.js';

export class InstagramChannel extends makeWallChannel({
  name: 'instagram',
  description: 'Instagram profiles/posts (login-gated for anonymous readers — honest AUTH_REQUIRED)',
  hosts: ['instagram.com', 'instagr.am'],
  wallMarkers: ['login • instagram', 'sign up to see photos'],
}) {
  check = probeCheck('https://www.instagram.com/', (status, body) => {
    if (status === 200 && loginWallDetected(body)) return { status: 'off', message: 'AUTH_REQUIRED: instagram serves its login wall to anonymous readers' };
    if (status === 200) return { status: 'warn', message: 'reachable (HTTP 200); content is login-gated per-read' };
    return { status: 'error', message: `HTTP ${status}` };
  }).bind(this);
}
