#!/usr/bin/env node
// Phase 11 Scope H — CLI for the unified Phase 11 doctor.
//   node capability/doctor/cli.js          human-readable report (exit 0 healthy / 1 unhealthy)
//   node capability/doctor/cli.js --json   machine-readable report (same exit codes)
//
// SCOPED to Phase 11 subsystems (codegraph daemon, code graph, reach, MCP
// servers). The Phase 7 G `/doctor` slash command (commands/doctor.command.js)
// remains the environment health entry point — this CLI registers no command
// and shadows nothing.

import { runDoctor, formatDoctor } from './index.js';

const asJson = process.argv.includes('--json');
const project = (() => {
  const i = process.argv.indexOf('--project');
  return i >= 0 ? process.argv[i + 1] : 'jexi-os';
})();

const report = await runDoctor({ project });
if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatDoctor(report));
}
process.exit(report.healthy ? 0 : 1);
