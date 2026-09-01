/** B187 — the annoyance fixes from the user's real chat log. */
import fs from 'fs';
let failures = 0;
const ok = (name, cond) => { console.log(`${cond ? '✅' : '❌'} ${name}`); if (!cond) failures += 1; };

const { sanitizeOutgoingLinks } = await import('./src/services/Formatting.js');

console.log('\n== 1. localhost links are rewritten to public URLs ==');
{
  const out = sanitizeOutgoingLinks('App at http://localhost:5173/preview/weather-app — enjoy!', 'https://jexi-brain-image.onrender.com');
  ok('localhost:5173 → public /preview/weather-app', out === 'App at https://jexi-brain-image.onrender.com/preview/weather-app — enjoy!');
  ok('127.0.0.1 rewritten', sanitizeOutgoingLinks('http://127.0.0.1:3000/x', 'https://b.example').includes('https://b.example/x'));
  ok('private LAN IPs rewritten', !/192\.168\.|10\.\d+\./.test(sanitizeOutgoingLinks('http://192.168.1.5:8080/app', 'https://b.example')));
  ok('real internet links untouched', sanitizeOutgoingLinks('see https://github.com/ok', 'https://b.example').includes('https://github.com/ok'));
  ok('host-only localhost → base root', sanitizeOutgoingLinks('http://localhost:9999', 'https://b.example') === 'https://b.example/');
}

console.log('\n== 2. chat route applies it to every summary ==');
{
  const idx = fs.readFileSync('./index.js', 'utf-8');
  ok('PUBLIC_BASE computed from the request headers', idx.includes("x-forwarded-host"));
  ok('done() rewrites localhost summaries', idx.includes('sanitizeOutgoingLinks(payload.summary'));
}

console.log('\n== 3. taught: no localhost, act-don\'t-ask ==');
{
  const rules = fs.readFileSync('./src/services/Formatting.js', 'utf-8');
  ok('FORMAT_RULES forbids localhost links', rules.includes('NEVER output localhost'));
  ok('FORMAT_RULES: obvious follow-ups get DONE, not questioned', rules.includes("ACT, DON'T ASK"));
  ok('fake "verified" claims forbidden', rules.includes('Never claim a link is "verified"'));
  const dsh = fs.readFileSync('./src/services/DshCoding.js', 'utf-8');
  ok('coding agent prompt requires relative /preview links', dsh.includes('RELATIVE (/preview/<file>)'));
}

console.log(failures === 0 ? '\n🎉 B187 CHECKS PASSED' : `\n💥 ${failures} FAILURES`);
process.exit(failures ? 1 : 0);
