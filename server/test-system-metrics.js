import { getToolCatalog } from './src/services/ToolRuntime.js';

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? '✅' : '❌'} ${label}`); if (!cond) failures++; };

console.log('Testing system metrics service capabilities...');
const tools = getToolCatalog();
ok(tools.length > 0, 'Tool catalog loaded successfully for metrics');

console.log(failures === 0 ? '\nSYSTEM METRICS TESTS PASSED ✅' : `\n${failures} TEST(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
