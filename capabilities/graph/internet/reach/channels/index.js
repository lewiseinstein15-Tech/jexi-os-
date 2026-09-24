// Phase 11 Scope D+E — channel registry (16 channels).
//
// ORDER MATTERS: platform channels first (Tier 0 zero-config → Tier 1
// key/CLI → Tier 2 login-gated) — WebChannel LAST so it only ever catches
// what nothing else claimed. Routing picks the FIRST can_handle() match.

import { WebChannel } from './web.channel.js';
import { GitHubChannel } from './github.channel.js';
import { RedditChannel } from './reddit.channel.js';
import { YouTubeChannel } from './youtube.channel.js';
import { V2EXChannel } from './v2ex.channel.js';
import { XueqiuChannel } from './xueqiu.channel.js';
import { RSSChannel } from './rss.channel.js';
import { TwitterChannel } from './twitter.channel.js';
import { BilibiliChannel } from './bilibili.channel.js';
import { PodcastChannel } from './podcast.channel.js';
import { InstagramChannel } from './instagram.channel.js';
import { LinkedInChannel } from './linkedin.channel.js';
import { XiaoHongShuChannel } from './xiaohongshu.channel.js';
import { DouyinChannel } from './douyin.channel.js';
import { WeiboChannel } from './weibo.channel.js';
import { WeChatChannel } from './wechat.channel.js';

export const ALL_CHANNELS = [
  // ── Tier 0 — zero-config ──
  new GitHubChannel(),
  new RedditChannel(),
  new YouTubeChannel(),
  new V2EXChannel(),
  new XueqiuChannel(),
  new RSSChannel(),
  // ── Tier 1 — needs key/CLI for full function ──
  new TwitterChannel(),
  new BilibiliChannel(),
  new PodcastChannel(),
  // ── Tier 2 — needs browser/login ──
  new InstagramChannel(),
  new LinkedInChannel(),
  new XiaoHongShuChannel(),
  new DouyinChannel(),
  new WeiboChannel(),
  new WeChatChannel(),
  // ── universal fallback — ALWAYS LAST ──
  new WebChannel(),
];

export function getChannel(name) {
  return ALL_CHANNELS.find((c) => c.name === name) || null;
}

/** Route a URL: first can_handle() match wins. */
export function route(url, channels = ALL_CHANNELS) {
  for (const ch of channels) {
    try {
      if (ch.can_handle(url)) return { channel: ch, reason: `${ch.name}.can_handle(${url}) === true` };
    } catch {
      // a broken can_handle must never take routing down
    }
  }
  return { channel: null, reason: `no channel can handle ${url}` };
}
