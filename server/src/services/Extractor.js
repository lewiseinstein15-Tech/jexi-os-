import fetch from 'node-fetch';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { isSSRF } from './Security.js';
import { YoutubeTranscript } from 'youtube-transcript';
import { convert } from 'html-to-text';
import { extractText, getDocumentProxy } from 'unpdf';

let browser;
async function getBrowser() {
  if (browser) return browser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    return browser;
  } catch (e) { return null; }
}

async function renderWithJS(url) {
  const b = await getBrowser();
  if (!b) return null;
  let page;
  try {
    page = await b.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    const html = await page.content();
    await page.close();
    return html;
  } catch (e) { try { await page?.close(); } catch (e2) {} return null; }
}

async function fetchBuffer(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }, timeout: 20000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.arrayBuffer();
  } catch (e) {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const proxyRes = await fetch(proxyUrl, { timeout: 30000 });
    if (proxyRes.ok) return await proxyRes.arrayBuffer();
    throw new Error(`Download failed: ${e.message}`);
  }
}

async function fetchHTML(url, opts = {}) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }, timeout: 12000 });
    if (res.status === 403 || res.status === 503) throw new Error('Blocked by host');
    return await res.text();
  } catch (e) {
    // JS rendering launches a full Chromium browser — only for explicit link
    // analysis, NEVER during bulk search extraction (memory-heavy, and a crash
    // there kills the whole request).
    if (opts.js) {
      const jsHtml = await renderWithJS(url);
      if (jsHtml) return jsHtml;
    }
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const proxyRes = await fetch(proxyUrl, { timeout: 20000 });
    if (proxyRes.ok) return await proxyRes.text();
    throw new Error(`All fetch methods failed: ${e.message}`);
  }
}

async function oembed(url) {
  const platforms = [
    { match: /youtube\.com\/watch|youtu\.be\//, endpoint: `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json` },
    { match: /tiktok\.com\//, endpoint: `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}` },
    { match: /instagram\.com\/(p|reel|tv)\//, endpoint: `https://api.instagram.com/oembed?url=${encodeURIComponent(url)}` },
  ];
  for (const p of platforms) {
    if (p.match.test(url)) {
      try {
        const res = await fetch(p.endpoint, { signal: AbortSignal.timeout(8000) });
        if (res.ok) return await res.json();
      } catch (e) {}
    }
  }
  return null;
}

/** Describe ANY link: video, social post, article, website. */
export async function analyzeLink(url) {
  if (await isSSRF(url)) throw new Error('Security blocked (SSRF)');

  // 1) oEmbed for YouTube / TikTok / Instagram — instant title, author, thumbnail
  const oembedData = await oembed(url);
  if (oembedData) {
    let content = `Title: ${oembedData.title || ''}\nAuthor: ${oembedData.author_name || ''}\nProvider: ${oembedData.provider_name || ''}\nType: ${oembedData.type || 'video'}\n`;
    // YouTube: try to grab the full transcript so JEXI can explain the video's content
    if (oembedData.provider_name === 'YouTube') {
      const videoId = url.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})(?:[?&]|$)/)?.[1];
      if (videoId) {
        try {
          const transcriptData = await YoutubeTranscript.fetchTranscript(videoId);
          if (transcriptData?.length) {
            content += `\nFull Video Transcript:\n${transcriptData.map(t => t.text).join(' ')}`;
          }
        } catch (e) { content += `\n(Transcript unavailable: ${e.message})\n`; }
      }
    }
    return { title: oembedData.title || 'Media', content, length: content.length, method: 'oembed' };
  }

  // 2) Regular pages: fetch + readability, with meta-tag fallback
  const html = await fetchHTML(url, { js: true });
  const doc = new JSDOM(html, { url });
  const { document } = doc.window;

  const meta = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.getAttribute('content') || el.textContent || '' : '';
  };
  const ogTitle = meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || document.title;
  const ogDesc = meta('meta[property="og:description"]') || meta('meta[name="description"]') || '';

  const reader = new Readability(document);
  const article = reader.parse();

  if (article && article.textContent && article.length >= 300) {
    return {
      title: article.title || ogTitle,
      content: `${ogDesc ? `Description: ${ogDesc}\n\n` : ''}${article.textContent.trim().replace(/\n{3,}/g, '\n\n')}`,
      length: article.length,
      method: 'readability',
    };
  }

  const text = convert(html, { wordwrap: 130 });
  if (text && text.length > 200) {
    return { title: ogTitle || new URL(url).hostname, content: `${ogDesc ? `Description: ${ogDesc}\n\n` : ''}${text}`, length: text.length, method: 'html-to-text' };
  }

  throw new Error('No readable content found on this page (login wall or empty page).');
}

/** Extract plain text from a PDF buffer (used by the book library). */
export async function extractPdfText(arrayBuffer) {
  const pdf = await getDocumentProxy(new Uint8Array(arrayBuffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return String(text || '');
}

/**
 * Download a book/document from a URL for the knowledge library.
 * PDFs are parsed with unpdf; anything else is read as plain text.
 */
export async function downloadBookFromUrl(url) {
  if (await isSSRF(url)) throw new Error('Security blocked (SSRF)');
  const buf = await fetchBuffer(url);
  const bytes = new Uint8Array(buf);
  const isPdf =
    url.toLowerCase().endsWith('.pdf') ||
    url.includes('filetype=pdf') ||
    (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46); // %PDF
  let name = '';
  try { name = decodeURIComponent(url.split('/').pop()?.split('?')[0] || ''); } catch (e) {}
  if (!name) name = isPdf ? 'book.pdf' : 'book.txt';
  if (isPdf) {
    const text = await extractPdfText(buf);
    if (text.length < 40) throw new Error('This PDF has no extractable text (it may be a scanned/image PDF).');
    return { name, mime: 'application/pdf', text };
  }
  const text = Buffer.from(buf).toString('utf-8');
  if (text.length < 40) throw new Error('No readable text found at this URL.');
  return { name, mime: 'text/plain', text };
}

export async function extractContent(url) {
  if (await isSSRF(url)) throw new Error('Security blocked (SSRF)');

  // YOUTUBE
  if (url.includes('youtube.com/watch') || url.includes('youtu.be/')) {
    let videoId = url.split('v=')[1]?.split('&')[0] || url.split('youtu.be/')[1]?.split(/[?&]/)[0];
    if (videoId) {
      try {
        const transcriptData = await YoutubeTranscript.fetchTranscript(videoId);
        const transcriptText = transcriptData.map(t => t.text).join(' ');
        const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, { signal: AbortSignal.timeout(8000) });
        const oembedData = oembedRes.ok ? await oembedRes.json() : {};
        return {
          title: oembedData.title || 'YouTube Video',
          content: `Video Title: ${oembedData.title || ''}\nAuthor: ${oembedData.author_name || ''}\n\nFull Video Transcript:\n${transcriptText}`,
          length: transcriptText.length,
          method: 'youtube-transcript',
        };
      } catch (e) { throw new Error('Could not fetch YouTube transcript.'); }
    }
  }

  // TIKTOK / INSTAGRAM — oembed first
  if (url.includes('tiktok.com') || url.includes('instagram.com')) {
    const data = await oembed(url);
    if (data) {
      return { title: data.title || data.author_name || 'Social Post', content: `Title: ${data.title || ''}\nAuthor: ${data.author_name || ''}\nProvider: ${data.provider_name || ''}`, length: 200, method: 'oembed' };
    }
  }

  // PDF DOCUMENTS (Books/Research Papers)
  if (url.toLowerCase().endsWith('.pdf') || url.includes('filetype=pdf')) {
    try {
      const arrayBuffer = await fetchBuffer(url);
      const text = await extractPdfText(arrayBuffer);
      return { title: url.split('/').pop() || 'PDF Document', content: text, length: text.length, method: 'pdf-book' };
    } catch (e) {
      throw new Error(`PDF extraction failed: ${e.message}`);
    }
  }

  // HTML PAGES
  const html = await fetchHTML(url); // js rendering off — search extraction stays lightweight
  if (html.includes('cf-challenge') || html.includes('Cloudflare Ray ID')) {
    throw new Error('Cloudflare bot protection triggered.');
  }

  const doc = new JSDOM(html, { url });
  const reader = new Readability(doc.window.document);
  const article = reader.parse();

  if (!article || !article.textContent || article.length < 500) {
    const text = convert(html, { wordwrap: 130 });
    if (text && text.length > 500) {
      return { title: doc.window.document.title || new URL(url).hostname, content: text, length: text.length, method: 'html-to-text' };
    }
    throw new Error('Page has no readable content or is too short.');
  }

  return {
    title: article.title,
    content: article.textContent.trim().replace(/\n{3,}/g, '\n\n'),
    length: article.length,
    method: 'readability',
  };
}
