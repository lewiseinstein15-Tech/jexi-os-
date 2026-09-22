/**
 * JEXI OS — Phase 23 Scope B — live probe for forgejo-mcp 103-tool taxonomy.
 * Run from repo root: node scripts/phase23-forgejo-probe.mjs
 *
 * P1  taxonomy.list() -> total + per-category counts, sum to total
 * P2  tool specs by name -> shape, one per category (repo/issue/pr/org/admin)
 * P3  transport.dispatch('repo.list', {}) -> E_NO_FORGE_CONNECTION
 * P4  errors: E_UNKNOWN_CATEGORY, E_UNKNOWN_TOOL, E_MISSING_PARAM (before
 *     transport refusal), plus keyRef discipline checks
 * P5  determinism: list() twice -> byte-identical
 * P6  zone check: only harness/hardening/forgejo/** + scripts/phase23-*.mjs
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { taxonomy, TAXONOMY_TOTAL, CATEGORY_COUNTS, CATEGORIES, dispatch, createTransport, missingParams } from '../harness/hardening/forgejo/index.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass += 1; console.log('PASS ' + label); } else { fail += 1; console.log('FAIL ' + label); } };
const errOf = (fn) => { try { fn(); return null; } catch (e) { return e; } };

// ─────────────────────────────────────────────────────────────────────────────
// P1 — total count + per-category counts
// ─────────────────────────────────────────────────────────────────────────────
const all = taxonomy.list();
const counts = taxonomy.counts();
console.log('P1 category counts: ' + JSON.stringify(CATEGORY_COUNTS));
console.log('P1 total: ' + TAXONOMY_TOTAL + ' (taxonomy.counts().total=' + counts.total + ')');
const sum = CATEGORIES.reduce((acc, c) => acc + CATEGORY_COUNTS[c], 0);
console.log('P1 sum of categories: ' + sum);
ok(all.length === TAXONOMY_TOTAL && sum === TAXONOMY_TOTAL, 'P1 per-category counts sum to the total (' + sum + ' == ' + TAXONOMY_TOTAL + ')');
ok(TAXONOMY_TOTAL === 103, 'P1 taxonomy count is exactly 103 (actual: ' + TAXONOMY_TOTAL + ')');
ok(CATEGORIES.length === 5 && CATEGORIES.join(',') === 'repo,issue,pr,org,admin', 'P1 exactly 5 categories: repo, issue, pr, org, admin');
const sorted = [...all].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
ok(JSON.stringify(all) === JSON.stringify(sorted), 'P1 list() is sorted by name asc');
ok(all.every((t) => typeof t.name === 'string' && typeof t.category === 'string'), 'P1 every list entry is { name, category }');

// Shape audit over ALL specs: name, category, params[], description present; params well-formed
const allSpecs = CATEGORIES.flatMap((c) => taxonomy.category(c));
const shapeBad = allSpecs.filter((t) =>
  typeof t.name !== 'string' || !CATEGORIES.includes(t.category) ||
  !Array.isArray(t.params) || typeof t.description !== 'string' || t.description.trim() === '' ||
  t.params.some((p) => typeof p.name !== 'string' || typeof p.required !== 'boolean' || typeof p.type !== 'string')
);
ok(shapeBad.length === 0, 'P1 shape audit: all ' + allSpecs.length + ' specs have name, category, params[], description; every param has { name, required, type }');

// ─────────────────────────────────────────────────────────────────────────────
// P2 — tool specs by name, one per category
// ─────────────────────────────────────────────────────────────────────────────
const specRepo = taxonomy.get('repo.create');
const specIssue = taxonomy.get('issue.create');
const specPr = taxonomy.get('pr.merge');
const specOrg = taxonomy.get('org.create-team');
const specAdmin = taxonomy.get('admin.create-user');
console.log('P2 repo.create: ' + JSON.stringify(specRepo));
console.log('P2 issue.create: ' + JSON.stringify(specIssue));
console.log('P2 pr.merge: ' + JSON.stringify(specPr));
console.log('P2 org.create-team: ' + JSON.stringify(specOrg));
console.log('P2 admin.create-user: ' + JSON.stringify(specAdmin));
ok(specRepo.category === 'repo' && specIssue.category === 'issue' && specPr.category === 'pr' && specOrg.category === 'org' && specAdmin.category === 'admin', 'P2 one spec per category resolved via taxonomy.get');
ok(specRepo.params.every((p) => 'name' in p && 'required' in p && 'type' in p), 'P2 every param carries { name, required, type }');
ok(specRepo.params.find((p) => p.name === 'name').required === true && specRepo.params.find((p) => p.name === 'private').required === false, 'P2 required flags survive normalization (repo.create: name required, private optional)');
ok(specAdmin.params.find((p) => p.name === 'randomPassword') !== undefined && !specAdmin.params.some((p) => p.name === 'password'), 'P2 admin.create-user generates passwords server-side — no credential enters the tool surface');
ok(taxonomy.category('issue').length === CATEGORY_COUNTS.issue, 'P2 taxonomy.category(cat) returns the full category set');

// ─────────────────────────────────────────────────────────────────────────────
// P3 — sandbox dispatch refuses for every tool, no fake results
// ─────────────────────────────────────────────────────────────────────────────
// To prove the CONNECTION refusal, required params must be satisfied first —
// the brief mandates E_MISSING_PARAM before the transport refusal. Dummy args
// are built from each tool's own spec and never reach any network.
const DUMMY = { string: 'x', number: 1, boolean: true, array: [], object: {} };
const satisfiedArgs = (name) => {
  const args = {};
  for (const p of taxonomy.get(name).params) if (p.required) args[p.name] = DUMMY[p.type] ?? 'x';
  return args;
};

const d3 = dispatch('repo.list', {});
console.log('P3 dispatch(repo.list, {}): ' + JSON.stringify(d3));
ok(d3.ok === false && d3.error === 'E_NO_FORGE_CONNECTION', 'P3 dispatch(repo.list, {}) -> { ok: false, error: E_NO_FORGE_CONNECTION } (repo.list has no required params)');

// Every tool refuses identically in sandbox (spot sample across all 5 categories)
const samples = ['repo.get', 'issue.get', 'pr.merge', 'org.list-teams', 'admin.cron-run'];
const sampleResults = samples.map((n) => dispatch(n, satisfiedArgs(n)));
console.log('P3 spot results: ' + samples.map((n, i) => n + '->' + sampleResults[i].error).join(', '));
const allRefuse = sampleResults.every((r) => r.error === 'E_NO_FORGE_CONNECTION' && r.ok === false);
ok(allRefuse, 'P3 sandbox refusal is uniform across all 5 categories (spot: ' + samples.join(', ') + ')');

// Full sweep: every one of the 103 tools refuses with E_NO_FORGE_CONNECTION
const sweep = all.map((t) => dispatch(t.name, satisfiedArgs(t.name))).filter((r) => !(r.ok === false && r.error === 'E_NO_FORGE_CONNECTION'));
ok(sweep.length === 0, 'P3 full sweep: all ' + all.length + ' tools (required params satisfied) -> E_NO_FORGE_CONNECTION, zero faked results');

// ─────────────────────────────────────────────────────────────────────────────
// P4 — typed errors
// ─────────────────────────────────────────────────────────────────────────────
const e4a = errOf(() => taxonomy.category('nope'));
console.log('P4 category(nope) -> ' + (e4a ? e4a.code + ': ' + e4a.message : 'NOT THROWN'));
ok(e4a && e4a.code === 'E_UNKNOWN_CATEGORY' && e4a.name === 'SemanticaError', 'P4 unknown category -> E_UNKNOWN_CATEGORY');

const e4b = errOf(() => taxonomy.get('nope'));
console.log('P4 get(nope) -> ' + (e4b ? e4b.code + ': ' + e4b.message : 'NOT THROWN'));
ok(e4b && e4b.code === 'E_UNKNOWN_TOOL', 'P4 unknown tool -> E_UNKNOWN_TOOL');

const d4c = dispatch('repo.create', {});
console.log('P4 dispatch(repo.create, {}): ' + JSON.stringify(d4c));
ok(d4c.ok === false && d4c.error === 'E_MISSING_PARAM' && d4c.missingParam === 'name', 'P4 missing required param -> E_MISSING_PARAM naming the field (name)');
ok(d4c.error !== 'E_NO_FORGE_CONNECTION', 'P4 param validation happens BEFORE the transport refuses');

const d4d = dispatch('repo.update-file', { owner: 'o', repo: 'r', filepath: 'f', content: 'c', message: 'm' });
console.log('P4 dispatch(repo.update-file, partial): missingParam=' + d4d.missingParam + ' missing=' + JSON.stringify(d4d.missing));
ok(d4d.error === 'E_MISSING_PARAM' && d4d.missingParam === 'sha' && d4d.missing.join(',') === 'sha', 'P4 multiple-required-params case reports the full missing set, first field named');

const d4e = dispatch('does.not-exist', {});
ok(d4e.ok === false && d4e.error === 'E_UNKNOWN_TOOL', 'P4 dispatch with unknown tool name -> E_UNKNOWN_TOOL (returned shape, no throw)');

// keyRef discipline on transport config (Scope A alignment, read-only reuse)
const e4f = errOf(() => createTransport('http', { baseUrl: 'https://forge.example', token: 'inline-literal' }));
console.log('P4 inline token in transport config -> ' + (e4f ? e4f.code : 'NOT REFUSED'));
ok(e4f && e4f.code === 'E_INLINE_KEY_REFUSED', 'P4 inline credential in transport config -> E_INLINE_KEY_REFUSED');
const e4g = errOf(() => createTransport('http', { baseUrl: 'https://forge.example', keyRef: 'not-a-valid-ref' }));
console.log('P4 malformed keyRef -> ' + (e4g ? e4g.code : 'NOT REFUSED'));
ok(e4g && e4g.code === 'E_INVALID_KEY_REF', 'P4 malformed keyRef -> E_INVALID_KEY_REF (env-var or keyring:<ref> shapes only)');
const e4h = errOf(() => createTransport('carrier-pigeon', {}));
ok(e4h && e4h.code === 'E_UNKNOWN_TRANSPORT', 'P4 unknown transport kind -> E_UNKNOWN_TRANSPORT');
const httpT = createTransport('http', { baseUrl: 'https://forge.example', keyRef: 'FORGEJO_TOKEN' });
ok(httpT.dispatch('repo.list', {}).error === 'E_NO_FORGE_CONNECTION', 'P4 http transport with valid keyRef still refuses E_NO_FORGE_CONNECTION in sandbox');

// missingParams helper is directly assertable
const tool = taxonomy.get('issue.add-comment');
const mp = missingParams(tool, { owner: 'o' });
ok(mp.map((p) => p.name).join(',') === 'repo,index,body', 'P4 missingParams(issue.add-comment, { owner }) -> repo, index, body');

// ─────────────────────────────────────────────────────────────────────────────
// P5 — determinism: list() twice byte-identical
// ─────────────────────────────────────────────────────────────────────────────
const list1 = JSON.stringify(taxonomy.list());
const list2 = JSON.stringify(taxonomy.list());
console.log('P5 list() byte-identical: ' + (list1 === list2) + ' (' + list1.length + ' chars each)');
ok(list1 === list2, 'P5 list() twice -> byte-identical');
const cat1 = JSON.stringify(taxonomy.category('pr'));
const cat2 = JSON.stringify(taxonomy.category('pr'));
ok(cat1 === cat2, 'P5 category(pr) twice -> byte-identical');
const spec1 = JSON.stringify(taxonomy.get('repo.get-file'));
const spec2 = JSON.stringify(taxonomy.get('repo.get-file'));
ok(spec1 === spec2, 'P5 get(repo.get-file) twice -> byte-identical');

// ─────────────────────────────────────────────────────────────────────────────
// P6 — zone check
// ─────────────────────────────────────────────────────────────────────────────
const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' });
const touched = porcelain.split('\n').filter(Boolean).map((l) => l.slice(3).trim());
const zoneRe = /^(harness\/hardening\/forgejo\/|scripts\/phase23-)/;
const outside = touched.filter((p) => !zoneRe.test(p));
console.log('P6 touched paths:');
for (const p of touched) console.log('  ' + p + (zoneRe.test(p) ? '  [zone]' : '  [OUTSIDE ZONE]'));
ok(outside.length === 0, 'P6 zero paths outside the phase-23 zone (harness/hardening/forgejo/** + scripts/phase23-*.mjs); clean committed tree passes vacuously');

console.log('');
console.log('SCOPE B: ' + pass + '/' + (pass + fail) + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
