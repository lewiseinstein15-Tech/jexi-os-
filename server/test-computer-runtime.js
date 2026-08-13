/**
 * JEXI OS — test suite for the computer runtime abstraction (roadmap stage 18).
 */
import { computerStatus, providerCapabilities, runtimeCall } from './src/services/ComputerRuntime.js';

let passed = 0;
let failed = 0;
const ok = (cond, name) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

console.log('\n== Capabilities ==');
ok(providerCapabilities('local').terminal === true, 'local has terminal');
ok(providerCapabilities('local').browser === false, 'local has no browser');
ok(providerCapabilities('remote').browser === true, 'remote has browser');
ok(providerCapabilities('remote').screenshot === true, 'remote has screenshot');
ok(providerCapabilities('docker').browser === false, 'docker not wired (honest)');

console.log('\n== Status ==');
const st = computerStatus();
ok(['local', 'remote', 'docker', 'mock'].includes(st.provider), 'active provider is a known provider');
ok(st.providers.length === 4, 'all four providers reported');

console.log('\n== Mock runtime (deterministic) ==');
const mockStatus = await runtimeCall('status', {}, 'mock');
ok(mockStatus.ok === true && mockStatus.provider === 'mock', 'mock status');
const page = await runtimeCall('page-text', {}, 'mock');
ok(String(page.text || '').includes('Mock browser'), 'mock page text');
const elements = await runtimeCall('elements', {}, 'mock');
ok(elements.elements?.length >= 1, 'mock elements indexed');
const exec = await runtimeCall('execute', { command: 'echo hi' }, 'mock');
ok(String(exec.output || '').includes('echo hi'), 'mock execute echoes command');

console.log('\n== Local runtime (real terminal, honest browser) ==');
const localStatus = await runtimeCall('status', {}, 'local');
ok(localStatus.ok === true && localStatus.provider === 'local', 'local status');
const localExec = await runtimeCall('execute', { command: 'echo hello-runtime-test' }, 'local');
ok(String(localExec.output || '').includes('hello-runtime-test'), 'local execute runs real commands');
const localGoto = await runtimeCall('goto', { url: 'https://example.com' }, 'local');
ok(localGoto.unavailable === true, 'local goto is honestly unavailable');

console.log('\n== Docker (declared, unwired) ==');
const dockerCall = await runtimeCall('status', {}, 'docker');
ok(dockerCall.unavailable === true, 'docker reports not wired');

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
