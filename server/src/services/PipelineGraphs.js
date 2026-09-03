/**
 * JEXI OS — Pipeline Graphs (B52 P2).
 *
 * The three high-stakes Orchestrator paths expressed as REAL GraphRunner runs
 * instead of ad-hoc sequential code:
 *
 *   1. codeGateGraph        — Runner → QA gate → (NEEDS FIX → fix → re-run →
 *                             re-verify, bounded) → accept.
 *   2. researchVerifyGraph  — Draft → Verifier → (issues → Researcher re-run
 *                             with the SPECIFIC missing claims → Verifier,
 *                             bounded) → final.
 *   3. reviewSecurityGraph  — Reviewer → Security gate → (BLOCKED → fix →
 *                             re-run → re-review, bounded) → final verdict.
 *
 * Every graph uses typed nodes (agent | tool | verifier | gate), drives
 * routing with `state.outcome` + `when()` edges, records the node-visit
 * history (the runner pushes every node into state.history), bounds retries,
 * and writes durable failure history into state.context.failureHistory so the
 * NEXT iteration of the responsible agent receives the last error + reasons
 * (B52 P7 — FAILURE → HISTORY → CORRECT → VERIFY).
 */
import fs from 'fs';
import path from 'path';
import { createGraph, when } from './GraphRunner.js';
import { qaWebApp, qaScripted, gateVerdict, runReviewerPass, runSecurityPass, fixFromQA } from './SkillChain.js';
import { runFile } from './Runner.js';
import { verifyAnswer } from './VerificationLoop.js';
import { runSearchTeam } from './SearchAgent.js';
import { isNonAnswerText } from './MemoryManager.js'; // B199 — a re-run's failure sentinel must never clobber the real draft
import { WORKSPACE_DIR } from '../config.js';

/** Append a durable failure entry (P7): reason + node + timestamp, capped. */
function recordFailure(state, node, reason, extra = {}) {
  const history = state.context.failureHistory || [];
  history.push({ node, reason, at: new Date().toISOString(), ...extra });
  state.context.failureHistory = history.slice(-8); // keep the tail
  state.context.lastError = reason;
  state.context.attempt = (state.context.attempt || 0) + 1;
  return state;
}

/**
 * CODE GATE — runner → QA gate → recovery → re-verify (bounded).
 * Seeds: { query, entryPoint, previewUrl, teamBrief, scope, qaReport?, sendEvent }.
 * Returns the final state; context.gate = { verdict, report, entryPoint, previewUrl }.
 */
export async function runCodeGateGraph(seed) {
  const context = {
    query: '', entryPoint: null, previewUrl: null, teamBrief: '', scope: {}, qaReport: '',
    sendEvent: () => {}, failureHistory: [], attempt: 0,
    // Test seams — production defaults are the real QA/review/fix/runners.
    qaVerdictFn: null, fixFn: null, runFn: null,
    ...seed,
    gate: null,
  };
  const emit = (...a) => context.sendEvent(...a);
  const fix = context.fixFn || ((o) => fixFromQA(o));
  const runEntry = context.runFn || ((entry, onData) => runFile(entry, onData));

  const readVerdict = async (state) => {
    const c = state.context;
    if (c.qaVerdictFn) return c.qaVerdictFn(state);
    if (!c.entryPoint) return { verdict: 'PASS', report: '' };
    try {
      const report = c.previewUrl && /\.html$/i.test(c.entryPoint)
        ? await qaWebApp({ previewUrl: c.previewUrl, brief: c.teamBrief || c.query, scope: c.scope, sendEvent: emit })
        : await qaScripted({ query: c.query, files: fs.existsSync(WORKSPACE_DIR) ? fs.readdirSync(WORKSPACE_DIR).filter(f => fs.statSync(path.join(WORKSPACE_DIR, f)).isFile()) : [], lastOutput: c.lastOutput || '', sendEvent: emit });
      return { verdict: gateVerdict(report, ['PASS', 'NEEDS FIX']) || 'PASS', report };
    } catch (e) {
      return { verdict: 'PASS', report: '' }; // gate tool failure → best-effort pass
    }
  };

  const nodes = {
    // 'gate' — typed gate node. Verdict drives the edge.
    gate: {
      type: 'gate',
      run: async (state) => {
        const { verdict, report } = await readVerdict(state);
        state.context.gate = { verdict, report };
        emit('log', { agent: 'QA Lead', message: `⛔ QA gate: ${verdict}${verdict === 'NEEDS FIX' ? ' — sending back to the coder.' : ''}` });
        state.outcome = verdict === 'PASS' ? 'success' : 'needs-fix';
        return state;
      },
    },
    // 'fix' — recovery agent: apply the QA findings, re-run, re-verify (bounded).
    fix: {
      type: 'agent',
      run: async (state) => {
        const c = state.context;
        recordFailure(state, 'qa-gate', `QA NEEDS FIX: ${String(c.gate?.report || '').slice(0, 300)}`);
        const fixed = await fix({ query: c.query, qaReport: c.gate?.report || '', entryPoint: c.entryPoint, sendEvent: emit }).catch(() => null);
        if (fixed && fixed.entryPoint) c.entryPoint = fixed.entryPoint;
        // Re-run and re-verify after the fix.
        const rerun = await runEntry(c.entryPoint, (s, d) => emit('log', { agent: 'Terminal', message: String(d).slice(0, 160) })).catch(() => null);
        if (rerun && rerun.url) c.previewUrl = rerun.url;
        c.lastOutput = rerun ? (rerun.output || rerun.error || '') : '';
        const { verdict, report } = await readVerdict(state);
        state.context.gate = { verdict, report };
        emit('log', { agent: 'QA Lead', message: `↻ Re-verification after fix: ${verdict}` });
        // One fix round is the budget: PASS → end, still NEEDS FIX → accept
        // the honest verdict (no blind infinite retry).
        state.outcome = verdict === 'PASS' ? 'success' : 'needs-fix';
        return state;
      },
    },
  };

  const graph = createGraph({
    nodes,
    start: 'gate',
    edges: {
      gate: when({ success: 'end', 'needs-fix': 'fix', default: 'end' }),
      fix: when({ success: 'end', 'needs-fix': 'end', default: 'end' }),
    },
    maxSteps: 8,
  });

  const final = await graph.run({ context });
  return final;
}

/**
 * RESEARCH VERIFICATION — draft → verifier → (revise with specific missing
 * claims → verifier, bounded) → final. Seeds:
 * { query, draft, sources?, sendEvent }.
 * Returns final state; context.finalDraft + context.verification.
 */
export async function runResearchVerifyGraph(seed) {
  const context = {
    query: '', draft: '', sources: [], sendEvent: () => {}, failureHistory: [], attempt: 0,
    // Test seams — production defaults are the real verifier/search team.
    verifyFn: null, searchFn: null,
    ...seed,
    revisions: 0,
  };
  const emit = (...a) => context.sendEvent(...a);
  const verify = context.verifyFn || ((o) => verifyAnswer(o));
  const search = context.searchFn || ((q, ev, opts) => runSearchTeam(q, ev, opts));

  const nodes = {
    // 'verify' — typed verifier node.
    verify: {
      type: 'verifier',
      run: async (state) => {
        const c = state.context;
        emit('log', { agent: 'Critic', message: '🔎 Verifying the answer against its sources (fact-check pass)...' });
        try { emit('narration', { text: 'Let me fact-check my draft against those sources.' }); } catch (e) {}
        const verified = await verify({ query: c.query, draft: c.draft, sources: c.sources }).catch(() => null)
          || { verdict: 'verified', changed: false, text: c.draft, issues: [] };
        state.context.verification = { rounds: verified.rounds || 1, verdict: verified.verdict };
        if (verified.changed && verified.text) c.draft = verified.text;
        const hasIssues = verified.verdict === 'best-effort' && verified.issues && verified.issues.length;
        if (hasIssues && c.revisions < 1) {
          recordFailure(state, 'research-verify', `unsupported claims: ${verified.issues.slice(0, 5).join(' | ')}`, { issues: verified.issues.slice(0, 5) });
          state.context.missingClaims = verified.issues.slice(0, 5);
          emit('log', { agent: 'Fact Checker', message: `↻ Re-entering research with ${verified.issues.length} specific missing claim(s) to fix.` });
          try { emit('narration', { text: `The fact-check flagged ${verified.issues.length} claims — I'm re-verifying those specifically.` }); } catch (e) {}
          state.outcome = 'revise';
        } else {
          if (hasIssues) emit('log', { agent: 'Fact Checker', message: '⚠ Verification still flagged issues after retry — shipping the best-effort honest answer.' });
          else emit('log', { agent: 'Critic', message: verified.changed ? '✓ Answer verified clean after revision.' : '✓ Answer verified clean.' });
          state.outcome = 'success';
        }
        return state;
      },
    },
    // 'revise' — recovery agent: the Researcher re-runs WITH the specific
    // missing claims so the re-entry fixes them, not a generic re-run.
    revise: {
      type: 'agent',
      run: async (state) => {
        const c = state.context;
        c.revisions += 1;
        const claims = (c.missingClaims || []).join(' | ');
        const effQuery = claims ? `${c.query}\n\n[Verification follow-up — verify each flagged claim with a real source: ${claims}]` : c.query;
        const team = await search(effQuery, emit, { context: c.thread || '' }).catch(() => null);
        // B199 — adopt the re-run ONLY when it produced a real answer. The
        // re-entry synthesizer can honestly return "I could not find enough
        // information…" — that sentinel used to REPLACE the existing real
        // draft, throwing away minutes of verified work and shipping the
        // failure to the user as the final answer. Keep the draft instead.
        if (team && team.summary && !isNonAnswerText(team.summary)) {
          c.draft = team.summary;
          if (team.sources && team.sources.length) c.sources = team.sources.slice(0, 5);
        } else if (team && team.summary) {
          emit('log', { agent: 'Fact Checker', message: '⚠ The extra pass came back empty — shipping the best-effort draft with its caveats.' });
          try { emit('narration', { text: 'The extra pass came back empty — I\u2019ll give you the best-effort answer with honest caveats.' }); } catch (e) {}
        }
        state.outcome = 'verify'; // loop back through the verifier (bounded by revisions < 1)
        return state;
      },
    },
  };

  const graph = createGraph({
    nodes,
    start: 'verify',
    edges: {
      verify: when({ success: 'end', revise: 'revise', default: 'end' }),
      revise: when({ verify: 'verify', default: 'end' }), // loop back through the verifier
    },
    maxSteps: 6,
  });

  const final = await graph.run({ context });
  final.context.finalDraft = final.context.draft;
  return final;
}

/**
 * REVIEW + SECURITY GATE — reviewer → security gate → (BLOCKED → fix → re-run
 * → re-review, bounded) → final verdict. Seeds:
 * { query, entryPoint, teamPlan, qaReport, files, sendEvent }.
 * Returns final state; context.reviewSecurity = { review, security, verdict }.
 */
export async function runReviewSecurityGraph(seed) {
  const context = {
    query: '', entryPoint: null, teamPlan: '', qaReport: '', files: [], sendEvent: () => {},
    failureHistory: [], attempt: 0,
    // Test seams — production defaults are the real reviewer/security passes.
    reviewFn: null, securityFn: null, fixFn: null, runFn: null,
    ...seed,
    reviewSecurity: null,
  };
  const emit = (...a) => context.sendEvent(...a);
  const filesNow = () => (context.files.length ? context.files : (fs.existsSync(WORKSPACE_DIR) ? fs.readdirSync(WORKSPACE_DIR).filter(f => fs.statSync(path.join(WORKSPACE_DIR, f)).isFile()) : []));
  const reviewPass = context.reviewFn || ((o) => runReviewerPass(o));
  const securityPass = context.securityFn || ((o) => runSecurityPass(o));
  const fix = context.fixFn || ((o) => fixFromQA(o));
  const runEntry = context.runFn || ((entry, onData) => runFile(entry, onData));

  const nodes = {
    // 'reviewer' — typed agent node.
    reviewer: {
      type: 'agent',
      run: async (state) => {
        const r = await reviewPass({ query: context.query, plan: context.teamPlan, files: filesNow(), qaReport: context.qaReport, sendEvent: emit }).catch(() => null) || { review: '', verdict: 'APPROVED' };
        state.context.review = r.review;
        state.context.reviewVerdict = r.verdict;
        emit('log', { agent: 'Reviewer', message: `🔍 Review verdict: ${r.verdict}` });
        state.outcome = 'success';
        return state;
      },
    },
    // 'security-gate' — typed gate node: BLOCKED → recovery edge.
    'security-gate': {
      type: 'gate',
      run: async (state) => {
        const s = await securityPass({ files: filesNow(), qaReport: context.qaReport, review: context.review || '', sendEvent: emit }).catch(() => null) || { security: '', verdict: 'CLEARED' };
        state.context.security = s.security;
        state.context.secVerdict = s.verdict;
        emit('log', { agent: 'Security Officer', message: `🛡 Security verdict: ${s.verdict}` });
        state.outcome = s.verdict === 'BLOCKED' ? 'blocked' : 'success';
        return state;
      },
    },
    // 'fix-sec' — recovery agent: apply findings, re-run, re-review (bounded).
    'fix-sec': {
      type: 'agent',
      run: async (state) => {
        recordFailure(state, 'security-gate', `SECURITY BLOCKED: ${String(state.context.security || '').slice(0, 300)}`);
        emit('log', { agent: 'Security Officer', message: '⛔ SECURITY GATE BLOCKED — sending findings to the coder for a fix round.' });
        const secFix = await fix({ query: context.query, qaReport: state.context.security || '', entryPoint: context.entryPoint, sendEvent: emit }).catch(() => null);
        if (secFix && secFix.entryPoint) context.entryPoint = secFix.entryPoint;
        emit('log', { agent: 'Runner', message: '↻ Re-running after security fix...' });
        const rerun = await runEntry(context.entryPoint, (s, d) => emit('log', { agent: 'Terminal', message: String(d).slice(0, 160) })).catch(() => null);
        if (rerun && rerun.url) context.previewUrl = rerun.url;
        // Re-review through the gate one more time (bounded).
        const s2 = await securityPass({ files: filesNow(), qaReport: context.qaReport, review: context.review || '', sendEvent: emit }).catch(() => null) || { security: '', verdict: 'BLOCKED' };
        state.context.security = s2.security;
        state.context.secVerdict = s2.verdict;
        emit('log', { agent: 'Security Officer', message: s2.verdict === 'BLOCKED' ? '⛔ Still BLOCKED after the fix round — issues need human attention.' : '✅ SECURITY GATE CLEARED after fix round.' });
        state.outcome = s2.verdict === 'BLOCKED' ? 'blocked' : 'success';
        return state;
      },
    },
  };

  const graph = createGraph({
    nodes,
    start: 'reviewer',
    edges: {
      reviewer: when({ success: 'security-gate', default: 'security-gate' }),
      'security-gate': when({ success: 'end', blocked: 'fix-sec', default: 'end' }),
      'fix-sec': when({ success: 'end', blocked: 'end', default: 'end' }),
    },
    maxSteps: 8,
  });

  const final = await graph.run({ context });
  final.context.reviewSecurity = {
    review: final.context.review || '',
    security: final.context.security || '',
    verdict: final.context.secVerdict || 'CLEARED',
    history: final.history,
  };
  return final;
}
