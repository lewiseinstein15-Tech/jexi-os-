// Phase 11 Scope E — LinkedIn channel (Tier 2 — authwall, reported honestly).
import { makeWallChannel, loginWallDetected } from './wall.factory.js';
import { probeCheck } from './_shared.js';

export class LinkedInChannel extends makeWallChannel({
  name: 'linkedin',
  description: 'LinkedIn posts/profiles (authwall for anonymous readers — honest AUTH_REQUIRED)',
  hosts: ['linkedin.com', 'lnkd.in'],
  wallMarkers: ['authwall', 'join linkedin', 'sign in to linkedin'],
}) {
  check = probeCheck('https://www.linkedin.com/', (status, body) => {
    if (status === 200 && loginWallDetected(body)) return { status: 'off', message: 'AUTH_REQUIRED: linkedin authwall intercepts anonymous reads' };
    if (status === 200) return { status: 'warn', message: 'reachable (HTTP 200); posts/profiles are login-gated per-read' };
    return { status: 'error', message: `HTTP ${status}` };
  }).bind(this);
}
