/**
 * B110 — PENDING USER QUESTIONS (mirror of DeepSeek Harness
 * `packages/interaction/user-questions` + `tool-ask-user`).
 *
 * The model calls `ask_user_question` when it needs confirmation, a choice,
 * or missing information before proceeding. The questions are parked per
 * conversation; the frontend renders them as a question card, the user's
 * answers are recorded, and the NEXT model turn receives them as injected
 * context (DSH: the tool pauses until a human answers, then feeds the
 * answer back into the loop).
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';

const FILE = path.join(DATA_DIR, 'pending-questions.json');
const MAX_PENDING = 5;

let store = null;

function load() {
  if (store) return store;
  try { store = JSON.parse(fs.readFileSync(FILE, 'utf-8')); } catch { store = {}; }
  if (!store || typeof store !== 'object') store = {};
  return store;
}

function persist() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(store), 'utf-8'); } catch { /* noop */ }
}

/** Park questions for a conversation. @returns {{ok:true, questions:object[]}|{ok:false,error:string}} */
export function askQuestions(convId, questions) {
  const list = (Array.isArray(questions) ? questions : []).slice(0, MAX_PENDING).map((q, i) => ({
    id: String((q && q.id) || `q${i + 1}`).slice(0, 40),
    question: String((q && q.question) || '').slice(0, 500),
    header: (q && q.header) ? String(q.header).slice(0, 60) : undefined,
    options: Array.isArray(q && q.options) ? q.options.slice(0, 8).map((o) => ({
      label: String((o && o.label) || '').slice(0, 80),
      ...((o && o.description) ? { description: String(o.description).slice(0, 200) } : {}),
    })) : undefined,
    multiSelect: !!(q && q.multi_select),
  })).filter((q) => q.question);
  if (!list.length) return { ok: false, error: 'ask_user_question needs at least one question with text' };
  load()[String(convId || '')] = { at: Date.now(), questions: list, answers: null };
  persist();
  return { ok: true, questions: list };
}

/** Pending questions for a conversation (null when none). */
export function getPending(convId) {
  const entry = load()[String(convId || '')];
  return entry && !entry.answers ? { at: entry.at, questions: entry.questions } : null;
}

/**
 * Record the user's answers. `answers` = [{id, selected: [label], custom}].
 * Returns the recorded answers (for injection into the next turn).
 */
export function answerPending(convId, answers) {
  const key = String(convId || '');
  const entry = load()[key];
  if (!entry) return { ok: false, error: 'no pending questions for this conversation' };
  if (entry.answers) return { ok: false, error: 'questions already answered' };
  const incoming = Array.isArray(answers) ? answers : [];
  const recorded = (entry.questions || []).map((q) => {
    const a = incoming.find((x) => x && x.id === q.id);
    if (!a) return { id: q.id, selected: [], custom: '' };
    return {
      id: q.id,
      selected: Array.isArray(a.selected) ? a.selected.map(String) : [],
      custom: String(a.custom || '').slice(0, 500),
    };
  });
  entry.answers = recorded;
  persist();
  return { ok: true, answers: recorded };
}

/** The last recorded answers for a conversation (injected once, then cleared). */
export function takeAnswers(convId) {
  const key = String(convId || '');
  const entry = load()[key];
  if (!entry) return null;
  const answers = entry.answers || null;
  delete load()[key];
  persist();
  return answers;
}

/** Clear pending questions without answering (e.g. user cancels). */
export function clearPending(convId) {
  delete load()[String(convId || '')];
  persist();
}

/** Render answers as readable injected context for the next model turn. */
export function formatAnswers(answers) {
  if (!Array.isArray(answers) || !answers.length) return '';
  const lines = answers.map((a) => {
    const picks = a.selected && a.selected.length ? a.selected.join(', ') : '';
    const custom = a.custom ? a.custom : '';
    return `- ${a.id}: ${picks ? `selected: ${picks}` : ''}${custom ? (picks ? ` (custom: ${custom})` : `custom: ${custom}`) : (picks ? '' : '(no answer)')}`;
  });
  return `\n[User answers to your pending questions:\n${lines.join('\n')}\nContinue with this information.]\n`;
}
