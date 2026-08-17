/**
 * JEXI OS — Universal Link Agent (B91).
 *
 * ANY link, ANY instruction: send a YouTube / TikTok / Instagram / Facebook
 * / Vimeo / article / website link and say what to do with it. JEXI:
 *
 *   1. CLASSIFY — video (youtube/tiktok/instagram/vimeo/direct file),
 *      social (facebook/x/linkedin), article (any other page).
 *   2. WATCH/READ — videos are analyzed frame-by-frame + full timestamped
 *      transcript (VideoAnalyzer); social posts are read via the real
 *      browser; articles/pages are deep-read (Readability).
 *   3. DO THE TASK — the user's instruction is applied to the extracted
 *      content by an LLM pass ("summarize it", "find the recipe",
 *      "what did he say about X at 2:30", "make a review"...).
 *   4. REPORT — structured { success, summary, sources } for the notifier
 *      and the live stream (link.start / link.classify / link.content /
 *      link.answer / done).
 *
 * Every dependency is injectable for tests; every failure degrades honestly.
 */

export function classifyLink(url) {
  const u = String(url || '').trim();
  if (!u) return { type: 'unknown' };
  try { new URL(u); } catch { return { type: 'invalid' }; }
  const host = u.toLowerCase();
  if (/youtube\.com|youtu\.be|tiktok\.com|instagram\.com|vimeo\.com/i.test(host)) return { type: 'video', platform: /youtube\.com|youtu\.be/.test(host) ? 'youtube' : /tiktok/.test(host) ? 'tiktok' : /instagram/.test(host) ? 'instagram' : 'vimeo' };
  if (/facebook\.com|fb\.watch|fb\.com|twitter\.com|x\.com|linkedin\.com|threads\.net|reddit\.com/i.test(host)) return { type: 'social', platform: 'social' };
  return { type: 'article' };
}

export class UniversalLinkAgent {
  /**
   * @param {object} deps
   * @param {function} [deps.analyzeVideo]  — (url, {sendEvent}) => Promise<{summary, transcript?, frames?}> (VideoAnalyzer.analyzeVideo)
   * @param {function} [deps.readPage]      — (url) => Promise<{title, text}> (Extractor.analyzeLink or browser)
   * @param {function} [deps.generateContent] — (prompt, system, image, opts) => Promise<string>
   */
  constructor(deps = {}) {
    this.analyzeVideo = deps.analyzeVideo || null;
    this.readPage = deps.readPage || null;
    this.generateContent = deps.generateContent || null;
  }

  async run({ url, instruction = '', sendEvent = () => {} }) {
    const emit = (t, d) => { try { sendEvent(t, d); } catch { /* noop */ } };
    const link = String(url || '').trim();
    const task = String(instruction || '').trim();
    emit('link.start', { url: link.slice(0, 200), instruction: task.slice(0, 200) });

    const cls = classifyLink(link);
    emit('link.classify', { type: cls.type, platform: cls.platform || null });
    if (cls.type === 'invalid') {
      return { success: false, error: 'invalid link', summary: '### ⚠ JEXI OS\n\nThat does not look like a valid link — please paste the full URL.' };
    }

    let content = null;
    let contentMeta = {};
    try {
      if (cls.type === 'video') {
        if (!this.analyzeVideo) throw new Error('video analysis unavailable');
        emit('link.content', { kind: 'video', note: 'watching frame-by-frame + reading the transcript…' });
        const v = await this.analyzeVideo(link, { sendEvent });
        content = (v && (v.summary || v.analysis || v.text)) || (v && v.transcript) || '';
        contentMeta = { kind: 'video', platform: cls.platform, frames: v && v.frames ? v.frames.length : 0, transcriptChars: String(v && v.transcript || '').length };
        emit('link.content-ready', { kind: 'video', chars: String(content).length, frames: contentMeta.frames });
      } else if (cls.type === 'social') {
        if (!this.readPage) throw new Error('browser reading unavailable');
        emit('link.content', { kind: 'social', note: 'opening in the browser…' });
        const p = await this.readPage(link);
        content = (p && p.text) || (p && p.content) || '';
        contentMeta = { kind: 'social', title: (p && p.title) || '' };
        emit('link.content-ready', { kind: 'social', chars: String(content).length });
      } else {
        if (!this.readPage) throw new Error('page reading unavailable');
        emit('link.content', { kind: 'article', note: 'deep-reading the page…' });
        const p = await this.readPage(link);
        content = (p && (p.content || p.text)) || '';
        contentMeta = { kind: 'article', title: (p && p.title) || '' };
        emit('link.content-ready', { kind: 'article', chars: String(content).length });
      }
    } catch (e) {
      emit('link.error', { error: (e && e.message) || String(e) });
      return {
        success: false,
        error: (e && e.message) || String(e),
        summary: `### ⚠ JEXI OS\n\nI could not read that link right now: ${(e && e.message) || 'unknown error'}. It may be a login-walled page, a live stream, or the browser is unavailable. Try the link in a normal browser, or share a different one.`,
      };
    }

    if (!content || String(content).trim().length < 20) {
      return { success: false, error: 'no readable content', summary: '### ⚠ JEXI OS\n\nI opened the link but found no readable content (login wall, empty page, or a live stream with no captions yet).' };
    }

    // Apply the instruction to the content.
    let summary = '';
    try {
      if (!this.generateContent) {
        summary = `### 🔗 Link — ${contentMeta.title || link.slice(0, 60)}\n\n${String(content).slice(0, 2000)}`;
      } else {
        const prompt =
          `The user shared this link and wants you to do the following with it:\n\nLINK: ${link}\nINSTRUCTION: ${task || 'summarize it'}\n\n` +
          (contentMeta.title ? `TITLE: ${contentMeta.title}\n` : '') +
          `CONTENT (${contentMeta.kind}, ~${String(content).length} chars):\n${String(content).slice(0, 12000)}\n\n` +
          `Do exactly what the instruction asks using ONLY this content. Be specific and cite what you saw/heard. ` +
          `If the instruction cannot be fully done from this content, say what is missing. Plain markdown, 2-6 short paragraphs.`;
        summary = String(await this.generateContent(prompt, 'You are JEXI OS, an autonomous agent.', null, { prefer: 'groq', temperature: 0.3 })).trim();
      }
    } catch {
      summary = `### 🔗 Link — ${contentMeta.title || link.slice(0, 60)}\n\n${String(content).slice(0, 2000)}`;
    }

    emit('link.answer', { chars: summary.length });
    emit('done', { success: true, summary });
    return { success: true, summary, meta: contentMeta, url: link };
  }
}

export const universalLinkAgent = new UniversalLinkAgent();
