#!/usr/bin/env node
/**
 * P10 GAP 6 — PERSONA COUNT CLARITY — acceptance test.
 *
 * Spec: boot log readout must show both numbers labelled distinctly
 * (planner specs vs live agent roster); personas are loaded explicitly at
 * boot and surfaced in the roster; the self-awareness query "how many
 * agents?" returns the ROSTER count, NOT the planner-spec count.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'server');
const PORT = Number(process.env.JEXI_P10G6_PORT || 3066);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p10-gap6-'));
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, JEXI_MCP_MINIMAL: '1', NODE_ENV: 'production' };
  const child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let bootLog = '';
  child.stdout.on('data', (d) => { bootLog += d.toString(); });
  child.stderr.on('data', (d) => { bootLog += d.toString(); });
  const base = `http://127.0.0.1:${PORT}`;
  let pass = 0, total = 0;
  try {
    let up = false;
    for (let i = 0; i < 90; i++) { try { const r = await fetch(`${base}/api/health`); if (r.ok) { up = true; break; } } catch {} await wait(1000); }
    if (!up) { console.log(`[BOOT FAIL] tail:\n${bootLog.split('\n').slice(-20).join('\n')}`); process.exit(1); }

    const lines = bootLog.split('\n');
    const profilesLine = lines.find((l) => /^\[Profiles\]/.test(l)) || '';
    const personasLine = lines.find((l) => /^\[Personas\]/.test(l)) || '';
    const rosterLine = lines.find((l) => /^\[Roster\]/.test(l)) || '';

    /* A — boot log: planner specs labelled distinctly, old wording gone */
    total++;
    const profilesOk = /\[Profiles\] \d+ named \+ \d+ planner-roles = \d+ planner-specs/.test(profilesLine) && /NOT live agents/i.test(profilesLine) && !/agents profiled/.test(profilesLine);
    if (profilesOk) pass++;
    console.log(`[${profilesOk ? 'PASS' : 'FAIL'}] A [Profiles] line labelled distinctly (planner-specs, not agents)`);
    console.log(`  ${profilesLine.trim()}`);

    /* B — boot log: personas loaded explicitly at boot */
    total++;
    const personasOk = /\[Personas\] \d+ personas loaded \(\d+ builtin \+ \d+ user\)/.test(personasLine) && /distinct from/i.test(personasLine);
    if (personasOk) pass++;
    console.log(`[${personasOk ? 'PASS' : 'FAIL'}] B [Personas] line — personas loaded explicitly at boot`);
    console.log(`  ${personasLine.trim()}`);

    /* C — boot log: roster line labelled LIVE and distinct from both */
    total++;
    const rosterOk = /\[Roster\].*LIVE agents/.test(rosterLine) && /personas/.test(rosterLine) && /planner-role specs/.test(rosterLine);
    if (rosterOk) pass++;
    console.log(`[${rosterOk ? 'PASS' : 'FAIL'}] C [Roster] line — LIVE agents + planner-role specs + personas, all distinct`);
    console.log(`  ${rosterLine.trim()}`);

    /* D — self-awareness: "how many agents?" returns the ROSTER count */
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-jexi-session': `gap6-${Date.now()}` },
      body: JSON.stringify({ query: 'how many agents do you have?' }),
    });
    const text = await res.text();
    let answer = '';
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === 'done') answer = String(ev.summary || ev.answer || '');
    }
    // the roster's real agent total, read live from the same registry the answer uses
    const rosterMod = await import(path.join(ROOT, 'mind/brain/roster.js'));
    const r = await rosterMod.roster({ refresh: true });
    const rosterTotal = String(r.agents?.total ?? '');
    const specTotals = [String((r.agents?.plannerSpecs?.covered ?? '')), String((r.agents?.plannerSpecs?.roles ?? '')), String((r.agents?.plannerSpecs?.named ?? '') + (r.agents?.plannerSpecs?.roles ?? 0))];
    total++;
    const includesRoster = answer.includes(rosterTotal) && rosterTotal.length > 0;
    const mentionsDistinction = /planner/i.test(answer) || /not additional/i.test(answer) || /voice overlays/i.test(answer);
    // the agent count must NOT be a planner-spec number standing alone
    const notSpecOnly = !new RegExp(`^I have \\*\\*(${specTotals.filter(Boolean).join('|')}) specialist agents`, 'i').test(answer);
    const ok = includesRoster && notSpecOnly && mentionsDistinction;
    if (ok) pass++;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] D "how many agents?" → roster count ${rosterTotal}, NOT the planner-spec count`);
    console.log(`  roster total: ${rosterTotal} | planner specs (covered/roles/named): ${r.agents?.plannerSpecs?.covered}/${r.agents?.plannerSpecs?.roles}/${r.agents?.plannerSpecs?.named} | personas: ${r.personas?.total}`);
    console.log(`  answer: ${JSON.stringify(answer.slice(0, 460))}`);

    /* E — roster surface: personas are their own section */
    total++;
    const personasSectionOk = r.personas && typeof r.personas.total === 'number' && r.personas.total > 0;
    if (personasSectionOk) pass++;
    console.log(`[${personasSectionOk ? 'PASS' : 'FAIL'}] E brain.roster() carries personas as their own population`);
    console.log(`  personas section: ${JSON.stringify(r.personas)}`);
  } finally {
    try { child.kill('SIGTERM'); } catch {}
    await wait(500);
    try { child.kill('SIGKILL'); } catch {}
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
  console.log(`\nP10 GAP 6 PERSONA CLARITY TEST: ${pass}/${total} PASS`);
  process.exit(pass === total ? 0 : 1);
}
await main();
