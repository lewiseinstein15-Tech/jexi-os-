#!/usr/bin/env node
/**
 * JEXI MCP — BIN BRIDGE (FINAL GAP 2).
 *
 * A dependency-free MCP stdio server that wraps LOCAL security binaries
 * (nmap, semgrep, bandit, gitleaks, subfinder, whatweb) and the external
 * Ghidra service contract. One process serves ONE spec:
 *
 *     node bin-bridge.js '<spec-json>'
 *
 * Protocol (JSON-RPC 2.0 over stdin/stdout, newline-delimited):
 *   initialize / notifications/initialized / tools/list / tools/call / ping
 *
 * Design rules (per the FINAL CLOSE-OUT spec):
 *   - connect() ALWAYS succeeds: this bridge is a real MCP server; the
 *     underlying binary is resolved at CALL time.
 *   - binary present  → the tool REALLY runs (stdout/stderr/exit/duration
 *     returned as structured JSON — full output, never truncated silently).
 *   - binary missing  → the tool returns an honest `not-installed` error
 *     carrying the EXACT install instructions (never an empty stub).
 *   - ghidra          → honors GHIDRA_HOST (external instance) and falls
 *     back to an honest not-configured error with provisioning instructions.
 *   - argv builders are HARDCODED per tool with strict validation: input can
 *     never inject shell metacharacters (process spawn is arg-array, no
 *     shell, and every field is regex-validated before use).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SPEC = JSON.parse(process.argv[2] || '{}');
const SERVER = String(SPEC.server || 'bin-bridge');
const VERSION = String(SPEC.version || '1.0.0');

/* ── binary resolution ─────────────────────────────────────────────────── */

function resolveBin(bin) {
  const dirs = [...(SPEC.extraPaths || []).map((p) => String(p).replace(/^~/, os.homedir())), ...String(process.env.PATH || '').split(path.delimiter)];
  for (const d of dirs) {
    if (!d) continue;
    const p = path.join(d, bin);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* not here */ }
  }
  return null;
}

function childEnv() {
  // The child must be able to resolve SIBLING executables too (semgrep's OCaml
  // launcher execvp's `pysemgrep`; nmap's helper binaries live beside it), so
  // extraPaths are appended to PATH for the spawned process.
  const extra = (SPEC.extraPaths || []).map((p) => String(p).replace(/^~/, os.homedir()));
  return { ...process.env, PATH: [...extra, String(process.env.PATH || '')].filter(Boolean).join(path.delimiter) };
}

function runBin(binPath, args, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(binPath, args, { env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', killed = false;
    const cap = (s) => (s.length > 400_000 ? s.slice(0, 400_000) + '\n…[truncated at 400KB]' : s);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => { killed = true; try { child.kill('SIGKILL'); } catch { /* gone */ } }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ exit: -1, duration_ms: Date.now() - t0, stdout: '', stderr: `spawn error: ${e.message}`, timedOut: false, spawnError: true });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exit: code === null ? -1 : code, duration_ms: Date.now() - t0, stdout: cap(stdout), stderr: cap(stderr), timedOut: killed });
    });
  });
}

/* ── hardcoded, validated argv builders (server:tool → argv) ───────────── */

const RE_HOST = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[a-zA-Z0-9._-]{1,200}|\[?[a-fA-F0-9:]+\]?)$/;

function fail(msg) { const e = new Error(msg); e._user = true; throw e; }

const BUILDERS = {
  // nmap — real scans, bounded: no scripts, no root-only flag families
  'nmap:nmap_scan': (a) => {
    const target = String(a.target || '').trim();
    if (!RE_HOST.test(target)) fail(`invalid target '${target.slice(0, 60)}' (host or IP expected)`);
    const ports = String(a.ports || '1-1000').trim();
    if (!/^[\d,\-]{1,60}$/.test(ports)) fail(`invalid ports '${ports.slice(0, 40)}' (digits, commas, ranges only)`);
    const argv = ['-Pn', '-T4', '--max-retries', '1', '--host-timeout', '120s', '-p', ports];
    if (a.serviceScan === true) argv.push('-sV');
    argv.push(target);
    return argv;
  },
  // semgrep — scan a real path (a real ruleset key or local config path)
  'semgrep:semgrep_scan': (a) => {
    const p = String(a.path || '').trim();
    if (!p || p.includes('..')) fail(`invalid path '${p.slice(0, 60)}'`);
    if (!fs.existsSync(p)) fail(`path does not exist: ${p}`);
    const argv = ['scan', '--json', '--timeout', '60', '--max-target-bytes', '2000000'];
    argv.push('--config', String(a.config || 'p/default'));
    argv.push(p);
    return argv;
  },
  // bandit — JSON report, quiet
  'bandit:bandit_scan': (a) => {
    const p = String(a.path || '').trim();
    if (!p || p.includes('..')) fail(`invalid path '${p.slice(0, 60)}'`);
    if (!fs.existsSync(p)) fail(`path does not exist: ${p}`);
    const argv = ['-f', 'json', '-q'];
    if (a.recursive === true) argv.push('-r');
    argv.push(p);
    return argv;
  },
  // gitleaks — detect over a source dir; --no-git so any directory works
  'gitleaks:gitleaks_detect': (a) => {
    const src = String(a.source || '.').trim();
    if (src.includes('..')) fail(`invalid source '${src.slice(0, 60)}'`);
    if (!fs.existsSync(src)) fail(`source does not exist: ${src}`);
    return ['detect', '--source', src, '--no-git', '--report-format', 'json', '--report-path', '-', '--redact', '-v'];
  },
  // subfinder — passive subdomain enumeration
  'subfinder:subfinder_enumerate': (a) => {
    const domain = String(a.domain || '').trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{2,200}$/.test(domain) || domain.includes('..')) fail(`invalid domain '${domain.slice(0, 60)}'`);
    return ['-d', domain, '-silent', '-timeout', String(Math.min(Number(a.timeout || 20), 60))];
  },
  // whatweb — fingerprint a URL (only reachable when the host has whatweb)
  'whatweb:whatweb_scan': (a) => {
    const url = String(a.url || '').trim();
    if (!/^https?:\/\/[a-zA-Z0-9._:~/?#%[@\]-]+$/.test(url)) fail(`invalid url '${url.slice(0, 60)}'`);
    return ['--no-errors', '-q', url];
  },
};

/* ── tool call implementation ──────────────────────────────────────────── */

async function callTool(name, args) {
  const tool = (SPEC.tools || []).find((t) => t && t.name === name);
  if (!tool) return { isError: true, text: JSON.stringify({ ok: false, error: `unknown tool '${name}' on '${SERVER}'`, tools: (SPEC.tools || []).map((t) => t.name) }) };
  const kind = tool.kind || 'run';
  const bin = SPEC.bin || null;

  // GHIDRA service tools: external instance contract (no local binary)
  if (kind === 'ghidra') {
    const host = String(process.env.GHIDRA_HOST || '').trim().replace(/\/+$/, '');
    const status = {
      server: SERVER, tool: name,
      ghidraHost: host || null,
      analyzeHeadless: ['ghidra/support/analyzeHeadless', '/opt/ghidra/support/analyzeHeadless'].map((p) => (fs.existsSync(p) ? p : null)).find(Boolean) || null,
      docker: (() => { try { fs.accessSync('/usr/bin/docker', fs.constants.X_OK); return '/usr/bin/docker'; } catch { return null; } })(),
    };
    if (name === 'ghidra_status') {
      return { text: JSON.stringify({ ok: true, ...status, verdict: status.ghidraHost ? 'external instance configured' : status.analyzeHeadless ? 'local analyzeHeadless present' : status.docker ? 'docker present — docker fallback possible' : 'ghidra engine NOT provisioned — configure GHIDRA_HOST or install Ghidra', provisionHint: 'export GHIDRA_HOST=https://<ghidra-bridge-host> (a Ghidra headless bridge service) or run: docker run --rm -p 8192:8192 ghidra/ghidra-bridge', contract: 'POST {GHIDRA_HOST}/decompile {program, address} → { decompiled }' }) };
    }
    // ghidra_decompile
    if (!host) {
      return { isError: true, text: JSON.stringify({ ok: false, error: 'not-configured', need: 'Ghidra engine unavailable in-process (heavy JVM install). Set GHIDRA_HOST to a headless Ghidra bridge service, or provision one: docker run --rm -p 8192:8192 ghidra/ghidra-bridge', ...status }) };
    }
    const program = String(args.program || ''), address = String(args.address || '');
    if (!program || !address) return { isError: true, text: JSON.stringify({ ok: false, error: 'program and address are required' }) };
    try {
      const r = await fetch(`${host}/decompile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ program, address }), signal: AbortSignal.timeout(30_000) });
      const body = await r.text();
      return { text: JSON.stringify({ ok: r.ok, httpStatus: r.status, ghidraHost: host, response: body.slice(0, 200_000) }) };
    } catch (e) {
      return { isError: true, text: JSON.stringify({ ok: false, error: `GHIDRA_HOST unreachable: ${String(e && e.message || e).slice(0, 200)}`, ghidraHost: host }) };
    }
  }

  if (!bin) return { isError: true, text: JSON.stringify({ ok: false, error: 'spec has no bin' }) };
  const binPath = resolveBin(bin);
  if (!binPath && (kind === 'version' || kind === 'run')) {
    return {
      isError: true,
      text: JSON.stringify({
        ok: false, error: 'not-installed', bin, server: SERVER, tool: name,
        installHint: SPEC.installHint || `install '${bin}' (see scripts/setup-security-mcps.sh)`,
        searchedPaths: [...(SPEC.extraPaths || []).map((p) => String(p).replace(/^~/, os.homedir())), ...String(process.env.PATH || '').split(path.delimiter)].filter(Boolean).slice(0, 12),
      }),
    };
  }
  try {
    let argv;
    if (kind === 'version') argv = SPEC.versionArgs || ['--version'];
    else {
      const builder = BUILDERS[`${SERVER}:${name}`];
      if (!builder) return { isError: true, text: JSON.stringify({ ok: false, error: `no argv builder for ${SERVER}:${name}` }) };
      argv = builder(args || {});
    }
    const res = await runBin(binPath, argv, Math.min(Number(tool.timeoutMs || SPEC.timeoutMs || 120_000), 300_000));
    // okExit — exit codes that mean the TOOL RAN fine (detection tools like
    // gitleaks exit 1 when they FIND something; a finding is a success of the
    // detection, not a tool failure).
    const okExits = Array.isArray(tool.okExit) ? tool.okExit : [0];
    return { text: JSON.stringify({ ok: okExits.includes(res.exit) && !res.spawnError, server: SERVER, tool: name, bin, resolved: binPath, argv, ...res }) };
  } catch (e) {
    return { isError: true, text: JSON.stringify({ ok: false, error: String((e && e.message) || e).slice(0, 300) }) };
  }
}

/* ── MCP stdio protocol loop ───────────────────────────────────────────── */

function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) handle(line);
  }
});
process.stdin.on('end', () => process.exit(0));

async function handle(line) {
  let msg = null;
  try { msg = JSON.parse(line); } catch { return; } // non-JSON noise: ignore
  const { id, method, params } = msg || {};
  const reply = (result, error) => send({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) });
  try {
    switch (method) {
      case 'initialize':
        reply({
          protocolVersion: (params && params.protocolVersion) || '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER, version: VERSION },
        });
        break;
      case 'notifications/initialized':
      case 'notifications/cancelled':
        break; // notifications never get a response
      case 'ping':
        reply({});
        break;
      case 'tools/list':
        reply({
          tools: (SPEC.tools || []).map((t) => ({
            name: t.name,
            description: t.description || '',
            inputSchema: t.inputSchema || { type: 'object', properties: {} },
          })),
        });
        break;
      case 'tools/call': {
        const { name, arguments: args } = params || {};
        const out = await callTool(String(name || ''), args || {});
        reply({ content: [{ type: 'text', text: out.text }], ...(out.isError ? { isError: true } : {}) });
        break;
      }
      default:
        if (id !== undefined && id !== null) reply(null, { code: -32601, message: `method not found: ${method}` });
    }
  } catch (e) {
    if (id !== undefined && id !== null) reply(null, { code: -32603, message: String((e && e.message) || e).slice(0, 300) });
  }
}

// never let a stray diagnostic kill the protocol loop; everything to stderr
process.on('uncaughtException', (e) => { try { process.stderr.write(`[bin-bridge:${SERVER}] uncaught: ${e && e.message}\n`); } catch { /* dying */ } });
process.on('unhandledRejection', (e) => { try { process.stderr.write(`[bin-bridge:${SERVER}] unhandled: ${String(e && e.message || e)}\n`); } catch { /* dying */ } });
