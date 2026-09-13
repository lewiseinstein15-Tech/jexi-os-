#!/usr/bin/env node
/** Reproduce a single node:test file in isolation. Usage: reproduce-test.mjs <file> */
const file = process.argv[2];
if (!file) {
  console.error('usage: reproduce-test.mjs <test-file.js>');
  process.exit(64);
}
const { spawn } = await import('node:child_process');
const child = spawn('node', ['--test', '--test-reporter=spec', file], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));