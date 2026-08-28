/**
 * JEXI OS — Agent Team Plugin (B160).
 * DeepSeek Harness `packages/experimental/tool-agent-team` mirror: scoped
 * model-facing Agent Teams tools over the AgentTeams service (ctx.agentTeams).
 *
 * Tools: team_spawn · team_message · team_inbox · team_tasks_new ·
 * team_task_claim · team_task_update · team_task_complete · team_wait.
 * All scoped to the calling conversation (the implicit Lead's team).
 */

import {
  spawnTeammate, sendMessage, readInbox, claimNextMessage,
  createTask, listTasks, claimTask, updateTask, completeTask, waitForChange,
} from '../../src/services/AgentTeams.js';

export const name = 'agent-team';
export const version = '1.0.0';
export const inject = ['tools'];

export async function apply(ctx) {
  const teamOf = (args) => (args && args.__convId) || 'default';

  const unregisters = [];
  const reg = (def) => unregisters.push(ctx.tools.register(def));

  reg({
    slug: 'team_spawn',
    name: 'Team Spawn',
    desc: 'Add a named teammate to this conversation\'s agent team (lowercase kebab-case name, unique forever). The teammate is a continuable subagent slot woken by messages.',
    args: {
      name: { type: 'string', required: true, desc: 'lowercase kebab-case teammate name (≤64 chars, never reusable)' },
      role: { type: 'string', required: false, desc: 'one-line mandate for this teammate' },
    },
    handler: async (args) => spawnTeammate(teamOf(args), args.name, { role: args.role }),
  });

  reg({
    slug: 'team_message',
    name: 'Team Message',
    desc: 'Send a peer message to a teammate (or read your inbox with inbox=true). Messages are durable, FIFO, de-duplicated. queued ≠ error — do not resend.',
    args: {
      to: { type: 'string', required: true, desc: 'teammate name' },
      text: { type: 'string', required: true, desc: 'message body' },
      inbox: { type: 'boolean', required: false, desc: 'return the teammate inbox instead of sending' },
    },
    handler: async (args) => {
      if (args.inbox) return { ok: true, inbox: readInbox(teamOf(args), args.to) };
      return sendMessage(teamOf(args), { from: 'lead', to: args.to, text: args.text });
    },
  });

  reg({
    slug: 'team_inbox',
    name: 'Team Inbox Claim',
    desc: 'Claim (FIFO) the next undelivered team message for a teammate — the message becomes that teammate\'s next turn input.',
    args: { member: { type: 'string', required: true, desc: 'teammate name' } },
    handler: async (args) => {
      const msg = claimNextMessage(teamOf(args), args.member);
      return msg ? { ok: true, message: msg } : { ok: true, empty: true };
    },
  });

  reg({
    slug: 'team_tasks_new',
    name: 'Team Tasks New/List',
    desc: 'List the shared task board (readyOnly=true → only unowned ready tasks), or create a task with title/dependsOn/writeScopes.',
    args: {
      title: { type: 'string', required: false, desc: 'create a task with this title' },
      dependsOn: { type: 'array', required: false, desc: 'task ids this task depends on (must form a DAG)' },
      writeScopes: { type: 'array', required: false, desc: 'workspace-relative prefixes this task intends to write (coordination hints, not locks)' },
      readyOnly: { type: 'boolean', required: false, desc: 'list only ready unowned tasks' },
    },
    handler: async (args) => {
      if (args.title) return createTask(teamOf(args), { title: args.title, dependsOn: args.dependsOn || [], scopes: args.writeScopes || [] });
      return { ok: true, tasks: listTasks(teamOf(args), { readyOnly: Boolean(args.readyOnly) }) };
    },
  });

  reg({
    slug: 'team_task_claim',
    name: 'Team Task Claim',
    desc: 'Claim a ready unowned task for a teammate (or the Lead via by="lead"). Stale revisions are rejected, never silently overwritten.',
    args: {
      taskId: { type: 'string', required: true },
      by: { type: 'string', required: false, desc: 'claiming member name (default lead)' },
    },
    handler: async (args) => claimTask(teamOf(args), args.taskId, args.by || 'lead'),
  });

  reg({
    slug: 'team_task_update',
    name: 'Team Task Update',
    desc: 'Edit/release a task you own (title, dependsOn, writeScopes, status). Requires the current expectedRevision.',
    args: {
      taskId: { type: 'string', required: true },
      expectedRevision: { type: 'number', required: true, desc: 'the task revision you read' },
      patch: { type: 'object', required: false, desc: '{ title?, dependsOn?, writeScopes?, status?, release? }' },
    },
    handler: async (args) => {
      const { taskId, expectedRevision, patch = {} } = args;
      return updateTask(teamOf(args), taskId, { ...patch, by: patch.by || 'lead' }, { expectedRevision });
    },
  });

  reg({
    slug: 'team_task_complete',
    name: 'Team Task Complete',
    desc: 'Mark a task completed (owner or Lead). Completing unblocks dependents.',
    args: {
      taskId: { type: 'string', required: true },
      expectedRevision: { type: 'number', required: true },
      by: { type: 'string', required: false },
    },
    handler: async (args) => completeTask(teamOf(args), args.taskId, { expectedRevision: args.expectedRevision, by: args.by || 'lead' }),
  });

  reg({
    slug: 'team_wait',
    name: 'Team Wait For Change',
    desc: 'Wait for the next roster/task/mailbox/status edge on the team (10s–1h). Returns timedOut=true on timeout; always re-read state after.',
    args: {
      sinceVersion: { type: 'number', required: false },
      timeoutMs: { type: 'number', required: false, desc: 'bounded between 10s and 1h (default 10s)' },
    },
    handler: async (args) => waitForChange(teamOf(args), { sinceVersion: args.sinceVersion, timeoutMs: args.timeoutMs }),
  });

  return () => unregisters.forEach((u) => { try { u(); } catch { /* noop */ } });
}
