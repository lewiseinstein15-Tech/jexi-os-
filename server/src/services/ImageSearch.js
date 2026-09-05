/**
 * B169 — IMAGE SEARCH (the presenter's picture skills).
 * Free, keyless, datacenter-proof image lookup over Wikimedia Commons
 * (the same API Wikipedia uses). Powers the image_search model tool so
 * answers can SHOW the thing, not just describe it.
 */

import fetch from 'node-fetch';
import { generateContent } from './LLMClient.js'; // B171 — vision-verified pictures

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


/* ══════════════════ B171 — DSH-STYLE PRESENTER (verified blocks) ══════════════════
 * DSH principle ported: the TOOL guarantees what gets displayed. Pictures
 * are verified by vision before being shown; generated pics are real
 * generated images (Pollinations, free, no key) — never "here's a prompt
 * for DALL·E" excuses. */

/**
 * Vision-verify candidate images against the subject: return them ordered,
 * with the first one the vision model CONFIRMS shows the subject moved to
 * the front. Falls back to the original order when vision is unavailable.
 */
export async function verifyImagesWithVision(subject, images, { max = 3 } = {}) {
  const candidates = images.slice(0, max);
  for (const img of candidates) {
    try {
      const b64 = `data:image/jpeg;base64,${Buffer.from(await (await fetch(img.thumb, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': UA } })).arrayBuffer()).toString('base64')}`;
      const verdict = await generateContent(
        `Does this image actually show: ${subject}? Answer only YES or NO.`,
        'You verify image search results. Answer strictly YES or NO.',
        b64,
      );
      if (/\bYES\b/i.test(String(verdict || '').slice(0, 20))) {
        img.verified = true;
        return [img, ...images.filter((x) => x !== img)];
      }
      img.rejected = String(verdict || 'NO').slice(0, 40);
    } catch { /* vision unavailable — keep order */ }
  }
  return images;
}

/** Free AI image generation (Pollinations) — no key, no card, no signup. */
export function generatedImageUrl(prompt, { width = 768, height = 512 } = {}) {
  const clean = String(prompt || '').trim().slice(0, 300);
  if (!clean) return null;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(clean)}?width=${width}&height=${height}&nologo=true&seed=${Math.floor(Math.random() * 99999)}`;
}

const SHOW_RE = /\b(shows?|find|displays?|see|look\s+at)\b[^.?!]{0,40}\b(picture|photo|image|pic)\b|\b(picture|photo|image|pic)\s+of\b|\bwhat\s+(does|do)\b[^.?!]{0,30}\blook\s+like\b/i;
const GEN_RE = /\b(generate|draw|create|make|paint|design)\b[^.?!]{0,40}\b(picture|photo|image|pic|art)\b|\b(draw|paint)\b\s+(me\s+)?(a|an|the)\b/i;
const BLOCK_WORDS = /\b(build|code|app|website|logo\s+file|icon\s+file|diagram\s+of\s+the\s+system|architecture|describe|describing|analy[sz]e|analy[sz]ing|identify|what\s+is\s+in\s+this|what\s+do\s+you\s+see|tell\s+me\s+about\s+this|read\s+this)\b/i; // B227 — vision-ANALYSIS phrasing never triggers picture SEARCH

/**
 * B171 — one detector, two modes:
 *   { mode: 'find', subject }     → real photos (Commons + vision verify)
 *   { mode: 'generate', subject } → AI-generated image (Pollinations)
 * Never fires on links (video path owns them) or engineering build requests.
 */
export function detectPictureIntent(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 200) return null;
  if (/https?:\/\/\S+/.test(raw)) return null;
  // one filler-word stripper for BOTH modes — content words survive
  const strip = (t) => t
    .replace(/^(hey\s+jexi[,:]?\s+)?(can\s+you\s+)?(please\s+)?/i, ' ')
    .replace(/\b(me|us|a|an|the|some|of|for|with|shows?|find|displays?|see|look|at|picture|photo|image|pic|art|real|actual|good|nice|please|someone|somebody|generate|draw|create|make|paint|design|what|does|do|like|want|to)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (GEN_RE.test(raw) && !BLOCK_WORDS.test(raw)) {
    const subject = strip(raw);
    if (subject.length >= 3) return { mode: 'generate', subject: subject.slice(0, 120), question: raw.slice(0, 150) };
  }
  if (SHOW_RE.test(raw) && !BLOCK_WORDS.test(raw)) {
    const subject = strip(raw);
    if (subject.length >= 3) return { mode: 'find', subject: subject.slice(0, 100), question: raw.slice(0, 150) };
  }
  return null;
}

/** B171 — correction follow-up: "no I mean a lion ANIMAL" right after a
 *  picture answer re-fires the picture path with the corrected subject. */
export function detectCorrectionToPicture(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 120) return null;
  if (!/^(no+|not\s+that)\b[,.!\s]/i.test(raw) || !/\bi\s+mean\b/i.test(raw)) return null;
  const subject = raw.split(/\bi\s+mean\b/i)[1]
    .replace(/\b(a|an|the|is|was|actual|real|animal|bird|insect|fish|plant|car|plane|plane|not)\b/gi, ' ')
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (subject.length < 3) return null;
  return { mode: 'find', subject: subject.slice(0, 100), question: raw.slice(0, 150), corrected: true };
}
