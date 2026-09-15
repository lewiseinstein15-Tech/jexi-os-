/**
 * JEXI OS — Phase 6 Scope C: context manager — packing.
 *
 * Turns budgeted sections into the message array a model actually receives.
 * Ordering is deliberate: a system message, then one context user message,
 * then the live instruction last (recency wins attention). A token-budget
 * guard trims the context message if the assembly is still over.
 */

import { estimateTokens, estimateMessagesTokens } from '../../services/TokenMeter.js';

/**
 * @param {Array<{name,content,keep?}>} sections
 * @param {{system?:string,instruction?:string,maxTokens?:number}} opts
 */
export function packMessages(sections = [], opts = {}) {
  const maxTokens = Number(opts.maxTokens) || 8000;
  const messages = [];

  if (opts.system) messages.push({ role: 'system', content: String(opts.system) });

  const instruction = opts.instruction != null ? String(opts.instruction)
    : (sections.find((s) => s.name === 'instruction')?.content || '');
  const contextSections = sections.filter((s) => s.name !== 'instruction' && s.name !== 'system');

  if (contextSections.length) {
    messages.push({ role: 'user', content: contextSections.map((s) => s.content).join('\n\n') });
  }
  messages.push({ role: 'user', content: instruction || '(no instruction)' });

  const trimmed = [];
  const over = () => estimateMessagesTokens(messages) > maxTokens;
  // Drop/trim the context message only; the system + live instruction always stay.
  while (over() && messages.length > 2) {
    const ctxIdx = messages.findIndex((m, i) => i > 0 && m.role === 'user' && i < messages.length - 1);
    if (ctxIdx < 0) break;
    trimmed.push('dropped:context');
    messages.splice(ctxIdx, 1);
  }
  if (over() && messages.length === 2 && messages[1].content.length > 400) {
    const cap = Math.max(400, Math.floor(messages[1].content.length / 2));
    messages[1] = { ...messages[1], content: `${messages[1].content.slice(0, cap)}…` };
    trimmed.push('clipped:instruction');
  }

  return { messages, usage: { tokens: estimateMessagesTokens(messages), chars: messages.reduce((n, m) => n + m.content.length, 0) }, trimmed };
}

export { estimateTokens };