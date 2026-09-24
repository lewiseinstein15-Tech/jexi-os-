/**
 * JEXI OS — Phase 17 Scope B — FORM ACTIONS.
 *
 * select, checkbox, radio, date picker, file upload and form submission.
 *
 * Every field setter goes through the PROTOTYPE SETTER for its element type
 * (`HTMLSelectElement.prototype.value`, `HTMLInputElement.prototype.checked`,
 * …) and then dispatches the events a controlled component listens for. Setting
 * `el.value` directly is invisible to React/Vue state, which is the classic
 * cause of "the form submitted empty" — this is why the setter is used.
 *
 * File upload is gated by the engine: `DOM.setFileInputFiles` returns -32601
 * unless Obscura was started with `--allow-file-access`. The action surfaces
 * that refusal verbatim rather than reporting a success it did not achieve.
 */

import { ActionError } from './registry.js';
import { TARGET_SCHEMA, describeTarget, buildLocatorJs, findNodeIdInPage } from './resolve.js';
import { performClick } from './interaction.js';

function locatorFor(input, dom) {
  return buildLocatorJs(input, dom?.indexToKey?.get(input.index));
}

export function formActions() {
  return [
    {
      name: 'select_option',
      description: 'Choose an option in a <select> by value, label, or index.',
      risk: 'medium',
      permissions: ['interact'],
      timeout_ms: 20_000,
      input_schema: {
        type: 'object',
        properties: {
          ...TARGET_SCHEMA,
          value: { type: 'string', description: 'Option value or label to select' },
          option_index: { type: 'integer', minimum: 0, description: 'Select by position instead' },
        },
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { selected: { type: 'boolean' }, value: { type: 'string' }, text: { type: 'string' } }, required: ['selected'] },
      handler: async (input, { session, dom }) => {
        const { value, option_index } = input;
        if (value === undefined && option_index === undefined) throw new ActionError('select_option', 'provide value or option_index');
        const r = await session.evalJson(`(() => {
          const el = ${locatorFor(input, dom)};
          if (!el) return { ok: false, reason: 'element not found' };
          if (el.tagName !== 'SELECT') return { ok: false, reason: 'element is <' + el.tagName.toLowerCase() + '>, not <select>' };
          let opt = null;
          if (${option_index !== undefined ? option_index : 'null'} !== null) opt = el.options[${option_index ?? 0}];
          else {
            const want = ${JSON.stringify(value ?? '')};
            opt = [...el.options].find((o) => o.value === want) || [...el.options].find((o) => (o.textContent || '').trim() === want);
          }
          if (!opt) return { ok: false, reason: 'no matching option' };
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
          if (setter) setter.call(el, opt.value); else el.value = opt.value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, value: el.value, text: (opt.textContent || '').trim() };
        })()`);
        if (!r?.ok) throw new ActionError('select_option', `${describeTarget(input)} — ${r?.reason}`, { code: 'E_ELEMENT_NOT_FOUND' });
        return { selected: true, value: r.value, text: r.text, target: describeTarget(input) };
      },
    },
    {
      name: 'set_checkbox',
      description: 'Check or uncheck a checkbox.',
      risk: 'medium',
      permissions: ['interact'],
      timeout_ms: 20_000,
      input_schema: {
        type: 'object',
        properties: { ...TARGET_SCHEMA, checked: { type: 'boolean', description: 'Desired state (default true)' } },
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { checked: { type: 'boolean' }, changed: { type: 'boolean' } }, required: ['checked'] },
      handler: async (input, { session, dom }) => {
        const want = input.checked !== false;
        const r = await session.evalJson(`(() => {
          const el = ${locatorFor(input, dom)};
          if (!el) return { ok: false, reason: 'element not found' };
          if (el.type !== 'checkbox') return { ok: false, reason: 'element is type "' + el.type + '", not checkbox' };
          const before = el.checked;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
          if (setter) setter.call(el, ${want}); else el.checked = ${want};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return { ok: true, checked: el.checked, changed: before !== el.checked };
        })()`);
        if (!r?.ok) throw new ActionError('set_checkbox', `${describeTarget(input)} — ${r?.reason}`, { code: 'E_ELEMENT_NOT_FOUND' });
        return { checked: r.checked, changed: r.changed, target: describeTarget(input) };
      },
    },
    {
      name: 'set_radio',
      description: 'Select a radio button.',
      risk: 'medium',
      permissions: ['interact'],
      timeout_ms: 20_000,
      input_schema: { type: 'object', properties: { ...TARGET_SCHEMA }, additionalProperties: false },
      output_schema: { type: 'object', properties: { checked: { type: 'boolean' }, group_value: { type: 'string' } }, required: ['checked'] },
      handler: async (input, { session, dom }) => {
        const r = await session.evalJson(`(() => {
          const el = ${locatorFor(input, dom)};
          if (!el) return { ok: false, reason: 'element not found' };
          if (el.type !== 'radio') return { ok: false, reason: 'element is type "' + el.type + '", not radio' };
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
          if (setter) setter.call(el, true); else el.checked = true;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          const group = el.name ? document.querySelector('input[name="' + el.name + '"]:checked') : el;
          return { ok: true, checked: el.checked, group_value: group ? group.value : null };
        })()`);
        if (!r?.ok) throw new ActionError('set_radio', `${describeTarget(input)} — ${r?.reason}`, { code: 'E_ELEMENT_NOT_FOUND' });
        return { checked: r.checked, group_value: r.group_value, target: describeTarget(input) };
      },
    },
    {
      name: 'set_date',
      description: 'Set a date/time input. Uses the native picker when the input supports one, otherwise the value setter.',
      risk: 'medium',
      permissions: ['interact'],
      timeout_ms: 20_000,
      input_schema: {
        type: 'object',
        properties: {
          ...TARGET_SCHEMA,
          date: { type: 'string', minLength: 1, description: 'Value in the input format, e.g. 2026-09-18 or 2026-09-18T14:30' },
        },
        required: ['date'],
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { set: { type: 'boolean' }, value: { type: 'string' }, input_type: { type: 'string' } }, required: ['set'] },
      handler: async (input, { session, dom }) => {
        const r = await session.evalJson(`(() => {
          const el = ${locatorFor(input, dom)};
          if (!el) return { ok: false, reason: 'element not found' };
          const type = el.type || el.tagName.toLowerCase();
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(el, ${JSON.stringify(input.date)}); else el.value = ${JSON.stringify(input.date)};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, value: String(el.value), input_type: type };
        })()`);
        if (!r?.ok) throw new ActionError('set_date', `${describeTarget(input)} — ${r?.reason}`, { code: 'E_ELEMENT_NOT_FOUND' });
        return { set: true, value: r.value, input_type: r.input_type, target: describeTarget(input) };
      },
    },
    {
      name: 'upload_file',
      description: 'Attach local files to a file input. Requires the engine to run with --allow-file-access.',
      risk: 'medium',
      permissions: ['interact', 'filesystem'],
      timeout_ms: 30_000,
      input_schema: {
        type: 'object',
        properties: {
          ...TARGET_SCHEMA,
          files: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 }, description: 'Absolute paths on the host running the engine' },
        },
        required: ['files'],
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { uploaded: { type: 'boolean' }, file_count: { type: 'integer' } }, required: ['uploaded'] },
      handler: async (input, { session, dom }) => {
        let nodeId;
        try {
          nodeId = await findNodeIdInPage(session, input, dom?.indexToKey);
        } catch (e) {
          throw new ActionError('upload_file', `${describeTarget(input)} — ${e.message}`, { code: 'E_ELEMENT_NOT_FOUND' });
        }
        if (!nodeId) throw new ActionError('upload_file', `${describeTarget(input)} — no matching element`, { code: 'E_ELEMENT_NOT_FOUND' });
        try {
          await session.send('DOM.setFileInputFiles', { files: input.files, nodeId });
        } catch (e) {
          // Surface the engine's own refusal; do not pretend it worked.
          if (/allow-file-access/.test(e.message)) {
            throw new ActionError('upload_file', `the engine refused the upload — restart Obscura with --allow-file-access to enable local file uploads (raw: ${e.message})`, { code: 'E_ENGINE_GATED' });
          }
          throw e;
        }
        const count = await session.evalJson(`(() => { const el = document.activeElement; const inputs = [...document.querySelectorAll('input[type=file]')]; const withFiles = inputs.find((i) => i.files && i.files.length); return { n: withFiles ? withFiles.files.length : 0, names: withFiles ? [...withFiles.files].map((f) => f.name) : [] }; })()`);
        void count;
        const n = await session.evalJson('(() => { const i = [...document.querySelectorAll("input[type=file]")].find((x) => x.files && x.files.length); return i ? i.files.length : 0; })()');
        return { uploaded: n > 0, file_count: n, files: input.files };
      },
    },
    {
      name: 'submit_form',
      description: 'Submit a form — by requesting submit on a button, or by submitting the form directly.',
      risk: 'medium',
      permissions: ['interact'],
      timeout_ms: 30_000,
      input_schema: {
        type: 'object',
        properties: {
          ...TARGET_SCHEMA,
          mode: { type: 'string', enum: ['requestSubmit', 'submit', 'click'], description: 'requestSubmit fires validation and submit handlers (default); submit skips validation' },
        },
        additionalProperties: false,
      },
      output_schema: { type: 'object', properties: { submitted: { type: 'boolean' }, method: { type: 'string' }, url: { type: 'string' } }, required: ['submitted'] },
      handler: async (input, { session, dom }) => {
        const mode = input.mode || 'requestSubmit';
        const hasTarget = input.index !== undefined || input.selector || input.xpath || input.text;

        if (mode === 'click' || !hasTarget) {
          if (!hasTarget) throw new ActionError('submit_form', 'provide a target (form, submit button or selector)');
          const before = await session.eval('location.href');
          await performClick(session, input, dom);
          await session.waitForReady(15_000).catch(() => {});
          const after = await session.eval('location.href');
          return { submitted: true, method: 'click', url: after, navigated: before !== after };
        }

        const r = await session.evalJson(`(() => {
          let el = ${locatorFor(input, dom)};
          if (!el) return { ok: false, reason: 'element not found' };
          const form = el.tagName === 'FORM' ? el : (el.form || el.closest('form'));
          if (!form) return { ok: false, reason: 'element is not inside a <form>' };
          if (${JSON.stringify(mode)} === 'submit') {
            const proto = HTMLFormElement.prototype.submit;
            proto.call(form);
            return { ok: true, via: 'HTMLFormElement.submit()', form_id: form.id || null };
          }
          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit(el.tagName === 'FORM' ? undefined : el);
            return { ok: true, via: 'requestSubmit()', form_id: form.id || null };
          }
          const proto = HTMLFormElement.prototype.submit;
          proto.call(form);
          return { ok: true, via: 'submit() fallback', form_id: form.id || null };
        })()`);
        if (!r?.ok) throw new ActionError('submit_form', `${describeTarget(input)} — ${r?.reason}`, { code: 'E_ELEMENT_NOT_FOUND' });
        await session.waitForReady(15_000).catch(() => {});
        const info = await session.pageInfo();
        return { submitted: true, method: r.via, form_id: r.form_id, ...info };
      },
    },
  ];
}

export default { formActions };
