#!/usr/bin/env node
// Phase 11 — index a repository into the code knowledge graph.
// Usage: node scripts/phase11-index.mjs [--root DIR] [--project NAME] [--db DIR] [--no-fresh]

import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { openGraphStore } from '../capabilities/graph/code/graph/store.js';
import { indexRepository } from '../capabilities/graph/code/graph/index.js';

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};

const root = path.resolve(arg('root') || execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim());
const project = arg('project', path.basename(root));
const db = path.resolve(arg('db') || path.join(root, 'capability/code/graph/db'));
const fresh = !args.includes('--no-fresh');

console.error(`[phase11-index] root=${root}`);
console.error(`[phase11-index] project=${project} db=${db} fresh=${fresh}`);
const store = await openGraphStore(db, { project });
const stats = await indexRepository({ root, store, project, fresh });
store.close();
console.log(JSON.stringify(stats, null, 2));
