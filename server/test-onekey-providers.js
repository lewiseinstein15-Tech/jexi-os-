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

// ---------------------------------------------------------------------------
// B-KILO — Kilo Gateway (api.kilo.ai via github.com/AnganSamadder/openkilo).
// Keyless AND tool-capable, which is what distinguishes it from Pollinations.
// ---------------------------------------------------------------------------
ok(llm.includes("kiloKey: process.env.KILO_API_KEY"), 'kilo key resolves (env/settings)');
ok(llm.includes("const KILO_MODELS = ['kilo-auto/free'"), 'kilo models = live-verified free ids');
ok(llm.includes("kilo: tryKilo"), 'kilo leg registered in PROVIDER_CALLS');
ok(llm.includes('api.kilo.ai/api/openrouter'), 'kilo base URL is the gateway endpoint');
// The keyless tier 401s on a dummy bearer, so the header must be OMITTED.
ok(llm.includes('function authHeaders(key)'), 'kilo uses the omit-when-empty header helper');
ok(llm.includes('allowEmptyKey'), 'kilo opts into the empty-key (keyless) path');
ok(llm.includes("kilo: { key: keys.kiloKey"), 'kilo tool config carries the (possibly empty) key');
ok(llm.includes('KILO_API_URL'), 'kilo base URL is overridable (test seam)');
// The keyless floor must survive the STREAMING path too: streamPlainText is
// what the TUI and chat use, and an unguarded `!cfg.key` skip there silently
// dropped kilo from every streamed turn (found live, fixed here).
const keylessGuards = llm.split("(!cfg.key && provider !== 'kilo')").length - 1;
ok(keylessGuards >= 2, 'both the streaming and tool paths reach the keyless kilo leg (got ' + keylessGuards + ')');
ok(!/if \(!cfg \|\| !cfg\.key\) continue;/.test(llm), 'no unguarded key-skip remains in the streaming path');
ok(llm.includes('tried the keyless Kilo and Pollinations legs'), 'the honest failure message names both keyless legs');

// Kilo must be TOOL_CAPABLE — this is its entire reason for existing here.
const { TOOL_CAPABLE } = await import('./src/providers/runtime/LLMClient.js');
ok(TOOL_CAPABLE.has('kilo'), 'kilo is tool-capable (native tool calls on the keyless tier)');
ok(TOOL_CAPABLE.has('pollinations') === false, 'pollinations is still text-only (contrast)');

// Ladder: kilo is keyless like pollinations, but sits ABOVE it (tools > text).
ok(router.includes("'huggingface', 'kilo', 'pollinations'"), 'kilo rides just above pollinations on every ladder');
ok(router.includes("if (!list.includes('kilo')) list.push('kilo')"), 'kilo always reported configured (keyless)');
ok(router.includes("kilo: 'Kilo Gateway (keyless)'"), 'kilo has a health-view label');
ok(index.includes('kilo: (process.env.KILO_API_KEY'), 'kilo surfaces in /api/settings/status');

// WorkerRouter — the keyless fail-soft floor must contain kilo, ordered
// before pollinations, and must never let either LEAD the chain.
const wr = fs.readFileSync(new URL('./src/providers/catalog/WorkerRouter.js', import.meta.url), 'utf8');
ok(wr.includes("if (k === 'kilo') return true;"), 'kilo leg is always considered configured');
ok(/out\.push\(\{ key: 'kilo' \}\)[\s\S]{0,120}out\.push\(\{ key: 'pollinations' \}\)/.test(wr), 'kilo precedes pollinations on the keyless floor');
ok(wr.includes("k !== 'pollinations' && k !== 'kilo'"), 'neither keyless leg can lead a worker chain');

console.log(`\nONEKEY-PROVIDERS: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
