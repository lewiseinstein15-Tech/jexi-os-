/**
 * B169 — IMAGE SEARCH (the presenter's picture skills).
 * Free, keyless, datacenter-proof image lookup over Wikimedia Commons
 * (the same API Wikipedia uses). Powers the image_search model tool so
 * answers can SHOW the thing, not just describe it.
 */

import fetch from 'node-fetch';

const UA = 'JEXI-OS/1.0 (image search; research agent)';

function isGarbageImage(title) {
  return /icon|logo|blank|placeholder|disambig/i.test(String(title || ''));
}

/**
 * Search Commons for images matching a query.
 * → { ok, images: [{ url, thumb, title, width, height, descriptionUrl, license }] }
 * (url = full-size, thumb = 640px preview — embed the thumb, link the full.)
 */
export async function imageSearch(query, { limit = 4 } = {}) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, error: 'query required' };
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search`
    + `&gsrsearch=${encodeURIComponent(`filetype:bitmap|drawing ${q}`)}&gsrlimit=${Math.min(10, limit * 3)}`
    + `&gsrnamespace=6&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=640&format=json`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return { ok: false, error: `commons HTTP ${res.status}` };
    const data = await res.json();
    const pages = Object.values((data.query || {}).pages || {});
    const images = [];
    for (const p of pages) {
      const ii = p.imageinfo && p.imageinfo[0];
      if (!ii || !ii.thumburl) continue;
      if (isGarbageImage(p.title)) continue;
      const meta = (ii.extmetadata || {});
      images.push({
        url: ii.url,
        thumb: ii.thumburl,
        title: String(p.title || '').replace(/^File:/, '').replace(/\.(jpg|jpeg|png|gif|svg|webp)$/i, ''),
        width: ii.width,
        height: ii.height,
        descriptionUrl: ii.descriptionurl || null,
        license: (meta.LicenseShortName && meta.LicenseShortName.value) || 'see Commons',
        artist: meta.Artist ? String(meta.Artist.value).replace(/<[^>]+>/g, '').slice(0, 80) : '',
      });
      if (images.length >= limit) break;
    }
    if (!images.length) return { ok: false, error: 'no images found' };
    return { ok: true, query: q, images };
  } catch (e) {
    return { ok: false, error: `commons: ${(e && e.message) || e}` };
  }
}


/* ══════════════════ B170 — NATURAL PICTURE INTENT ══════════════════ */

const PICTURE_RE = /\b(show|draw|display|find)\b[^.?!]{0,40}\b(picture|photo|image|pic)\b\s*(of|for|with)?\b|\b(picture|photo|image|pic)\s+of\b|\bwhat\s+(does|do)\b[^.?!]{0,30}\blook\s+like\b/i;
const BUILD_RE = /\b(build|make|create|generate|design|code|app|website|logo\s+for)\b/i;

/**
 * Detect "show me a picture of X" from a plain sentence.
 * → { subject, question } | null. Never fires on build requests, video
 * URLs (the watch pipeline owns those), or long pastes.
 */
export function detectPictureIntent(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 200) return null;
  if (/https?:\/\/\S+/.test(raw)) return null;          // links → video/research paths
  if (BUILD_RE.test(raw) && !/\bshow\b/i.test(raw)) return null;
  if (!PICTURE_RE.test(raw)) return null;
  const subject = raw
    .replace(/^(hey\s+jexi[,:]?\s+)?(can\s+you\s+)?(please\s+)?(show|draw|display|find)\b/i, ' ')
    .replace(/\b(me|us|a|an|the|some|of|for|with|picture|photo|image|pic|real|actual|good|nice|please)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (subject.length < 3) return null;
  return { subject: subject.slice(0, 100), question: raw.slice(0, 150) };
}
