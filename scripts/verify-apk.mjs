// B165 — APK content verifier. Run AFTER every gradle build, BEFORE release.
// Catches the two silent killers we shipped with v0.9/v0.10:
//   1) stale web bundle inside the APK (cap sync never copied dist) 
//   2) corrupt launcher icon PNGs (make-icon.js CRC bug)
// Usage: node scripts/verify-apk.mjs [path-to-apk] 
// Exit 0 = safe to release; exit 1 = DO NOT RELEASE.

import { execSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APK = process.argv[2] || join(ROOT, 'android/app/build/outputs/apk/debug/app-debug.apk');
const EXPECT_MIN_VERSION = parseInt(process.env.EXPECT_MIN_VERSION || '1006000', 10);

let fails = 0;
const ok = (m) => console.log('  ✓', m);
const bad = (m) => { console.log('  ✗', m); fails++; };

// ---- 1. versionCode / applicationId via aapt ----
const AAPT = execSync("ls /home/z/android-sdk/build-tools/*/aapt | tail -1").toString().trim();
const badging = execSync(`"${AAPT}" dump badging "${APK}"`).toString();
const pkg = badging.match(/package: name='([^']+)' versionCode='(\d+)'/);
if (!pkg) bad('aapt could not parse package line');
else {
  const [, appId, vc] = pkg;
  appId === 'com.jexi.os' ? ok(`applicationId ${appId}`) : bad(`applicationId is ${appId}, expected com.jexi.os`);
  parseInt(vc, 10) >= EXPECT_MIN_VERSION ? ok(`versionCode ${vc} ≥ ${EXPECT_MIN_VERSION}`) : bad(`versionCode ${vc} < ${EXPECT_MIN_VERSION} — Android would refuse the update`);
}

// ---- 2. web bundle inside the APK: markers ----
const tmp = mkdtempSync(join(tmpdir(), 'apkver-'));
execSync(`unzip -o -q "${APK}" "assets/public/assets/index-*.js" -d "${tmp}"`);
const jsDir = join(tmp, 'assets/public/assets');
const bundle = readdirSync(jsDir).find((f) => f.startsWith('index-'));
const js = readFileSync(join(jsDir, bundle), 'utf8');
bundle ? ok(`web bundle ${bundle} (${(js.length / 1024 / 1024).toFixed(2)} MB)`) : bad('no index-*.js bundle inside APK');

const mustHave = ['JEXI BRAIN ONLINE', 'WAKING'];           // live console v0.9+ strings
const mustNotHave = ['gemini-2.5-pro', 'Fix the flaky auth', '"Forge"']; // mock-era strings
for (const m of mustHave) js.includes(m) ? ok(`marker present: "${m}"`) : bad(`marker MISSING: "${m}" (stale v0.8 bundle shipped this way)`);
for (const m of mustNotHave) js.includes(m) ? bad(`stale marker FOUND: "${m}" — the old mock bundle is in this APK`) : ok(`no stale marker: "${m}"`);

// ---- 3. launcher icon PNGs decode (CRC integrity) ----
execSync(`unzip -o -q "${APK}" "res/mipmap-xxxhdpi-v4/*" -d "${tmp}"`);
const icon = join(tmp, 'res/mipmap-xxxhdpi-v4/ic_launcher.png');
try {
  execSync(`python3 -c "from PIL import Image; im=Image.open('${icon}'); im.load(); assert im.size==(192,192)"`, { stdio: 'pipe' });
  ok('launcher icon (xxxhdpi) is a valid, CRC-clean PNG 192×192');
} catch {
  bad('launcher icon PNG is corrupt (PIL refused) — phone launcher would fall back to stock');
}

rmSync(tmp, { recursive: true, force: true });
console.log(fails === 0 ? `\nAPK VERIFIED — safe to release (${APK})` : `\n${fails} CHECK(S) FAILED — DO NOT RELEASE`);
process.exit(fails === 0 ? 0 : 1);
