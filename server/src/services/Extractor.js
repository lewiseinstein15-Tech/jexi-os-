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
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    return browser;
  } catch (e) { return null; }
}

async function renderWithJS(url) {
  const b = await getBrowser();
  if (!b) return null;
  const page = await b.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    const html = await page.content();
    await page.close();
    return html;
  } catch(e) { await page.close(); return null; }
}

async function fetchBuffer(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
      timeout: 20000
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.arrayBuffer();
  } catch (e) {
    console.log(`⚠ Direct PDF download failed for ${url}. Trying proxy...`);
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const proxyRes = await fetch(proxyUrl, { timeout: 30000 });
    if (proxyRes.ok) return await proxyRes.arrayBuffer();
    throw new Error(`Download failed: ${e.message}`);
  }
}

async function fetchHTML(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
      timeout: 10000
    });
    if (res.status === 403 || res.status === 503) throw new Error('Blocked by host');
    return await res.text();
  } catch (e) {
    const jsHtml = await renderWithJS(url);
    if (jsHtml) return jsHtml;
    console.log(`⚠ Direct fetch failed for ${url}. Trying proxy bypass...`);
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const proxyRes = await fetch(proxyUrl, { timeout: 15000 });
    if (proxyRes.ok) return await proxyRes.text();
    throw new Error(`All fetch methods failed: ${e.message}`);
  }
}

export async function extractContent(url) {
  if (await isSSRF(url)) throw new Error('Security blocked (SSRF)');

  // YOUTUBE
  if (url.includes('youtube.com/watch') || url.includes('youtu.be/')) {
    let videoId = url.split('v=')[1]?.split('&')[0] || url.split('youtu.be/')[1];
    if (videoId) {
      try {
        const transcriptData = await YoutubeTranscript.fetchTranscript(videoId);
        const transcriptText = transcriptData.map(t => t.text).join(' ');
        const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
        const oembedData = await oembedRes.json();
        return {
          title: oembedData.title,
          content: `Video Title: ${oembedData.title}\nAuthor: ${oembedData.author_name}\n\nFull Video Transcript:\n${transcriptText}`,
          length: transcriptText.length,
          method: 'youtube-transcript'
        };
      } catch (e) { throw new Error('Could not fetch YouTube transcript.'); }
    }
  }

  // PDF DOCUMENTS (Books/Research Papers) - Using modern unpdf
  if (url.toLowerCase().endsWith('.pdf') || url.includes('filetype=pdf')) {
    try {
      const arrayBuffer = await fetchBuffer(url);
      const pdf = await getDocumentProxy(new Uint8Array(arrayBuffer));
      const { text } = await extractText(pdf, { mergePages: true });
      
      return {
        title: url.split('/').pop() || 'PDF Document',
        content: text,
        length: text.length,
        method: 'pdf-book'
      };
    } catch (e) {
      throw new Error(`PDF extraction failed: ${e.message}`);
    }
  }

  // HTML PAGES
  const html = await fetchHTML(url);
  if (html.includes('cf-challenge') || html.includes('captcha-bypass') || html.includes('Cloudflare Ray ID')) {
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
    method: 'readability'
  };
}
