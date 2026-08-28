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
