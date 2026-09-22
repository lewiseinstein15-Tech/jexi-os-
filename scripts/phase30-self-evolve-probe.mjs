#!/usr/bin/env node
/** Phase 30 Scope G live probe: one agent evolves only its own skills (P1-P7). */
import nodeAssert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import skills from '../harness/parity/skills/index.js';
import {
  createSelfEvolve,
  inspectSkill,
} from '../harness/parity/self-evolve/index.js';

const [remoteRef, decisionsBlob, provenanceBlob, scopeBSkillsBlob, phase26Blob] = process.argv.slice(2);
nodeAssert.ok(remoteRef, 'authoritative remote ref argument is required');
nodeAssert.ok(decisionsBlob, 'authoritative Phase 14 decisions blob argument is required');
nodeAssert.ok(provenanceBlob, 'authoritative Phase 14 PROV-O blob argument is required');
nodeAssert.ok(scopeBSkillsBlob, 'authoritative Scope B skills blob argument is required');
nodeAssert.ok(phase26Blob, 'authoritative Phase 26 instincts blob argument is required');

function gitBlob(relativeUrl) {
  const filePath = fileURLToPath(new URL(relativeUrl, import.meta.url));
  const bytes = fs.readFileSync(filePath);
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertAll(assertions, label) {
  for (const [name, passed] of Object.entries(assertions)) {
    nodeAssert.equal(passed, true, `${label} assertion failed: ${name}`);
  }
}

nodeAssert.equal(gitBlob('../semantica/decisions/index.js'), decisionsBlob);
nodeAssert.equal(gitBlob('../semantica/provenance/index.js'), provenanceBlob);
nodeAssert.equal(gitBlob('../harness/parity/skills/index.js'), scopeBSkillsBlob);
nodeAssert.equal(gitBlob('../instincts/evolve/index.js'), phase26Blob);

function skillFile({ id, owner, version, body, allowedTools = ['Read', 'Write(/tmp/**)'], maxByteDelta = 4096 }) {
  return [
    '---',
    `id: ${id}`,
    `owner: ${owner}`,
    `version: ${version}`,
    `maxByteDelta: ${maxByteDelta}`,
    `allowedTools: [${allowedTools.join(', ')}]`,
    '---',
    body,
    '',
  ].join('\n');
}

function writeSkill(root, spec) {
  const target = path.join(root, spec.id, 'SKILL.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, skillFile(spec));
  return target;
}

function update(id, owner, version, body, reason, priority, extras = {}) {
  return {
    skillId: id,
    path: `${id}/SKILL.md`,
    content: skillFile({ id, owner, version, body, ...extras }),
    reason,
    priority,
  };
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-phase30-self-evolve-'));
const agentId = 'presentation-curator';

try {
  const root = path.join(temp, 'owned-fixture');
  const alphaPath = writeSkill(root, {
    id: 'slides-layout', owner: agentId, version: 1, body: 'Use a balanced slide grid.',
  });
  const betaPath = writeSkill(root, {
    id: 'visual-review', owner: agentId, version: 1, body: 'Review visual hierarchy before delivery.',
  });
  const foreignPath = writeSkill(root, {
    id: 'other-agent-skill', owner: 'research-agent', version: 1, body: 'Research-only guidance.',
  });
  const alphaPrior = fs.readFileSync(alphaPath);
  const betaPrior = fs.readFileSync(betaPath);
  const foreignPrior = fs.readFileSync(foreignPath);

  const selfEvolve = createSelfEvolve({ root });
  console.log('P1 OWNED SKILLS UPDATE; FOREIGN SKILL REFUSED');
  const p1Result = selfEvolve.afterRun({
    agentId,
    runId: 'run-owned-001',
    skillsUpdated: [
      update('slides-layout', agentId, 2, 'Use a balanced slide grid. Add a final overflow check.', 'run found slide overflow', 30),
      update('visual-review', agentId, 2, 'Review visual hierarchy and contrast before delivery.', 'contrast review improved output', 20),
      update('other-agent-skill', 'research-agent', 2, 'Attempted foreign evolution.', 'not owned', 10),
    ],
  });
  const p1 = {
    result: p1Result,
    files: {
      slidesLayoutChanged: !fs.readFileSync(alphaPath).equals(alphaPrior),
      visualReviewChanged: !fs.readFileSync(betaPath).equals(betaPrior),
      foreignByteIdentical: fs.readFileSync(foreignPath).equals(foreignPrior),
    },
    assertions: {
      exactlyTwoOwnedSkillsUpdated: p1Result.updated.length === 2,
      ownedSkillBytesChanged: !fs.readFileSync(alphaPath).equals(alphaPrior)
        && !fs.readFileSync(betaPath).equals(betaPrior),
      bothUpdatesAudited: p1Result.decisionIds.length === 2,
      singularAuditedContractReturned: p1Result.audited === 'decision-002',
      exactlyOneSkillRefused: p1Result.refused.length === 1,
      foreignSkillRefusedAsNotOwner: p1Result.refused[0]?.code === 'E_NOT_OWNER',
      foreignSkillBytesUnchanged: fs.readFileSync(foreignPath).equals(foreignPrior),
    },
    sources: {
      remoteRef,
      phase14Decisions: { path: 'semantica/decisions/index.js', blob: decisionsBlob },
      phase14Provenance: { path: 'semantica/provenance/index.js', blob: provenanceBlob },
      scopeBSkills: { path: 'harness/parity/skills/index.js', blob: scopeBSkillsBlob },
      phase26InstinctsReadOnly: { path: 'instincts/evolve/index.js', blob: phase26Blob },
    },
  };
  console.log(JSON.stringify(p1, null, 2));
  assertAll(p1.assertions, 'P1');
  nodeAssert.deepEqual(p1Result.updated.map((entry) => entry.skillId), ['slides-layout', 'visual-review']);
  nodeAssert.equal(p1Result.updated.length, 2);
  nodeAssert.equal(p1Result.decisionIds.length, 2);
  nodeAssert.equal(p1Result.audited, 'decision-002');
  nodeAssert.equal(p1Result.refused.length, 1);
  nodeAssert.equal(p1Result.refused[0].skillId, 'other-agent-skill');
  nodeAssert.equal(p1Result.refused[0].code, 'E_NOT_OWNER');
  nodeAssert.equal(p1.files.foreignByteIdentical, true);
  console.log('P1 PASS');

  console.log('\nP2 PHASE 14 DECISION AUDIT');
  const auditEntries = selfEvolve.audit(agentId);
  const decisionRecords = p1Result.decisionIds.map((decisionId) => {
    const raw = selfEvolve.decisions.get(decisionId);
    const payload = JSON.parse(raw.chosen);
    const audit = auditEntries.find((entry) => entry.decisionId === decisionId);
    return {
      decisionId: raw.decisionId,
      subject: raw.subject,
      agentId: payload.agentId,
      skillId: payload.skillId,
      diff: payload.diff,
      reason: payload.reason,
      rationale: raw.rationale,
      by: raw.by,
      when: raw.when,
      provenance: audit.provenance,
    };
  });
  const p2 = {
    readThrough: 'Phase 14 decisions.get',
    decisionCount: decisionRecords.length,
    records: decisionRecords,
    assertions: {
      oneDecisionPerSuccessfulUpdate: decisionRecords.length === 2,
      everyDecisionCarriesAgentId: decisionRecords.every((entry) => entry.agentId === agentId),
      everyDecisionCarriesSkillId: decisionRecords.every((entry) => typeof entry.skillId === 'string'),
      everyDecisionCarriesDiff: decisionRecords.every((entry) => entry.diff.totalByteDelta > 0),
      everyDecisionCarriesReason: decisionRecords.every((entry) => typeof entry.reason === 'string' && entry.reason.length > 0),
      everyDecisionHasProvO: decisionRecords.every((entry) => entry.provenance.activity === 'activity:decision-record'),
    },
  };
  console.log(JSON.stringify(p2, null, 2));
  assertAll(p2.assertions, 'P2');
  nodeAssert.equal(decisionRecords.length, 2);
  nodeAssert.deepEqual(decisionRecords.map((entry) => entry.agentId), [agentId, agentId]);
  nodeAssert.deepEqual(decisionRecords.map((entry) => entry.skillId), ['slides-layout', 'visual-review']);
  nodeAssert.ok(decisionRecords.every((entry) => entry.diff.totalByteDelta > 0));
  nodeAssert.ok(decisionRecords.every((entry) => typeof entry.reason === 'string' && entry.reason.length > 0));
  nodeAssert.ok(decisionRecords.every((entry) => entry.provenance.activity === 'activity:decision-record'));
  console.log('P2 PASS');

  console.log('\nP3 MAX SKILLS AND BYTE DELTA BOUNDS');
  const boundRoot = path.join(temp, 'bound-fixture');
  const boundIds = ['priority-one', 'priority-two', 'priority-three', 'priority-four', 'priority-five'];
  for (const id of boundIds) writeSkill(boundRoot, { id, owner: agentId, version: 1, body: `Initial ${id}.` });
  const bounded = createSelfEvolve({ root: boundRoot });
  const boundResult = bounded.afterRun({
    agentId,
    runId: 'run-bound-001',
    skillsUpdated: boundIds.map((id, index) => update(
      id,
      agentId,
      2,
      `Evolved ${id}.`,
      `priority ${5 - index}`,
      50 - index * 10,
    )),
  });
  const tinyRoot = path.join(temp, 'tiny-delta-fixture');
  const tinyPath = writeSkill(tinyRoot, {
    id: 'tiny-delta', owner: agentId, version: 1, body: 'A', maxByteDelta: 8,
  });
  const tinyBefore = fs.readFileSync(tinyPath);
  const tiny = createSelfEvolve({ root: tinyRoot });
  const deltaResult = tiny.afterRun({
    agentId,
    runId: 'run-delta-001',
    skillsUpdated: [update(
      'tiny-delta', agentId, 2, 'This expansion is intentionally much larger than eight bytes.',
      'oversized change', 1, { maxByteDelta: 8 },
    )],
  });
  const p3 = {
    maxSkillsPerRun: 3,
    result: boundResult,
    updatedInPriorityOrder: boundResult.updated.map((entry) => entry.skillId),
    maxBoundRefusals: boundResult.refused.filter((entry) => entry.code === 'E_MAX_SKILLS_PER_RUN'),
    byteDeltaGuard: {
      result: deltaResult,
      fileByteIdentical: fs.readFileSync(tinyPath).equals(tinyBefore),
    },
    assertions: {
      onlyTopThreeUpdated: boundResult.updated.length === 3,
      priorityOrderHonored: boundResult.updated.map((entry) => entry.skillId).join(',') === 'priority-one,priority-two,priority-three',
      remainderReportedWithReasons: boundResult.refused.length === 2
        && boundResult.refused.every((entry) => entry.code === 'E_MAX_SKILLS_PER_RUN' && entry.reason.length > 0),
      oversizedUpdateRefused: deltaResult.refused[0]?.code === 'E_SKILL_DELTA_EXCEEDED',
      oversizedUpdateLeavesBytesUnchanged: fs.readFileSync(tinyPath).equals(tinyBefore),
    },
  };
  console.log(JSON.stringify(p3, null, 2));
  assertAll(p3.assertions, 'P3');
  nodeAssert.deepEqual(p3.updatedInPriorityOrder, ['priority-one', 'priority-two', 'priority-three']);
  nodeAssert.deepEqual(p3.maxBoundRefusals.map((entry) => entry.skillId), ['priority-four', 'priority-five']);
  nodeAssert.ok(p3.maxBoundRefusals.every((entry) => entry.code === 'E_MAX_SKILLS_PER_RUN'));
  nodeAssert.equal(deltaResult.updated.length, 0);
  nodeAssert.equal(deltaResult.refused[0].code, 'E_SKILL_DELTA_EXCEEDED');
  nodeAssert.equal(p3.byteDeltaGuard.fileByteIdentical, true);
  console.log('P3 PASS');

  console.log('\nP4 PROV-O ROLLBACK RESTORES PRIOR BYTES');
  const alphaEvolved = fs.readFileSync(alphaPath);
  const rollbackResult = selfEvolve.rollback(p1Result.decisionIds[0]);
  const alphaRestored = fs.readFileSync(alphaPath);
  const rollbackAudit = selfEvolve.audit(agentId)
    .find((entry) => entry.decisionId === p1Result.decisionIds[0]);
  const p4 = {
    decisionId: p1Result.decisionIds[0],
    priorSha256: sha256(alphaPrior),
    evolvedSha256: sha256(alphaEvolved),
    restoredSha256: sha256(alphaRestored),
    byteIdenticalToPrior: alphaRestored.equals(alphaPrior),
    rollback: rollbackResult,
    auditAfterRollback: {
      decisionId: rollbackAudit.decisionId,
      rolledBack: rollbackAudit.rolledBack,
      provenance: rollbackAudit.provenance,
    },
    assertions: {
      evolvedBytesDiffered: !alphaEvolved.equals(alphaPrior),
      exactPriorBytesRestored: alphaRestored.equals(alphaPrior),
      rollbackConsumedProvO: rollbackResult.provenance.activity === 'activity:decision-record',
      auditMarksRollback: rollbackAudit.rolledBack === true,
    },
  };
  console.log(JSON.stringify(p4, null, 2));
  assertAll(p4.assertions, 'P4');
  nodeAssert.notEqual(p4.evolvedSha256, p4.priorSha256);
  nodeAssert.equal(p4.restoredSha256, p4.priorSha256);
  nodeAssert.equal(p4.byteIdenticalToPrior, true);
  nodeAssert.equal(rollbackResult.rolledBack, true);
  nodeAssert.equal(rollbackResult.provenance.activity, 'activity:decision-record');
  nodeAssert.equal(p4.auditAfterRollback.rolledBack, true);
  console.log('P4 PASS');

  console.log('\nP5 EVOLVED SKILL PASSES SCOPE B VALIDATION');
  const evolvedMetadata = inspectSkill(betaPath);
  const parsedAllowedTools = evolvedMetadata.allowedTools.map((pattern) => ({
    pattern,
    ast: skills.scoping.parse(pattern),
  }));
  const enforcementChecks = {
    read: skills.enforcement.assert({ name: evolvedMetadata.skillId, allowedTools: evolvedMetadata.allowedTools }, { tool: 'Read' }),
    writeInside: skills.enforcement.assert({ name: evolvedMetadata.skillId, allowedTools: evolvedMetadata.allowedTools }, { tool: 'Write', arg: '/tmp/output/deck.md' }),
  };
  const p5 = {
    valid: true,
    metadata: evolvedMetadata,
    parsedAllowedTools,
    enforcementChecks,
    assertions: {
      schemaAccepted: evolvedMetadata.skillId === 'visual-review'
        && evolvedMetadata.owner === agentId && evolvedMetadata.version === 2,
      everyAllowedToolParsedByScopeB: parsedAllowedTools.length === evolvedMetadata.allowedTools.length,
      readAllowedByScopeB: enforcementChecks.read.allowed === true,
      scopedWriteAllowedByScopeB: enforcementChecks.writeInside.allowed === true,
    },
  };
  console.log(JSON.stringify(p5, null, 2));
  assertAll(p5.assertions, 'P5');
  nodeAssert.equal(evolvedMetadata.skillId, 'visual-review');
  nodeAssert.equal(evolvedMetadata.owner, agentId);
  nodeAssert.equal(evolvedMetadata.version, 2);
  nodeAssert.equal(parsedAllowedTools.length, 2);
  nodeAssert.equal(enforcementChecks.read.allowed, true);
  nodeAssert.equal(enforcementChecks.writeInside.allowed, true);
  console.log('P5 PASS');

  console.log('\nP6 DELETE IS NOT ALLOWED');
  const betaBeforeDelete = fs.readFileSync(betaPath);
  const deleteResult = selfEvolve.afterRun({
    agentId,
    runId: 'run-delete-001',
    skillsUpdated: [{
      skillId: 'visual-review',
      path: 'visual-review/SKILL.md',
      delete: true,
      reason: 'attempted removal',
    }],
  });
  const p6 = {
    result: deleteResult,
    fileStillExists: fs.existsSync(betaPath),
    fileByteIdentical: fs.readFileSync(betaPath).equals(betaBeforeDelete),
    assertions: {
      noSkillUpdated: deleteResult.updated.length === 0,
      deletionRefused: deleteResult.refused[0]?.code === 'E_DELETE_NOT_ALLOWED',
      skillStillExists: fs.existsSync(betaPath),
      skillBytesUnchanged: fs.readFileSync(betaPath).equals(betaBeforeDelete),
    },
  };
  console.log(JSON.stringify(p6, null, 2));
  assertAll(p6.assertions, 'P6');
  nodeAssert.equal(deleteResult.updated.length, 0);
  nodeAssert.equal(deleteResult.refused.length, 1);
  nodeAssert.equal(deleteResult.refused[0].code, 'E_DELETE_NOT_ALLOWED');
  nodeAssert.equal(p6.fileStillExists, true);
  nodeAssert.equal(p6.fileByteIdentical, true);
  console.log('P6 PASS');

  console.log('\nP7 DETERMINISM');
  function deterministicSequence(rootPath) {
    for (const id of ['det-layout', 'det-review']) {
      writeSkill(rootPath, { id, owner: agentId, version: 1, body: `Initial ${id}.` });
    }
    const instance = createSelfEvolve({ root: rootPath });
    const result = instance.afterRun({
      agentId,
      runId: 'deterministic-run',
      skillsUpdated: [
        update('det-layout', agentId, 2, 'Evolved deterministic layout.', 'same layout outcome', 20),
        update('det-review', agentId, 2, 'Evolved deterministic review.', 'same review outcome', 10),
      ],
    });
    return {
      result,
      audit: instance.audit(agentId),
      files: ['det-layout', 'det-review'].map((id) => ({
        skillId: id,
        sha256: sha256(fs.readFileSync(path.join(rootPath, id, 'SKILL.md'))),
      })),
    };
  }
  const firstSequence = deterministicSequence(path.join(temp, 'determinism-one'));
  const secondSequence = deterministicSequence(path.join(temp, 'determinism-two'));
  const firstBytes = JSON.stringify(firstSequence);
  const secondBytes = JSON.stringify(secondSequence);
  const summarizeSequence = (sequence, canonicalBytes) => ({
    updated: sequence.result.updated.map((entry) => ({
      skillId: entry.skillId,
      decisionId: entry.decisionId,
      afterSha256: entry.diff.afterSha256,
    })),
    audited: sequence.result.audited,
    decisionIds: sequence.result.decisionIds,
    refused: sequence.result.refused,
    auditDecisionIds: sequence.audit.map((entry) => entry.decisionId),
    files: sequence.files,
    canonicalBytes: Buffer.byteLength(canonicalBytes),
    canonicalSha256: sha256(canonicalBytes),
  });
  const p7 = {
    canonicalSurface: ['afterRun result', 'audit result', 'evolved file hashes'],
    first: summarizeSequence(firstSequence, firstBytes),
    second: summarizeSequence(secondSequence, secondBytes),
    byteIdentical: firstBytes === secondBytes,
    assertions: {
      canonicalByteLengthsEqual: Buffer.byteLength(firstBytes) === Buffer.byteLength(secondBytes),
      canonicalSha256Equal: sha256(firstBytes) === sha256(secondBytes),
      completeCanonicalResultsByteIdentical: firstBytes === secondBytes,
    },
  };
  console.log(JSON.stringify(p7, null, 2));
  assertAll(p7.assertions, 'P7');
  nodeAssert.equal(firstBytes, secondBytes);
  nodeAssert.equal(p7.first.canonicalSha256, p7.second.canonicalSha256);
  nodeAssert.equal(p7.byteIdentical, true);
  console.log('P7 PASS');

  console.log('\nPHASE30_SCOPE_G_PASS');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
