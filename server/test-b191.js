/** B191 — project memory + profile completeness tests. */
import fs from 'fs';
import os from 'os';
import path from 'path';
let failures = 0;
const ok = (name, cond) => { console.log(`${cond ? '✅' : '❌'} ${name}`); if (!cond) failures += 1; };

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'b191t-'));

console.log('\n== 1. profile completeness (EVERY agent has a profile) ==');
{
  const PC = await import('./src/services/ProfileCompleteness.js');
  const made = PC.generateAllProfiles();
  const cov = PC.profileCoverage();
  ok(`all planner-deployable agents profiled (${cov.covered}/${cov.coverable})`, cov.covered === cov.coverable && cov.missing.length === 0);
  ok(`named Hermes profiles: ${cov.named.join(', ')}`, cov.named.length === 5);
  const qa = PC.ensureProfile('qa');
  ok('generated profile: config + SOUL + lane', qa.generated && qa.soul.length > 100 && qa.config.model?.prefer);
  const again = PC.ensureProfile('qa');
  ok('idempotent (second call reads, not regenerates)', again.dir === qa.dir);
  const idx = fs.readFileSync('./index.js', 'utf-8');
  ok('boot generates all + reports coverage', idx.includes('generateAllProfiles()') && idx.includes('agents profiled'));
  ok('/api/agents/coverage exposed', idx.includes('/api/agents/coverage'));
}

console.log('\n== 2. project memory: save → update → resume → close ==');
{
  const PM = await import('./src/services/ProjectMemory.js');
  const p = PM.saveProject({ name: 'Quiz App', goal: 'build a quiz app with categories', decisions: ['single file html'], nextSteps: ['add timer'] });
  ok('saved with id + workspace snapshot', p.id.startsWith('prj-') && Array.isArray(p.files));
  PM.updateProject(p.id, { addDecision: 'use vanilla js' });
  PM.updateProject(p.id, { addNextStep: 'score screen' });
  const brief = PM.resumeBrief('quiz app');
  ok('resume brief restores goal + decisions + steps', brief.includes('quiz app') && brief.includes('vanilla js') && brief.includes('score screen'));
  ok('resume brief forbids restarting from scratch', brief.includes('Do not restart'));
  const list = PM.listProjects();
  ok('listing works', list.length === 1 && list[0].name === 'Quiz App');
  PM.closeProject('Quiz App');
  ok('close archives it', PM.listProjects()[0].status === 'done');
}

console.log('\n== 3. chat intent wiring ==');
{
  const idx = fs.readFileSync('./index.js', 'utf-8');
  ok('"remember this project" intent wired', idx.includes('B191 — PROJECT MEMORY'));
  ok('continue → restore brief routed through the pipeline', idx.includes('Continue this project.'));
  ok('"my projects" + "is done" handled', idx.includes('My projects') && idx.includes('closeProject'));
}

console.log(failures === 0 ? '\n🎉 B191 CHECKS PASSED' : `\n💥 ${failures} FAILURES`);
process.exit(failures ? 1 : 0);
