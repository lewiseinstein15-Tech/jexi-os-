/** JEXI OS — Phase 28 Scope K — deterministic, dependency-free static HTML. */
import { SemanticaError } from '../../../services/semantica/_internal.js';

/** Declared behavior for any requested private page or fact: fail closed. */
export const PRIVATE_ID_BEHAVIOR = 'E_PRIVACY_VIOLATION';

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function canonicalPageId(page) {
  if (typeof page?.id === 'string' && page.id !== '') return page.id;
  if (typeof page?.kind === 'string' && typeof page?.slug === 'string') return `${page.kind}/${page.slug}`;
  if (typeof page?.slug === 'string' && page.slug !== '') return page.slug;
  return '(unknown-page)';
}

export function isPrivate(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.private === true || value.public === false) return true;
  for (const field of ['privacy', 'visibility', 'access']) {
    if (typeof value[field] === 'string' && value[field].trim().toLowerCase() === 'private') return true;
  }
  if (Array.isArray(value.tags) && value.tags.some((tag) => String(tag).trim().toLowerCase() === 'private')) return true;
  return value.frontmatter === value ? false : isPrivate(value.frontmatter);
}

function privacyViolation(page, part) {
  const id = canonicalPageId(page);
  throw new SemanticaError(PRIVATE_ID_BEHAVIOR, `refusing to render private ${part} from page ${id}`);
}

/** Privacy is checked here, immediately before bytes are rendered. */
function assertRenderable(page) {
  if (isPrivate(page)) privacyViolation(page, 'page');
  for (const field of ['facts', 'compiledFacts', 'timeline', 'citations']) {
    const values = page[field];
    if (!Array.isArray(values)) continue;
    if (values.some((value) => isPrivate(value))) privacyViolation(page, field.slice(0, -1) || field);
  }
}

function safeHref(value) {
  const href = String(value).trim();
  return /^(https?:\/\/|mailto:|#|\/(?!\/)|\.\.?\/)/i.test(href) ? href : null;
}

/** Escape all text first; only explicitly safe citation syntax becomes anchors. */
export function renderInline(value) {
  const text = String(value ?? '');
  // Accepted forms: Markdown [label](url) and brain [Source: https://…].
  const pattern = /\[([^\]\n]+)\]\(([^)\n]+)\)|\[Source:\s*(https?:\/\/[^\]\s]+)\]/gi;
  let html = '';
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    html += escapeHtml(text.slice(cursor, match.index));
    if (match[3] !== undefined) {
      const href = safeHref(match[3]);
      html += href
        ? `[Source: <a href="${escapeHtml(href)}" rel="noopener noreferrer">${escapeHtml(href)}</a>]`
        : escapeHtml(match[0]);
    } else {
      const href = safeHref(match[2]);
      html += href
        ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${escapeHtml(match[1])}</a>`
        : escapeHtml(match[0]);
    }
    cursor = match.index + match[0].length;
  }
  return html + escapeHtml(text.slice(cursor));
}

function paragraphs(value) {
  const text = String(value ?? '').trim();
  if (text === '') return '<p class="empty">(none)</p>';
  return text.split(/\n{2,}/).map((paragraph) =>
    `<p>${renderInline(paragraph).replace(/\n/g, '<br>')}</p>`).join('\n');
}

function pageAnchor(id) {
  const safe = String(id).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return `page-${safe || 'untitled'}`;
}

function citationParts(citation) {
  if (typeof citation === 'string') return { label: citation, href: citation };
  if (!citation || typeof citation !== 'object') return { label: String(citation), href: null };
  const label = citation.label ?? citation.title ?? citation.name ?? citation.url ?? citation.href ?? citation.pageId ?? 'Citation';
  const href = citation.url ?? citation.href ?? (citation.pageId ? `#${pageAnchor(citation.pageId)}` : null);
  return { label: String(label), href: href === null ? null : String(href) };
}

function renderCitations(citations) {
  if (!Array.isArray(citations) || citations.length === 0) return '';
  const items = citations.map((citation) => {
    const { label, href } = citationParts(citation);
    const safe = href === null ? null : safeHref(href);
    return `<li>${safe
      ? `<a href="${escapeHtml(safe)}" rel="noopener noreferrer">${escapeHtml(label)}</a>`
      : escapeHtml(label)}</li>`;
  }).join('\n');
  return `<section class="citations" aria-labelledby="citations-heading">
<h3 id="citations-heading">Citations</h3>
<ul>${items}</ul>
</section>`;
}

function factText(fact) {
  if (typeof fact === 'string') return fact;
  if (!fact || typeof fact !== 'object') return String(fact);
  return fact.fact ?? fact.text ?? fact.statement ?? fact.value ?? '';
}

function renderFacts(facts) {
  if (!Array.isArray(facts) || facts.length === 0) return '';
  return `<section class="facts">
<h3>Facts</h3>
<ul>${facts.map((fact) => `<li>${renderInline(factText(fact))}</li>`).join('\n')}</ul>
</section>`;
}

function renderTimeline(timeline) {
  if (typeof timeline === 'string') return paragraphs(timeline);
  if (!Array.isArray(timeline) || timeline.length === 0) return '<p class="empty">(empty)</p>';
  const ordered = timeline.map((entry, index) => ({ entry, index })).sort((a, b) => {
    const aw = String(a.entry?.when ?? '');
    const bw = String(b.entry?.when ?? '');
    if (aw !== bw) return aw < bw ? -1 : 1;
    const as = Number.isInteger(a.entry?.seq) ? a.entry.seq : a.index;
    const bs = Number.isInteger(b.entry?.seq) ? b.entry.seq : b.index;
    return as - bs || a.index - b.index;
  });
  const rows = ordered.map(({ entry }) => {
    if (typeof entry === 'string') return `<li>${renderInline(entry)}</li>`;
    const when = String(entry?.when ?? '');
    const text = entry?.entry ?? entry?.text ?? entry?.fact ?? '';
    const date = when === '' ? '' : `<time datetime="${escapeHtml(when)}">${escapeHtml(when)}</time>`;
    return `<li>${date}${date && text !== '' ? ': ' : ''}${renderInline(text)}</li>`;
  }).join('\n');
  return `<ol class="timeline">${rows}</ol>`;
}

export function renderPage(page) {
  if (!page || typeof page !== 'object') {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'publisher page must be an object');
  }
  assertRenderable(page);
  const id = canonicalPageId(page);
  const title = typeof page.title === 'string' && page.title !== '' ? page.title : id;
  const truth = page.compiledTruth ?? page.compiled_truth ?? '';
  return `<article id="${pageAnchor(id)}" data-page-id="${escapeHtml(id)}">
<header><p class="kind">${escapeHtml(page.kind ?? 'page')}</p><h2>${escapeHtml(title)}</h2></header>
<section class="compiled-truth">
<h3>Compiled Truth</h3>
${paragraphs(truth)}
</section>
<section class="timeline-section">
<h3>Timeline</h3>
${renderTimeline(page.timeline)}
</section>
${renderFacts(page.facts)}
${renderCitations(page.citations)}
</article>`;
}

const CSS = `
:root { color-scheme: light dark; --bg:#f7f5f1; --card:#fff; --ink:#24211d; --muted:#6f675e; --line:#d8d0c5; --link:#175fa6; --accent:#8b4f18; }
@media (prefers-color-scheme:dark) { :root { --bg:#171513; --card:#211e1b; --ink:#f4eee7; --muted:#b8aea3; --line:#4a423a; --link:#79b9ff; --accent:#ffb56b; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif; }
main { width:min(900px,calc(100% - 2rem)); margin:2rem auto 4rem; }
.site-header { margin-bottom:1.5rem; }
h1,h2,h3 { line-height:1.2; }
h1 { margin:.2rem 0; font-size:clamp(1.8rem,4vw,2.8rem); }
.dek,.kind,.empty { color:var(--muted); }
.dek { max-width:70ch; }
article { background:var(--card); border:1px solid var(--line); border-radius:14px; margin:1rem 0; padding:clamp(1rem,4vw,2rem); box-shadow:0 8px 28px #00000010; }
article h2 { margin:.2rem 0 1.4rem; }
article h3 { color:var(--accent); margin:1.4rem 0 .6rem; }
.kind { margin:0; font-size:.8rem; font-weight:700; letter-spacing:.09em; text-transform:uppercase; }
a { color:var(--link); text-underline-offset:.15em; overflow-wrap:anywhere; }
.timeline { padding-left:1.4rem; }
time { font-variant-numeric:tabular-nums; font-weight:650; }
`;

/** Rendering has no clocks, randomness, network access, or output-path data. */
export function renderDocument(pages, { title = 'JEXI Brain Publication' } = {}) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'publisher requires at least one page');
  }
  const body = pages.map(renderPage).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<header class="site-header"><p class="kind">Static brain export</p><h1>${escapeHtml(title)}</h1><p class="dek">Compiled truth, dated timeline evidence, and citation links for the selected public pages.</p></header>
${body}
</main>
</body>
</html>
`;
}
