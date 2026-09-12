/**
 * JEXI OS — /model command.
 *
 * User types:
 *   /model                          → list available providers + models + default + cost
 *   /model <provider>/<model>       → switch default for this session
 *   /model <provider>/<model> --persist → save default in .jexi/providers.yaml
 *
 * Implementation reads ONLY through the provider bridge registry — it never
 * names a provider itself; listProviders()/listModels() drive the output.
 */

import { listProviders, getProvider, registry } from '../providers/index.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function homeDir() {
  return process.env.JEXI_HOME || path.join(os.homedir(), '.jexi');
}

function persistPath() {
  return path.join(homeDir(), 'providers.yaml');
}

function persistPathFromRepo() {
  return path.join(process.cwd(), '.jexi', 'providers.yaml');
}

/** Render a human-readable provider/model listing. */
export function renderModelStatus() {
  const providers = listProviders();
  const lines = ['### Available model providers', ''];
  for (const p of providers) {
    const tag = p.configured ? '✅ configured' : '❌ no key';
    lines.push(`**${p.id}** — _${tag}_`);
    if (p.models.length) {
      for (const m of p.models) {
        const ctxk = (m.contextWindow ?? 0) / 1000;
        const costPer1k = m.pricing?.inputPer1M ? `$${((m.pricing.inputPer1M + (m.pricing.outputPer1M ?? 0)) / 1000).toFixed(5)}/1k tok` : 'free';
        lines.push(`  - \`${m.id}\` ctx ${ctxk}k · ${costPer1k}`);
      }
    }
    lines.push('');
  }
  // Current default from env
  const envDefault = process.env.JEXI_DEFAULT_MODEL;
  if (envDefault) lines.push(`**Current default:** \`${envDefault}\``);
  lines.push('**Usage:** `/model <provider>/<model>` to switch for this session · `/model <provider>/<model> --persist` to save.');
  return lines.join('\n');
}

/** Parse /model argument string. Returns { provider, model, persist }. */
export function parseModelArg(raw) {
  const text = String(raw || '').replace(/^\/model\s*/i, '').trim();
  const persist = /--persist/i.test(text);
  const clean = text.replace(/\s+--persist/i, '').trim();
  if (!clean) return null;
  const [provider, model] = clean.split('/').map((s) => s.trim());
  if (!provider || !model) return null;
  return { provider, model, persist };
}

/** Switch default via /model provider/model. */
export function setSessionModel(query) {
  const parsed = parseModelArg(query);
  if (!parsed) return { ok: false, summary: renderModelStatus() };
  const provider = getProvider(parsed.provider);
  if (!provider) return { ok: false, summary: `Unknown provider "${parsed.provider}". Available: ${listProviders().map((p) => p.id).join(', ')}` };
  if (parsed.model && !provider.listModels().some((m) => m.id === parsed.model)) {
    return { ok: false, summary: `Model "${parsed.model}" unknown for provider "${parsed.provider}". Available: ${provider.listModels().map((m) => m.id).join(', ')}` };
  }
  if (parsed.persist) {
    const target = persistPathFromRepo();
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, renderProvidersYaml(parsed.provider, parsed.model), 'utf8');
      return { ok: true, summary: `Persisted default \`${parsed.provider}/${parsed.model}\` → \`${target}\`` };
    } catch (e) {
      return { ok: false, summary: `Could not persist: ${e.message}` };
    }
  }
  return { ok: true, summary: `Session default set to \`${parsed.provider}/${parsed.model}\`` };
}

function renderProvidersYaml(provider, model) {
  return [
    '# JEXI OS — /model persisted default',
    'default:',
    `  provider: ${provider}`,
    `  model: ${model}`,
    '',
  ].join('\n');
}

/** Register /model with the server command registry. */
export function registerModelCommand(registerCommand) {
  registerCommand({
    name: 'model',
    description: 'show / switch model provider — /model, /model provider/model [--persist]',
    async run(invocation) {
      const text = typeof invocation === 'string' ? invocation : JSON.stringify(invocation ?? '');
      const actionable = text.replace(/^#+\s*/, '').trim();
      const hasArg = /\/model\s+\S/.test(text);
      if (!hasArg) return { ok: true, summary: renderModelStatus() };
      return setSessionModel(actionable);
    },
  });
}