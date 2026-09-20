/**
 * JEXI OS — Phase 22 Scope F — live probe for the forge-agnostic dispatcher.
 *
 *   node scripts/phase22-f-probe.mjs
 *
 * Probes the crab'd pattern end to end with real JSON parsing and real
 * capability-driven routing. NO network call is made to any forge: `respond()`
 * is a declared stub, and P8 asserts that it stays labeled unverified.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import * as forge from '../harness/forge/index.js';
import {
  ForgeError,
  parse,
  dispatch,
  eventShape,
  assertVendor,
  normalizeEvent,
  stubDelivery,
} from '../harness/forge/index.js';
import forgejo from '../harness/forge/forgejo.vendor.js';
import github from '../harness/forge/github.vendor.js';

let failures = 0;
const pass = (id, msg) => console.log(`${id}: PASS — ${msg}`);
const fail = (id, msg) => { failures += 1; console.log(`${id}: FAIL — ${msg}`); };

function verdict(id, ok, msg) { (ok ? pass : fail)(id, msg); }

function header(id, title) {
  console.log(`\n${'═'.repeat(58)}`);
  console.log(`${id} — ${title}`);
  console.log('═'.repeat(58));
}

const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

/* ── fixtures: raw forge payloads, in each forge's real shape ───────────── */

/** GitHub mention: `author_association` is where GitHub states the trust tier. */
const GH_MENTION_RAW = {
  eventName: 'issue_comment',
  payload: {
    action: 'created',
    repository: { name: 'jexi-os-', full_name: 'acme/jexi-os-', owner: { login: 'acme' }, default_branch: 'main' },
    sender: { login: 'alice', type: 'User' },
    comment: { id: 501, body: '@claude do X', user: { login: 'alice' }, author_association: 'MEMBER' },
    issue: { number: 41, title: 'Wire the dispatcher', body: 'please', user: { login: 'alice' } },
  },
};

/** Forgejo issue: `permission` (owner/admin/write/read) instead of an association. */
const FJ_ISSUE_RAW = {
  eventName: 'issues',
  payload: {
    action: 'opened',
    repository: { name: 'jexi-os-', full_name: 'acme/jexi-os-', owner: { login: 'acme' }, default_branch: 'main' },
    sender: { login: 'bob', type: 'User', permission: 'write' },
    issue: { number: 42, title: 'Add a Forgejo vendor', body: 'implement this', user: { login: 'bob' }, permission: 'write' },
  },
};

/** Forgejo PR: parseable, but Forgejo cannot dispatch a review run for it. */
const FJ_PR_RAW = {
  eventName: 'pull_request',
  payload: {
    action: 'opened',
    repository: { name: 'jexi-os-', full_name: 'acme/jexi-os-', owner: { login: 'acme' } },
    sender: { login: 'carol', type: 'User', permission: 'admin' },
    pull_request: { number: 43, title: 'Scope F', body: 'diff', user: { login: 'carol' }, permission: 'admin', draft: false, head: { ref: 'scope-f' } },
  },
};

/** The same PR payload as a GitHub event — same JSON shape, reviewable. */
const GH_PR_RAW = { eventName: 'pull_request', payload: FJ_PR_RAW.payload };

/** Forgejo reusable workflow: reports `workflow_call`, so kind must come from the payload. */
const FJ_WORKFLOW_CALL_RAW = {
  eventName: 'workflow_call',
  payload: {
    action: 'created',
    repository: { name: 'jexi-os-', full_name: 'acme/jexi-os-', owner: { login: 'acme' } },
    sender: { login: 'dave', type: 'User', permission: 'owner' },
    comment: { id: 900, body: '@claude review this', user: { login: 'dave' }, permission: 'owner' },
    issue: { number: 44, title: 'From a reusable workflow', body: '', permission: 'owner' },
  },
};

/* ── P1: GitHub mention -> reply ────────────────────────────────────────── */

function P1() {
  header('P1', 'GitHub mention -> normalized event + action=reply');

  const event = parse('github', GH_MENTION_RAW);
  console.log('normalized event:');
  console.log(JSON.stringify(event, null, 2));
  console.log(`eventShape keys: ${JSON.stringify(eventShape(event))}`);

  const routed = dispatch.onMention(event);
  console.log(`dispatch.onMention -> ${JSON.stringify(routed)}`);

  verdict('P1',
    event.forge === 'github'
      && event.kind === 'mention'
      && event.permission === 'write'
      && event.actor.login === 'alice'
      && event.repo.slug === 'acme/jexi-os-'
      && event.body === '@claude do X'
      && event.number === 41
      && routed.action === 'reply'
      && routed.task.vendor === 'github'
      && routed.task.permission === 'write',
    `forge=${event.forge} kind=${event.kind} permission=${event.permission} actor=${event.actor.login} repo=${event.repo.slug} -> action=${routed.action}`);
}

/* ── P2: Forgejo issue -> implement, same shape as P1 ───────────────────── */

function P2() {
  header('P2', 'Forgejo issue -> normalized event + action=implement; shape matches P1');

  const event = parse('forgejo', FJ_ISSUE_RAW);
  console.log('normalized event:');
  console.log(JSON.stringify(event, null, 2));
  console.log(`eventShape keys: ${JSON.stringify(eventShape(event))}`);

  const routed = dispatch.onIssue(event);
  console.log(`dispatch.onIssue -> ${JSON.stringify(routed)}`);

  const ghEvent = parse('github', GH_MENTION_RAW);
  const sameShape = JSON.stringify(eventShape(event)) === JSON.stringify(eventShape(ghEvent));
  console.log(`shape equal to GitHub event (same keys): ${sameShape}`);

  verdict('P2',
    event.forge === 'forgejo'
      && event.kind === 'issue'
      && event.permission === 'write'
      && routed.action === 'implement'
      && routed.task.vendor === 'forgejo'
      && sameShape,
    `forge=${event.forge} kind=${event.kind} permission=${event.permission} -> action=${routed.action}; same keys as P1=${sameShape}`);
}

/* ── P2b: Forgejo PR -> capability gap, driven by capabilities ─────────── */

function P2b() {
  header('P2b', 'Forgejo PR -> E_FORGE_CAPABILITY_GAP; same event via GitHub -> review');

  const fjEvent = parse('forgejo', FJ_PR_RAW);
  console.log(`forgejo capabilities: ${JSON.stringify(forgejo.capabilities)}`);
  console.log(`github  capabilities: ${JSON.stringify(github.capabilities)}`);

  const refused = dispatch.onPR(fjEvent);
  console.log(`dispatch.onPR(forgejo event) -> ${JSON.stringify(refused)}`);

  // Same JSON shape, parsed by the GitHub vendor, is reviewable.
  const ghEvent = parse('github', GH_PR_RAW);
  const allowed = dispatch.onPR(ghEvent);
  console.log(`dispatch.onPR(same payload as github) -> ${JSON.stringify(allowed)}`);

  // Prove the gate is the capability flag, not the forge's name.
  //
  // The double must be a genuinely distinct vendor: spreading forgejo's module
  // namespace would keep forgejo's parseEvent, which closes over forgejo's own
  // `name` and stamps `forge: 'forgejo'` regardless of what we override here —
  // so the dispatcher would resolve the real forgejo and the test would prove
  // nothing. This builds its own parseEvent that stamps its own name.
  const reviewCapable = {
    name: 'forgejo-can-review',
    capabilities: { ...forgejo.capabilities, canReviewPR: true },
    parseEvent(raw) {
      const base = forgejo.parseEvent(raw);
      const { forge: _ignored, ...rest } = base;
      return normalizeEvent({ ...rest, forge: 'forgejo-can-review' });
    },
    respond: forgejo.respond,
    assert() { return assertVendor(reviewCapable); },
  };

  let flipped;
  try {
    dispatch.registerVendor(reviewCapable);
    console.log(`registered test vendor; known: ${dispatch.listVendors().join(', ')}`);
    const ev = reviewCapable.parseEvent(FJ_PR_RAW);
    console.log(`test vendor parsed forge=${ev.forge} kind=${ev.kind}`);
    flipped = dispatch.onPR(ev);
    console.log(`same payload, vendor with canReviewPR=true -> ${JSON.stringify(flipped)}`);
  } finally {
    dispatch.unregisterVendor('forgejo-can-review');
  }

  // The refusal object also carries `action: 'review'` (the action it refused),
  // so a successful review must be told apart by `unsupported`, not by action.
  const gatedByCapability = refused.unsupported === true
    && refused.reason === 'E_FORGE_CAPABILITY_GAP'
    && refused.capability === 'canReviewPR'
    && flipped.unsupported !== true
    && flipped.action === 'review'
    && allowed.action === 'review';

  verdict('P2b',
    gatedByCapability,
    `forgejo PR refused (capability=${refused.capability}); a vendor differing ONLY in canReviewPR reviews the same payload (unsupported=${flipped.unsupported}) -> gate reads the flag, not the name`);
}

/* ── P3: error codes ────────────────────────────────────────────────────── */

function P3() {
  header('P3', 'E_UNKNOWN_VENDOR / E_UNKNOWN_KIND / E_VENDOR_INCOMPLETE');

  const results = {};

  try { parse('gitlab', GH_MENTION_RAW); results.unknownVendor = null; }
  catch (e) { results.unknownVendor = e; }
  console.log(`parse unknown vendor -> ${results.unknownVendor && JSON.stringify({ code: results.unknownVendor.code, reason: results.unknownVendor.reason })}`);

  // An unrecognizable payload normalizes to kind 'unknown'; dispatch refuses.
  const unknownKindEvent = parse('forgejo', { eventName: 'repository', payload: { action: 'ping', repository: { name: 'x', owner: { login: 'x' } } } });
  console.log(`unrecognized payload normalized kind -> ${unknownKindEvent.kind}`);
  try { dispatch.route(unknownKindEvent); results.unknownKind = null; }
  catch (e) { results.unknownKind = e; }
  console.log(`dispatch unknown kind -> ${results.unknownKind && JSON.stringify({ code: results.unknownKind.code, reason: results.unknownKind.reason })}`);

  // A vendor missing respond() must fail at registration time.
  try {
    assertVendor({ name: 'broken', capabilities: { canReviewPR: true, canImplementIssue: true, canReplyToMention: true, authStyle: 'none', kindSource: 'header' }, parseEvent: () => {}, assert: () => {} });
    results.incomplete = null;
  } catch (e) { results.incomplete = e; }
  console.log(`vendor missing respond() -> ${results.incomplete && JSON.stringify({ code: results.incomplete.code, reason: results.incomplete.reason })}`);

  // A vendor missing capabilities must also fail.
  let missingCaps = null;
  try {
    assertVendor({ name: 'nocaps', parseEvent: () => {}, respond: () => {}, assert: () => {} });
  } catch (e) { missingCaps = e; }
  console.log(`vendor missing capabilities -> ${missingCaps && missingCaps.code}`);

  verdict('P3',
    results.unknownVendor?.code === 'E_UNKNOWN_VENDOR'
      && results.unknownKind?.code === 'E_UNKNOWN_KIND'
      && results.incomplete?.code === 'E_VENDOR_INCOMPLETE'
      && missingCaps?.code === 'E_VENDOR_INCOMPLETE'
      && unknownKindEvent.kind === 'unknown',
    'all three codes raised with specific messages, unknown kind refused not dropped');
}

/* ── P4: cross-vendor consistency ───────────────────────────────────────── */

function P4() {
  header('P4', 'same logical mention via GitHub and Forgejo -> identical shape + permission');

  // The same logical event: a mention by a write-level collaborator.
  // Each forge spells the trust tier its own way.
  const ghMention = {
    eventName: 'issue_comment',
    payload: {
      action: 'created',
      repository: { name: 'jexi-os-', full_name: 'acme/jexi-os-', owner: { login: 'acme' } },
      sender: { login: 'alice', type: 'User' },
      comment: { id: 1, body: '@claude do X', user: { login: 'alice' }, author_association: 'COLLABORATOR' },
      issue: { number: 41, title: 'T', body: 'B' },
    },
  };
  const fjMention = {
    eventName: 'issue_comment',
    payload: {
      action: 'created',
      repository: { name: 'jexi-os-', full_name: 'acme/jexi-os-', owner: { login: 'acme' } },
      sender: { login: 'alice', type: 'User', permission: 'write' },
      comment: { id: 1, body: '@claude do X', user: { login: 'alice' }, permission: 'write' },
      issue: { number: 41, title: 'T', body: 'B' },
    },
  };

  const gh = parse('github', ghMention);
  const fj = parse('forgejo', fjMention);

  console.log(`github  -> kind=${gh.kind} permission=${gh.permission} actor=${gh.actor.login} body="${gh.body}"`);
  console.log(`forgejo -> kind=${fj.kind} permission=${fj.permission} actor=${fj.actor.login} body="${fj.body}"`);
  const shapeEqual = JSON.stringify(eventShape(gh)) === JSON.stringify(eventShape(fj));
  console.log(`eventShape identical: ${shapeEqual}`);

  // Compare every field the PARSER derives. `forge` differs by design (each
  // vendor stamps its own name) and `raw` is the caller's input object — the
  // two fixtures legitimately spell the permission differently, so comparing
  // `raw` would be testing the fixture rather than the parser.
  const strip = (e) => { const { forge: _f, raw: _r, ...rest } = e; return rest; };
  const fieldsEqual = JSON.stringify(strip(gh)) === JSON.stringify(strip(fj));
  console.log(`all parsed fields (excluding forge name and raw input) identical: ${fieldsEqual}`);

  verdict('P4',
    shapeEqual && fieldsEqual
      && gh.permission === 'write' && fj.permission === 'write'
      && gh.kind === fj.kind && gh.body === fj.body && gh.actor.login === fj.actor.login,
    `COLLABORATOR -> ${gh.permission} and write -> ${fj.permission} land on the same value; identical shape=${shapeEqual}, identical fields=${fieldsEqual}`);
}

/* ── P5: routing table ──────────────────────────────────────────────────── */

function P5() {
  header('P5', 'routing table: mention->reply, PR->review, issue->implement, Forgejo PR->unsupported');

  const rows = [
    ['mention -> reply', () => dispatch.onMention(parse('github', GH_MENTION_RAW))],
    ['pr -> review (github)', () => dispatch.onPR(parse('github', GH_PR_RAW))],
    ['pr -> unsupported (forgejo)', () => dispatch.onPR(parse('forgejo', FJ_PR_RAW))],
    ['issue -> implement', () => dispatch.onIssue(parse('forgejo', FJ_ISSUE_RAW))],
  ];

  const got = {};
  for (const [label, fn] of rows) {
    const r = fn();
    got[label] = r;
    console.log(`${label.padEnd(30)} -> ${r.unsupported ? `unsupported (${r.reason})` : `action=${r.action}`}`);
  }

  verdict('P5',
    got['mention -> reply'].action === 'reply'
      && got['pr -> review (github)'].action === 'review'
      && got['pr -> unsupported (forgejo)'].unsupported === true
      && got['pr -> unsupported (forgejo)'].reason === 'E_FORGE_CAPABILITY_GAP'
      && got['issue -> implement'].action === 'implement',
    'all four paths through one dispatcher; capability gap refused, not silently re-routed');
}

/* ── P6: determinism ────────────────────────────────────────────────────── */

function P6() {
  header('P6', 'same raw event twice -> byte-identical event + task');

  const a = parse('github', GH_MENTION_RAW);
  const b = parse('github', GH_MENTION_RAW);
  const ra = dispatch.onMention(a);
  const rb = dispatch.onMention(b);

  // `raw` is excluded from the digest: it is the caller's input object, not
  // something the parser derives, so hashing it would test the fixture.
  const stripRaw = (e) => { const { raw: _r, ...rest } = e; return rest; };

  const rows = [
    ['normalized event', sha(stripRaw(a)), sha(stripRaw(b))],
    ['dispatched task', sha(ra), sha(rb)],
  ];
  let allEqual = true;
  for (const [label, x, y] of rows) {
    const eq = x === y;
    allEqual = allEqual && eq;
    console.log(`${label.padEnd(18)} A=${x}  B=${y}  ${eq ? 'IDENTICAL' : 'DIFFERENT'}`);
  }

  // The raw payload survives verbatim on the event for callers that need it.
  console.log(`raw payload preserved verbatim: ${JSON.stringify(a.raw) === JSON.stringify(GH_MENTION_RAW)}`);

  verdict('P6',
    allEqual && a.forge === b.forge,
    'byte-identical normalized event and byte-identical dispatched task');
}

/* ── P8: stub delivery is labeled unverified ────────────────────────────── */

function P8() {
  header('P8', 'stubbed delivery is labeled NOT VERIFIED, not faked');

  const r = github.respond({ action: 'reply' });
  console.log(`github.respond -> ${JSON.stringify(r)}`);
  const rf = forgejo.respond({ action: 'implement' });
  console.log(`forgejo.respond -> ${JSON.stringify(rf)}`);

  verdict('P8',
    r.delivery === 'stub' && r.verified === false && /NOT VERIFIED/.test(r.note)
      && rf.delivery === 'stub' && rf.verified === false && /NOT VERIFIED/.test(rf.note),
    'both vendors return delivery=stub, verified=false with an explicit NOT VERIFIED note');
}

/* ── P9: no forge-name branching in the dispatcher ─────────────────────── */

async function P9() {
  header('P9', 'dispatcher contains no `forge ===` branching');

  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../harness/forge/dispatch.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const patterns = [/===\s*['"](github|forgejo)['"]/, /['"](github|forgejo)['"]\s*===/, /name\s*===\s*['"]github/];
  const hits = patterns.filter((re) => re.test(code));
  console.log(`forge-name comparison patterns found in dispatch.js: ${hits.length}`);
  console.log(`dispatch.js references capabilities: ${/capabilities/.test(code)}`);

  const names = /github|forgejo/;
  const nameMentions = code.split('\n').filter((l) => names.test(l)).map((l) => l.trim());
  console.log('lines mentioning a forge name (imports/registration only):');
  for (const l of nameMentions) console.log(`  ${l}`);

  verdict('P9',
    hits.length === 0 && /capabilities/.test(code),
    'no forge-name comparison in the routing path; the gate reads vendor.capabilities');
}

/* ── P10: Forgejo kind inference when the transport name is useless ─────── */

function P10() {
  header('P10', 'Forgejo workflow_call -> kind inferred from payload, not header');

  // A reusable workflow reports `workflow_call` rather than the caller's
  // trigger, so the transport name maps to no kind and the payload must decide.
  const event = parse('forgejo', FJ_WORKFLOW_CALL_RAW);
  console.log(`eventName in raw = "${FJ_WORKFLOW_CALL_RAW.eventName}" (maps to no kind)`);
  console.log(`inferred kind = "${event.kind}" (from the comment key in the payload)`);
  console.log(`permission = ${event.permission} (owner -> owner, direct map)`);

  // The same payload with the transport name stripped must infer identically.
  const noHeader = parse('forgejo', { payload: FJ_WORKFLOW_CALL_RAW.payload });
  console.log(`same payload with no eventName -> kind "${noHeader.kind}"`);
  console.log(`kindSource declared by vendor = "${forgejo.capabilities.kindSource}"`);

  // A comment outranks the subject it hangs off: an issue_comment payload
  // carries BOTH `comment` and `issue`, and treating the `issue` key as the
  // signal would route a mention to `implement` instead of `reply`.
  const commentWins = forgejo.inferKindFromPayload({
    comment: { body: 'x' }, issue: { number: 1 }, pull_request: { number: 2 },
  });
  const prOnly = forgejo.inferKindFromPayload({ pull_request: { number: 2 } });
  const issueOnly = forgejo.inferKindFromPayload({ issue: { number: 1 } });
  const issueOnPR = forgejo.inferKindFromPayload({ issue: { number: 1, pull_request: { url: 'x' } } });
  const nothing = forgejo.inferKindFromPayload({});
  console.log(`inference: {comment,issue,pull_request} -> ${commentWins}; {pull_request} -> ${prOnly}; {issue} -> ${issueOnly}; {issue w/ pull_request marker} -> ${issueOnPR}; {} -> ${nothing}`);

  const routed = dispatch.onMention(event);

  verdict('P10',
    event.kind === 'mention'
      && event.permission === 'owner'
      && noHeader.kind === 'mention'
      && forgejo.capabilities.kindSource === 'payload'
      && commentWins === 'mention' && prOnly === 'pr' && issueOnly === 'issue'
      && issueOnPR === 'pr' && nothing === 'unknown'
      && routed.action === 'reply',
    `workflow_call resolved to kind=mention from payload; comment outranks issue so a mention routes to ${routed.action}, not implement`);
}

/* ── P7: zone check ─────────────────────────────────────────────────────── */

function P7() {
  header('P7', 'zone check');

  console.log('run the shell half of P7 from the repo root:');
  console.log('  git status --short');
  console.log('  git diff --stat 8b713cd -- workgraph skills/library/claude-ecosystem skills/library/obsidian memory capability/rag server mcp/registry.json prompt');
}

/* ── run ────────────────────────────────────────────────────────────────── */

console.log(`PROBE phase22-f  node=${process.version}`);
console.log(`vendors registered: ${dispatch.listVendors().join(', ')}`);

P1();
P2();
P2b();
P3();
P4();
P5();
P6();
P8();
await P9();
P10();
P7();

console.log(`\n──────────── VERDICTS ────────────`);
console.log(failures === 0 ? 'ALL PROBES PASS' : `${failures} PROBE(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;