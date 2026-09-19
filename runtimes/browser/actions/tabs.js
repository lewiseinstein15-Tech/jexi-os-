/**
 * JEXI OS — Phase 17 Scope B — TAB, WINDOW, IFRAME AND DIALOG ACTIONS.
 *
 * Tabs are CDP targets. Obscura supports Target.createTarget, attachToTarget
 * and closeTarget, so tabs are real. Note that GET /json/new is NOT supported
 * by Obscura (the connection resets); this module therefore always creates
 * targets through the protocol, never through the HTTP endpoint.
 *
 * ── DIALOGS: A DOCUMENTED EMULATION ────────────────────────────────────────
 * Probed against Obscura 0.2.2: `Page.handleJavaScriptDialog` returns -32601
 * ("Unknown Page method") and `Page.javascriptDialogOpening` never fires.
 * alert()/confirm()/prompt() do not block the page and raise no event.
 *
 * The supported route is `Page.addScriptToEvaluateOnNewDocument`, which DOES
 * work. dialogs.js injects a capture shim on every new document: dialog calls
 * are recorded with their messages and return caller-configured values. The
 * actions below drive that shim and report `via: "injected-shim"` so the
 * emulation is never mistaken for the native protocol.
 */

import { ActionError } from './registry.js';
import { TARGET_SCHEMA, describeTarget } from './resolve.js';

const HTTP_BASE = (session) => session.client.wsUrl.replace(/^ws:/, 'http:').replace('/devtools/browser', '');

export function tabActions() {
  return [
    {
      name: 'list_tabs',
      description: 'List open tabs (CDP targets) with their titles and URLs.',
      risk: 'low',
      permissions: ['read'],
      timeout_ms: 15_000,
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      output_schema: {
        type: 'object',
        properties: { count: { type: 'integer' }, tabs: { type: 'array' } },
        required: ['count', 'tabs'],
      },
      handler: async (_i, { session }) => {
        const targets = await session.client.listTargets();
        const pages = targets.filter((t) => t.type === 'page');
        return {
          count: pages.length,
          tabs: pages.map((t) => ({ id: t.id, title: t.title, url: t.url, is_active: t.id === session.targetId })),
        };
      },
    },
    {
      name: 'new_tab',
      description: 'Open a new tab, optionally navigating to a URL, and make it the active session.',
      risk: 'medium',
      permissions: ['navigate'],
      timeout_ms: 45_000,
      retries: 1,
      input_schema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Initial URL (default about:blank)' }, focus: { type: 'boolean', description: 'Make the new tab active (default true)' } },
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { created: { type: 'boolean' }, target_id: { type: 'string' }, session_id: { type: 'string' }, url: { type: 'string' } }, required: ['created', 'target_id'] },
      handler: async ({ url = 'about:blank', focus = true }, ctx) => {
        const { session } = ctx;
        const { targetId } = await session.client.send('Target.createTarget', { url });
        const { sessionId } = await session.client.send('Target.attachToTarget', { targetId, flatten: true });
        await session.client.send('Page.enable', {}, sessionId);
        const newSession = new (session.constructor)(session.client, sessionId, targetId);
        if (focus) ctx.session = newSession;
        await newSession.waitForReady(20_000).catch(() => {});
        return { created: true, target_id: targetId, session_id: sessionId, url, focused: focus };
      },
    },
    {
      name: 'close_tab',
      description: 'Close a tab by target id, or the active tab when no id is given.',
      risk: 'medium',
      permissions: ['navigate'],
      timeout_ms: 20_000,
      input_schema: {
        type: 'object',
        properties: { target_id: { type: 'string', description: 'Target id from list_tabs (default: the active tab)' } },
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { closed: { type: 'boolean' }, target_id: { type: 'string' } }, required: ['closed'] },
      handler: async ({ target_id }, { session }) => {
        const targets = await session.client.listTargets();
        if (targets.filter((t) => t.type === 'page').length <= 1 && (!target_id || target_id === session.targetId)) {
          throw new ActionError('close_tab', 'refusing to close the last remaining tab — the engine would have no page left to drive');
        }
        const id = target_id || session.targetId;
        const r = await session.client.send('Target.closeTarget', { targetId: id });
        return { closed: r.success === true, target_id: id };
      },
    },
    {
      name: 'switch_tab',
      description: 'Make an existing tab the active session.',
      risk: 'medium',
      permissions: ['navigate'],
      timeout_ms: 20_000,
      input_schema: {
        type: 'object',
        properties: {
          target_id: { type: 'string', description: 'Target id to switch to' },
          index: { type: 'integer', minimum: 0, description: 'Position in the tab list instead' },
        },
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { switched: { type: 'boolean' }, target_id: { type: 'string' }, url: { type: 'string' } }, required: ['switched'] },
      handler: async ({ target_id, index }, ctx) => {
        const { session } = ctx;
        const targets = (await session.client.listTargets()).filter((t) => t.type === 'page');
        let chosen = target_id;
        if (!chosen && index !== undefined) {
          if (index >= targets.length) throw new ActionError('switch_tab', `index ${index} is out of range (${targets.length} tabs)`);
          chosen = targets[index].id;
        }
        if (!chosen) throw new ActionError('switch_tab', 'provide target_id or index');
        if (!targets.some((t) => t.id === chosen)) throw new ActionError('switch_tab', `no tab with id ${chosen}`);
        const { sessionId } = await session.client.send('Target.attachToTarget', { targetId: chosen, flatten: true });
        await session.client.send('Page.enable', {}, sessionId);
        ctx.session = new (session.constructor)(session.client, sessionId, chosen);
        const info = await ctx.session.pageInfo();
        return { switched: true, target_id: chosen, ...info };
      },
    },
    {
      name: 'iframe_enter',
      description: 'Enter an iframe by index or selector and make it the active session.',
      risk: 'medium',
      permissions: ['navigate'],
      timeout_ms: 30_000,
      input_schema: {
        type: 'object',
        properties: {
          ...TARGET_SCHEMA,
          frame_index: { type: 'integer', minimum: 0, description: 'Iframe position in the page' },
        },
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { entered: { type: 'boolean' }, frame_url: { type: 'string' } }, required: ['entered'] },
      handler: async (input, ctx) => {
        const { session } = ctx;
        const { frameTree } = await session.send('Page.getFrameTree');
        const frames = [];
        const walk = (node, depth) => {
          if (depth > 0) frames.push({ id: node.frame.id, url: node.frame.url, name: node.frame.name });
          for (const c of node.childFrames || []) walk(c, depth + 1);
        };
        walk(frameTree, 0);
        if (!frames.length) throw new ActionError('iframe_enter', 'the page has no child frames');
        const idx = input.frame_index ?? 0;
        if (idx >= frames.length) throw new ActionError('iframe_enter', `frame_index ${idx} is out of range (${frames.length} frames: ${frames.map((f) => f.url).join(', ')})`);
        ctx.frameId = frames[idx].id;
        return { entered: true, frame_url: frames[idx].url, frame_id: frames[idx].id, frame_count: frames.length };
      },
    },
    {
      name: 'iframe_exit',
      description: 'Leave the current iframe and return to the top-level frame.',
      risk: 'low',
      permissions: ['navigate'],
      timeout_ms: 15_000,
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      output_schema: { type: 'object', properties: { exited: { type: 'boolean' }, frame_url: { type: 'string' } }, required: ['exited'] },
      handler: async (_i, ctx) => {
        const { session } = ctx;
        const had = ctx.frameId || null;
        ctx.frameId = null;
        const info = await session.pageInfo();
        return { exited: true, frame_url: info.url, previous_frame_id: had };
      },
    },
    {
      name: 'switch_window',
      description: 'Switch to a window/tab by index in the target list (alias of switch_tab for window-oriented flows).',
      risk: 'medium',
      permissions: ['navigate'],
      timeout_ms: 20_000,
      input_schema: { type: 'object', properties: { index: { type: 'integer', minimum: 0 } }, required: ['index'], additionalProperties: false },
      output_schema: { type: 'object', properties: { switched: { type: 'boolean' }, target_id: { type: 'string' } }, required: ['switched'] },
      handler: async ({ index }, ctx) => {
        const { session } = ctx;
        const targets = (await session.client.listTargets()).filter((t) => t.type === 'page');
        if (index >= targets.length) throw new ActionError('switch_window', `index ${index} is out of range (${targets.length} windows)`);
        const { sessionId } = await session.client.send('Target.attachToTarget', { targetId: targets[index].id, flatten: true });
        await session.client.send('Page.enable', {}, sessionId);
        ctx.session = new (session.constructor)(session.client, sessionId, targets[index].id);
        return { switched: true, target_id: targets[index].id, url: targets[index].url };
      },
    },
  ];
}

export function dialogActions() {
  return [
    {
      name: 'set_dialog_policy',
      description: 'Set how the injected dialog shim answers the NEXT alert/confirm/prompt. Must be called before triggering the dialog, because Obscura dialogs do not block and raise no event.',
      risk: 'medium',
      permissions: ['interact'],
      timeout_ms: 15_000,
      input_schema: {
        type: 'object',
        properties: {
          accept: { type: 'boolean', description: 'true → OK / confirm true / prompt returns prompt_text; false → Cancel / null (default true)' },
          prompt_text: { type: 'string', description: 'Value a prompt should return when accepted' },
        },
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { policy: { type: 'object' }, via: { type: 'string' } }, required: ['policy', 'via'] },
      handler: async ({ accept = true, prompt_text }, { session }) => {
        const r = await session.evalJson(`(() => {
          if (!window.__jexiDialogShim) return null;
          window.__jexiDialogShim.policy.accept = ${accept ? 'true' : 'false'};
          window.__jexiDialogShim.policy.prompt_text = ${prompt_text !== undefined ? JSON.stringify(prompt_text) : 'window.__jexiDialogShim.policy.prompt_text'};
          return { ...window.__jexiDialogShim.policy };
        })()`);
        if (!r) throw new ActionError('set_dialog_policy', 'the dialog shim is not installed on this page — the agent loop installs it on every new document', { code: 'E_DIALOG_SHIM_MISSING' });
        return { policy: r, via: 'injected-shim' };
      },
    },
    {
      name: 'alert_accept',
      description: 'Answer subsequent alerts/confirms with OK. Sets the shim policy; the dialog itself must have been captured by get_dialogs.',
      risk: 'medium',
      permissions: ['interact'],
      timeout_ms: 15_000,
      input_schema: { type: 'object', properties: { prompt_text: { type: 'string' } }, additionalProperties: false },
      output_schema: { type: 'object', properties: { accepted: { type: 'boolean' }, policy: { type: 'object' }, captured: { type: 'array' }, via: { type: 'string' } }, required: ['accepted', 'via'] },
      handler: async ({ prompt_text }, { session }) => {
        const r = await session.evalJson(`(() => {
          if (!window.__jexiDialogShim) return null;
          window.__jexiDialogShim.policy.accept = true;
          if (${prompt_text !== undefined ? 'true' : 'false'}) window.__jexiDialogShim.policy.prompt_text = ${prompt_text !== undefined ? JSON.stringify(prompt_text) : 'null'};
          return { policy: { ...window.__jexiDialogShim.policy }, captured: window.__jexiDialogShim.history.slice(-3) };
        })()`);
        if (!r) throw new ActionError('alert_accept', 'the dialog shim is not installed on this page', { code: 'E_DIALOG_SHIM_MISSING' });
        return { accepted: true, policy: r.policy, captured: r.captured, via: 'injected-shim' };
      },
    },
    {
      name: 'alert_dismiss',
      description: 'Answer subsequent alerts/confirms with Cancel (confirm → false, prompt → null). Sets the shim policy.',
      risk: 'medium',
      permissions: ['interact'],
      timeout_ms: 15_000,
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      output_schema: { type: 'object', properties: { dismissed: { type: 'boolean' }, policy: { type: 'object' }, via: { type: 'string' } }, required: ['dismissed', 'via'] },
      handler: async (_i, { session }) => {
        const r = await session.evalJson(`(() => {
          if (!window.__jexiDialogShim) return null;
          window.__jexiDialogShim.policy.accept = false;
          return { ...window.__jexiDialogShim.policy };
        })()`);
        if (!r) throw new ActionError('alert_dismiss', 'the dialog shim is not installed on this page', { code: 'E_DIALOG_SHIM_MISSING' });
        return { dismissed: true, policy: r, via: 'injected-shim' };
      },
    },
    {
      name: 'prompt_answer',
      description: 'Make subsequent prompts return the given text (implies accept). Sets the shim policy.',
      risk: 'medium',
      permissions: ['interact'],
      timeout_ms: 15_000,
      input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      output_schema: { type: 'object', properties: { policy: { type: 'object' }, via: { type: 'string' } }, required: ['policy', 'via'] },
      handler: async ({ text }, { session }) => {
        const r = await session.evalJson(`(() => {
          if (!window.__jexiDialogShim) return null;
          window.__jexiDialogShim.policy.accept = true;
          window.__jexiDialogShim.policy.prompt_text = ${JSON.stringify(text)};
          return { ...window.__jexiDialogShim.policy };
        })()`);
        if (!r) throw new ActionError('prompt_answer', 'the dialog shim is not installed on this page', { code: 'E_DIALOG_SHIM_MISSING' });
        return { policy: r, via: 'injected-shim' };
      },
    },
    {
      name: 'get_dialogs',
      description: 'Read the captured dialog history and the current policy for this page.',
      risk: 'low',
      permissions: ['read'],
      timeout_ms: 15_000,
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      output_schema: { type: 'object', properties: { count: { type: 'integer' }, dialogs: { type: 'array' }, shim_installed: { type: 'boolean' } }, required: ['count', 'dialogs', 'shim_installed'] },
      handler: async (_i, { session }) => {
        const r = await session.evalJson(`(() => {
          if (!window.__jexiDialogShim) return { installed: false, history: [], policy: null };
          return { installed: true, history: window.__jexiDialogShim.history, policy: { ...window.__jexiDialogShim.policy } };
        })()`);
        return { count: r.history.length, dialogs: r.history, policy: r.policy, shim_installed: r.installed };
      },
    },
  ];
}

export { HTTP_BASE };
export default { tabActions, dialogActions };
