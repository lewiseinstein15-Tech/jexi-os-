/** JEXI OS — Phase 30 Scope G — bounded self-evolution and rollback. */
import fs from 'node:fs';
import path from 'node:path';
import { SemanticaError } from '../../../semantica/_internal.js';
import { createEvolutionAudit } from './audit.js';
import { prepareUpdate, DEFAULT_MAX_BYTE_DELTA } from './guardrail.js';

export const DEFAULT_MAX_SKILLS_PER_RUN = 3;

const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const clone = (value) => JSON.parse(JSON.stringify(value));

function fail(code, message, details = {}) {
  return Object.assign(new SemanticaError(code, message), details);
}

function atomicWrite(filePath, bytes) {
  const temporary = `${filePath}.${process.pid}.self-evolve.tmp`;
  const mode = fs.statSync(filePath).mode & 0o777;
  try {
    fs.writeFileSync(temporary, bytes, { mode, flag: 'wx' });
    fs.renameSync(temporary, filePath);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function refusal(error, update) {
  return {
    skillId: typeof update?.skillId === 'string' ? update.skillId : null,
    code: error?.code ?? 'E_SELF_EVOLVE',
    reason: error?.message ?? String(error),
  };
}

export function createSelfEvolve({
  root = path.resolve('.jexi/self-evolve-skills'),
  maxSkillsPerRun = DEFAULT_MAX_SKILLS_PER_RUN,
  defaultMaxByteDelta = DEFAULT_MAX_BYTE_DELTA,
  decisionLog,
} = {}) {
  if (!Number.isSafeInteger(maxSkillsPerRun) || maxSkillsPerRun < 1) {
    throw fail('E_INVALID_EVOLUTION_LIMIT', 'maxSkillsPerRun must be a positive integer');
  }
  if (!Number.isSafeInteger(defaultMaxByteDelta) || defaultMaxByteDelta < 1) {
    throw fail('E_INVALID_EVOLUTION_LIMIT', 'defaultMaxByteDelta must be a positive integer');
  }
  const resolvedRoot = path.resolve(root);
  const auditLog = createEvolutionAudit({ decisionLog });

  function afterRun({ agentId, runId, skillsUpdated } = {}) {
    if (typeof agentId !== 'string' || !AGENT_ID.test(agentId)) {
      throw fail('E_INVALID_AGENT_ID', 'agentId must be a valid non-empty id');
    }
    if (typeof runId !== 'string' || runId.trim() === '') {
      throw fail('E_INVALID_RUN_ID', 'runId must be a non-empty string');
    }
    if (!Array.isArray(skillsUpdated)) {
      throw fail('E_INVALID_SKILL_UPDATES', 'skillsUpdated must be an array');
    }

    const refused = [];
    const prepared = [];
    const counts = new Map();
    for (const update of skillsUpdated) {
      if (typeof update?.skillId === 'string') {
        counts.set(update.skillId, (counts.get(update.skillId) ?? 0) + 1);
      }
    }
    const duplicateIdsReported = new Set();
    for (const [inputIndex, update] of skillsUpdated.entries()) {
      if (typeof update?.skillId === 'string' && counts.get(update.skillId) > 1) {
        if (!duplicateIdsReported.has(update.skillId)) {
          refused.push({
            skillId: update.skillId,
            code: 'E_DUPLICATE_SKILL_UPDATE',
            reason: `skill ${update.skillId} appears more than once in run ${runId}`,
          });
          duplicateIdsReported.add(update.skillId);
        }
        continue;
      }
      try {
        prepared.push({
          ...prepareUpdate(resolvedRoot, agentId, update, defaultMaxByteDelta),
          inputIndex,
        });
      } catch (error) {
        refused.push(refusal(error, update));
      }
    }

    prepared.sort((a, b) => b.priority - a.priority
      || (a.skillId < b.skillId ? -1 : a.skillId > b.skillId ? 1 : a.inputIndex - b.inputIndex));
    const selected = prepared.slice(0, maxSkillsPerRun);
    for (const item of prepared.slice(maxSkillsPerRun)) {
      refused.push({
        skillId: item.skillId,
        code: 'E_MAX_SKILLS_PER_RUN',
        reason: `max ${maxSkillsPerRun} skills may evolve in one run`,
      });
    }

    const updated = [];
    const decisionIds = [];
    for (const item of selected) {
      try {
        const currentBytes = fs.readFileSync(item.path);
        if (!currentBytes.equals(item.before)) {
          throw fail('E_SKILL_CONFLICT', `skill ${item.skillId} changed after validation`);
        }
        atomicWrite(item.path, item.after);
        let decision;
        try {
          decision = auditLog.record({
            agentId,
            skillId: item.skillId,
            diff: item.diff,
            reason: item.reason,
            runId,
            relativePath: item.relativePath,
            targetPath: item.path,
            before: item.before,
            after: item.after,
          });
        } catch (error) {
          atomicWrite(item.path, item.before);
          throw error;
        }
        decisionIds.push(decision.decisionId);
        updated.push({
          skillId: item.skillId,
          fromVersion: item.current.version,
          toVersion: item.evolved.version,
          decisionId: decision.decisionId,
          diff: clone(item.diff),
        });
      } catch (error) {
        refused.push(refusal(error, item));
      }
    }

    return {
      updated,
      audited: decisionIds.at(-1) ?? null,
      decisionIds,
      refused,
    };
  }

  function audit(agentId) {
    if (typeof agentId !== 'string' || !AGENT_ID.test(agentId)) {
      throw fail('E_INVALID_AGENT_ID', 'agentId must be a valid non-empty id');
    }
    return auditLog.list(agentId);
  }

  function rollback(decisionId) {
    const { entry, provenance } = auditLog.rollbackInfo(decisionId);
    let rootReal;
    let target;
    try {
      rootReal = fs.realpathSync(resolvedRoot);
      target = fs.realpathSync(path.resolve(rootReal, entry.relativePath));
    } catch (error) {
      throw fail('E_SKILL_NOT_FOUND', `rollback cannot read ${entry.relativePath}: ${error.code ?? error.message}`);
    }
    if (target !== rootReal && !target.startsWith(`${rootReal}${path.sep}`)) {
      throw fail('E_INVALID_SKILL_PATH', `rollback target escapes skill root: ${entry.relativePath}`);
    }
    if (target !== entry.targetPath) {
      throw fail('E_ROLLBACK_CONFLICT', `skill ${entry.skillId} moved after decision ${decisionId}`);
    }
    const current = fs.readFileSync(target);
    if (!current.equals(entry.after)) {
      throw fail('E_ROLLBACK_CONFLICT', `skill ${entry.skillId} no longer matches decision ${decisionId}`);
    }
    atomicWrite(target, entry.before);
    auditLog.markRolledBack(decisionId);
    return {
      rolledBack: true,
      decisionId,
      skillId: entry.skillId,
      bytesRestored: entry.before.length,
      provenance: clone(provenance),
    };
  }

  return Object.freeze({
    afterRun,
    audit,
    rollback,
    decisions: auditLog.decisions,
  });
}
