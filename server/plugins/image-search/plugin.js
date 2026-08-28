/**
 * JEXI OS — Image Search Plugin (B169).
 * Gives the presenter REAL pictures: image_search over Wikimedia Commons
 * (free, no key). The model embeds results as markdown images
 * ![title](thumb) so the answer SHOWS the thing.
 */

import { imageSearch } from '../../src/services/ImageSearch.js';

export const name = 'image-search';
export const version = '1.0.0';
export const inject = ['tools'];

export async function apply(ctx) {
  const unregister = ctx.tools.register({
    slug: 'image_search',
    name: 'Image Search',
    desc: 'Find real photos/diagrams of anything (Wikimedia Commons, free). Use when the user asks to SEE or SHOW something ("show me a picture of X", "what does Y look like") or when a diagram/image would explain better. Returns image URLs — embed them in your answer as markdown: ![title](thumbnail-url)',
    args: {
      query: { type: 'string', required: true, desc: 'what to find a picture of' },
      limit: { type: 'number', required: false, desc: 'how many (default 3, max 6)' },
    },
    handler: async (a) => imageSearch(a.query, { limit: Math.min(6, Number(a.limit) || 3) }),
  });
  return unregister;
}
