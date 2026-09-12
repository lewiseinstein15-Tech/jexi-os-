// One-key free routers: Pollinations (keyless, GitHub open-source) + Cloudflare
// Workers AI (one free token → 50+ models). Guards the wiring so the free
// legs can never silently detach from the router ladder.
import fs from 'node:fs';

const llm = fs.readFileSync(new URL('./src/providers/runtime/LLMClient.js', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('./src/providers/runtime/ProviderRouter.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); }
};

// --- LLMClient: keys resolve from env or settings ---
ok(llm.includes("pollinationsKey: process.env.POLLINATIONS_API_KEY"), 'pollinations key resolves (env/settings)');
ok(llm.includes("cloudflareKey: process.env.CLOUDFLARE_API_TOKEN"), 'cloudflare token resolves (env/settings)');
ok(llm.includes("cloudflareAccount: process.env.CLOUDFLARE_ACCOUNT_ID"), 'cloudflare account id resolves (env/settings)');
// --- LLMClient: live-verified model ids ---
ok(llm.includes("const POLLINATIONS_MODELS = ['openai', 'openai-fast']"), 'pollinations models = live-verified ids');
ok(llm.includes('@cf/meta/llama-3.3-70b-instruct-fp8-fast') && llm.includes('@cf/qwen/qwen3-30b-a3b-fp8'), 'cloudflare models = free-tier @cf ids');
// --- LLMClient: keyless leg is never skipped for a missing key ---
ok(llm.includes("resolveKeys().pollinationsKey || 'pollinations-keyless'"), 'pollinations sends dummy bearer when keyless (never skipped)');
ok(llm.includes('gen.pollinations.ai/v1'), 'pollinations base URL is the OpenAI-compat endpoint');
ok(llm.includes('/client/v4/accounts/${k.cloudflareAccount}/ai/v1'), 'cloudflare base URL carries the account id');
ok(llm.includes('pollinations: tryPollinations') && llm.includes('cloudflare: tryCloudflare'), 'both legs registered in PROVIDER_CALLS');
// --- ProviderRouter: ladder placement (cloudflare in free extras, pollinations dead last) ---
ok(router.includes("const EXTRA_PROVIDERS = ['mistral', 'nvidia', 'cloudflare']"), 'cloudflare rides the free-extras rung');
// every ladder (code / vision / research / fast / default) must END with the
// keyless Pollinations leg — verified functionally, not by source layout.
const { providerOrder } = await import('./src/providers/runtime/ProviderRouter.js');
const lanes = ['code', 'vision', 'research', 'fast', ''];
const lastOf = (arr) => arr[arr.length - 1];
const ladderTails = lanes.map((prefer) => lastOf(providerOrder(prefer)));
ok(ladderTails.every((x) => x === 'pollinations'), 'pollinations is last on all ladders');
ok(router.includes("if (!list.includes('pollinations')) list.push('pollinations')"), 'pollinations always reported configured (keyless)');
ok(router.includes("cloudflare: 'CLOUDFLARE_API_TOKEN'"), 'cloudflare in ENV_MAP');
// --- server/index.js: visible in settings status ---
ok(index.includes('cloudflare: statusOf(') && index.includes('pollinations:'), 'both legs surface in /api/settings/status');

console.log(`\nONEKEY-PROVIDERS: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
