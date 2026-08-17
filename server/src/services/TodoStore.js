/**
 * JEXI OS — Todo Store (B96, DSH-style todo tool).
 * A small per-process task list the model manages via the `todo` tool.
 * Persisted to DATA_DIR/todo.json so it survives restarts.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';

const FILE = path.join(DATA_DIR, 'todo.json');
let todos = load();

function load() {
  try {
    if (fs.existsSync(FILE)) {
      const p = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
      if (Array.isArray(p)) return p;
    }
  } catch { /* fresh */ }
  return [];
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(todos, null, 2), 'utf-8');
  } catch { /* noop */ }
}

export function todoList() {
  return todos.map((t, i) => ({ index: i, text: t.text, done: !!t.done }));
}

export function todoAdd(text) {
  if (text) todos.push({ text: String(text).slice(0, 300), done: false, at: Date.now() });
  save();
  return todoList();
}

export function todoComplete(index) {
  const t = todos[index];
  if (t) t.done = true;
  save();
  return todoList();
}

export function todoRemove(index) {
  if (index >= 0 && index < todos.length) todos.splice(index, 1);
  save();
  return todoList();
}
