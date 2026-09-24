/**
 * JEXI OS — Phase 8 Scope A: PHASE 2/5 — RECON (live app exploration).
 *
 * Shannon phase 2. Maps the RUNNING application over real HTTP: pages,
 * links, forms, query parameters, response headers, technology signals,
 * and the presence/absence of security headers. Produces the live-app map
 * that the vulnerability agents drive their probes from.
 *
 * Contract:
 *   id:      'recon'
 *   inputs:  ['target.baseUrl']
 *   outputs: ['artifacts/recon.json', 'artifacts/recon.md']
 */

import * as store from '../orchestration/checkpoint.js';
import { pipelineGraph, recordTarget } from '../../../mind/knowledge/index.js';
import { gatePhase } from '../../engagements/validator.js'; // Phase 8(D): RoE gate

const MAX_PAGES = 16;
const TIMEOUT_MS = 4000;

export const phase = {
  id: 'recon',
  inputs: ['target.baseUrl'],
  outputs: ['artifacts/recon.json', 'artifacts/recon.md'],

  async *run(ctx) {
    yield* gatePhase(ctx, 'scan'); // Phase 8(D): validate this action vs the engagement RoE — refusal HALTS
    const baseUrl = String(ctx.baseUrl || '').replace(/\/$/, '');
    if (!/^https?:\/\//.test(baseUrl)) throw new Error(`recon: baseUrl must be http(s): ${ctx.baseUrl}`);

    yield { type: 'log', data: { message: `exploring live app at ${baseUrl} (max ${MAX_PAGES} pages)` } };

    const seen = new Set();
    const queue = ['/'];
    const pages = [];
    const forms = [];
    let firstHeaders = null;

    while (queue.length && seen.size < MAX_PAGES) {
      const urlPath = queue.shift();
      if (seen.has(urlPath)) continue;
      seen.add(urlPath);

      const res = await fetchOk(baseUrl + urlPath);
      if (!res) {
        yield { type: 'log', data: { message: `${urlPath} — unreachable, recorded as dead link` } };
        pages.push({ path: urlPath, status: 0, error: 'unreachable' });
        continue;
      }
      const body = await res.text();

      if (!firstHeaders) firstHeaders = res.headers;

      const links = extractLinks(body).filter((l) => l.startsWith('/') && !seen.has(l));
      for (const l of links) if (queue.length + seen.size < MAX_PAGES) queue.push(l);

      for (const f of extractForms(body, urlPath)) forms.push(f);

      const securityHeaders = auditHeaders(res.headers);
      pages.push({
        path: urlPath,
        status: res.status,
        contentType: res.headers.get('content-type') || '(none)',
        bytes: body.length,
        linksFound: links,
        securityHeaders,
        serverBanner: res.headers.get('server') || '(none)',
        setCookie: res.headers.get('set-cookie') || null,
        excerpt: body.replace(/\s+/g, ' ').slice(0, 140),
      });
      yield {
        type: 'progress',
        data: {
          message: `${urlPath} → ${res.status} (${body.length}b) links:[${links.join(', ') || '-'}] headers:${securityHeaders.present.length || 'none'}`,
        },
      };
    }

    const technologies = inferTechnologies(firstHeaders, pages);
    const artifact = {
      phase: 'recon',
      generatedAt: new Date().toISOString(),
      baseUrl,
      pagesVisited: pages.length,
      pages,
      forms,
      technologies,
      headerAudit: firstHeaders ? auditHeaders(firstHeaders) : null,
    };

    const jsonPath = store.writeArtifact(ctx.stateRoot, ctx.engagementId, 'recon.json', artifact);
    const mdPath = store.writeArtifact(ctx.stateRoot, ctx.engagementId, 'recon.md', renderMd(artifact));

    // Phase 8(C): findings persist to the KNOWLEDGE GRAPH — the crawled target
    // becomes Host + Service + connects-to edge (idempotent; the ids feed
    // exploitation's graph writes). The artifact flow above is untouched:
    // the graph is an additional persistence layer running in parallel.
    let graphRefs = null;
    try {
      const graph = pipelineGraph(ctx);
      try {
        const t = recordTarget(graph, { url: baseUrl, banner: firstHeaders ? firstHeaders.get('server') : null });
        graphRefs = { hostId: t.host.id, serviceId: t.service.id };
        yield { type: 'log', data: { message: `knowledge graph: host ${t.host.id} + service ${t.service.id} persisted (connects-to)` } };
      } finally {
        graph.close();
      }
    } catch (err) {
      yield { type: 'log', data: { message: `knowledge graph unavailable (artifact flow unaffected): ${err.message}` } };
    }
    if (ctx.checkpoint && graphRefs) {
      ctx.checkpoint.partial = { ...(ctx.checkpoint.partial || {}), graphRefs };
      store.saveCheckpoint(ctx.stateRoot, ctx.engagementId, ctx.checkpoint);
    }

    yield { type: 'progress', data: { message: `map complete: ${pages.length} pages, ${forms.length} forms, tech=[${technologies.join(', ')}]` } };
    yield { type: 'artifact', data: { path: jsonPath, kind: 'live-app-map' } };
    yield { type: 'artifact', data: { path: mdPath, kind: 'live-app-map' } };
  },

  /** Recon is a deterministic read-only crawl — safe to re-run wholesale. */
  async *resume(checkpointId, ctx) {
    yield { type: 'log', data: { message: `resume(${checkpointId}): re-crawling (read-only, idempotent)` } };
    yield* this.run(ctx);
  },
};

async function fetchOk(url) {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual' });
  } catch (err) {
    return null;
  }
}

function extractLinks(body) {
  const out = [];
  const re = /(?:href|src)=["']([^"'#]+)/g;
  let m;
  while ((m = re.exec(body))) {
    const l = m[1];
    if (l.startsWith('/') && !/\.(css|js|png|jpg|svg|ico|woff2?)($|\?)/.test(l)) out.push(l);
  }
  return [...new Set(out)];
}

function extractForms(body, pagePath) {
  const out = [];
  const re = /<form([^>]*)>([\s\S]*?)<\/form>/gi;
  let m;
  while ((m = re.exec(body))) {
    const attrs = m[1];
    const inner = m[2];
    const action = (attrs.match(/action=["']([^"']*)/i) || [])[1] || pagePath;
    const method = ((attrs.match(/method=["']([^"']*)/i) || [])[1] || 'GET').toUpperCase();
    const inputs = [...inner.matchAll(/<input[^>]*name=["']([^"']*)["'][^>]*type=["']([^"']*)["']|<input[^>]*type=["']([^"']*)["'][^>]*name=["']([^"']*)["']/gi)]
      .map((x) => ({ name: x[1] || x[4], type: x[2] || x[3] }));
    out.push({ page: pagePath, action, method, inputs });
  }
  return out;
}

const SEC_HEADERS = ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'strict-transport-security', 'referrer-policy'];

function auditHeaders(headers) {
  const present = [];
  const absent = [];
  for (const h of SEC_HEADERS) {
    if (headers && headers.get(h)) present.push(h);
    else absent.push(h);
  }
  return { present, absent };
}

function inferTechnologies(firstHeaders, pages) {
  const tech = [];
  const banner = firstHeaders && firstHeaders.get('server');
  if (banner) tech.push(`server-banner:${banner}`);
  const ct = firstHeaders && firstHeaders.get('content-type');
  if (ct && ct.includes('text/html')) tech.push('server-rendered-html');
  if (pages.some((p) => (p.setCookie || '').length)) tech.push('cookies-in-use');
  return tech;
}

function renderMd(a) {
  const lines = [
    `# Recon — live app map: ${a.baseUrl}`,
    ``,
    `Generated: ${a.generatedAt}`,
    ``,
    `Technologies: ${a.technologies.join(', ') || '(none detected)'}`,
    ``,
    `## Pages (${a.pagesVisited})`,
    ``,
    `| path | status | bytes | server | security headers present |`,
    `|------|--------|-------|--------|--------------------------|`,
    ...a.pages.map((p) => `| ${p.path} | ${p.status} | ${p.bytes ?? '-'} | ${p.serverBanner || '-'} | ${(p.securityHeaders && p.securityHeaders.present.join(', ')) || 'NONE'} |`),
    ``,
    `## Forms (${a.forms.length})`,
    ``,
    ...a.forms.map((f) => `- ${f.method} ${f.action} inputs: ${f.inputs.map((i) => `${i.name}(${i.type})`).join(', ') || '(none)'}`),
    ``,
    `## Header audit (first response)`,
    ``,
    `- present: ${a.headerAudit ? a.headerAudit.present.join(', ') || 'NONE' : '-'}`,
    `- absent: ${a.headerAudit ? a.headerAudit.absent.join(', ') : '-'}`,
    ``,
  ];
  return lines.join('\n');
}

export default phase;
