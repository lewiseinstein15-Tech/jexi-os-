// Phase 11 Scope E — Douyin channel (Tier 2 — JS/login wall, reported honestly).
import { makeWallChannel, loginWallDetected } from './wall.factory.js';
import { probeCheck } from './_shared.js';

export class DouyinChannel extends makeWallChannel({
  name: 'douyin',
  description: 'Douyin videos (JS-rendered + login-gated for anonymous readers — honest AUTH_REQUIRED)',
  hosts: ['douyin.com', 'v.douyin.com', 'iesdouyin.com'],
  wallMarkers: ['登录', '验证码', 'verify', '请打开抖音'],
}) {
  check = probeCheck('https://www.douyin.com/', (status, body) => {
    if (status === 200 && (loginWallDetected(body) || body.length < 4000)) return { status: 'off', message: 'AUTH_REQUIRED: douyin serves a login/verify wall (JS-rendered, anonymous reads gated)' };
    if (status === 200) return { status: 'warn', message: 'reachable (HTTP 200); videos are login/JS-gated per-read' };
    return { status: 'error', message: `HTTP ${status}` };
  }).bind(this);
}
