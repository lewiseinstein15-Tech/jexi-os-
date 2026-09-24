import React, { useState, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';

/* ════════════════════════════════════════════════════════════════
   JEXI RICH ANSWER RENDERER (B151)
   ChatGPT-style rich-content layout — monochrome (black & white),
   mobile-first, no cards. Detects and renders:
   text · headings · bold/italic/emphasis · emojis · bullet/numbered
   lists · nested lists · checklists · fenced+inline code (language
   badge, copy button, horizontal scroll, syntax highlighting) ·
   LaTeX math (inline + display via KaTeX) · tables (scrollable) ·
   blockquotes · links · callouts (NOTE/TIP/IMPORTANT/WARNING/ERROR/
   SUCCESS/INFO) · dividers · images · diagrams (preserved) ·
   long-answer progressive structure · tool outputs.
   ════════════════════════════════════════════════════════════════ */

/* ── tiny remark plugin: `> [!TYPE]` → callout node ── */
const CALLOUT_TYPES = ['note', 'tip', 'important', 'warning', 'error', 'success', 'info'];

function walk(tree, fn) {
  if (!tree || typeof tree !== 'object') return;
  fn(tree);
  if (Array.isArray(tree.children)) tree.children.forEach((c) => walk(c, fn));
}

function remarkCallouts() {
  return (tree) => {
    walk(tree, (node) => {
      if (node.type !== 'blockquote') return;
      const first = node.children && node.children.find((c) => c.type === 'paragraph');
      if (!first) return;
      const joined = (first.children || []).map((c) => (c.type === 'text' ? c.value : '')).join('');
      const m = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|ERROR|SUCCESS|INFO)\]\s*/i.exec(joined);
      if (!m) return;
      const type = m[1].toLowerCase();
      const textNode = first.children && first.children.find((c) => c.type === 'text');
      if (textNode) textNode.value = String(textNode.value || '').replace(/^\[![^\]]+\]\s*/i, '');
      node.data = { ...(node.data || {}), hName: 'callout', hProperties: { type } };
    });
  };
}

/* ── helpers ── */
const ICON_BY_CALLOUT = {
  note: '📝', tip: '💡', important: '⭐', warning: '⚠️', error: '⛔', success: '✅', info: 'ℹ️',
};
const LABEL_BY_CALLOUT = {
  note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', error: 'Error', success: 'Success', info: 'Info',
};

function childrenToText(children) {
  let out = '';
  const dig = (node) => {
    if (typeof node === 'string' || typeof node === 'number') { out += String(node); return; }
    if (Array.isArray(node)) { node.forEach(dig); return; }
    if (node && node.props) dig(node.props.children);
  };
  dig(children);
  return out;
}

/* ── code block (fenced): language badge + copy + scroll + highlight ── */
function CodeBlock({ children, className }) {
  const [copied, setCopied] = useState(false);
  const lang = (className || '').match(/language-([\w+#.-]+)/)?.[1] || '';
  const raw = childrenToText(children);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(raw);
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = raw;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (e2) { /* clipboard unavailable */ }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }, [raw]);

  return (
    <div className="jx-code">
      <div className="jx-code-h">
        <span className="jx-code-lang">{lang || 'code'}</span>
        <button type="button" className="jx-code-copy" onClick={copy}>
          {copied ? '✓ copied' : 'Copy'}
        </button>
      </div>
      <pre className="jx-code-pre">
        <code className={className || ''}>{children}</code>
      </pre>
    </div>
  );
}

/* ── callout ── */
function Callout({ type, children }) {
  const t = CALLOUT_TYPES.includes(type) ? type : 'note';
  return (
    <div className={`jx-callout jx-callout-${t}`}>
      <div className="jx-callout-h">
        <span className="jx-callout-ic">{ICON_BY_CALLOUT[t]}</span>
        <span className="jx-callout-label">{LABEL_BY_CALLOUT[t]}</span>
      </div>
      <div className="jx-callout-body">{children}</div>
    </div>
  );
}

/* ── table (scrollable) ── */
function Table({ children }) {
  return (
    <div className="jx-table-wrap">
      <table className="jx-table">{children}</table>
    </div>
  );
}

/* ── checkbox task item ── */
function TaskLi({ checked, children }) {
  return (
    <li className={`jx-task${checked ? ' done' : ''}`}>
      <span className={`jx-box${checked ? ' checked' : ''}`} aria-hidden="true">
        {checked ? '✓' : ''}
      </span>
      <span className="jx-task-text">{children}</span>
    </li>
  );
}

/* ── main component ── */
export default function RichAnswer({ text, size = 'default' }) {
  // B197 — STABLE component identities: react-markdown uses these functions
  // as React element types. A fresh object per render made React REMOUNT
  // every custom-rendered node on each re-render — images visibly reloaded.
  // All renderers below are pure functions of their props, so one frozen
  // object (empty deps) is exactly equivalent — minus the remount storm.
  const components = useMemo(() => ({
    h1: ({ children }) => <h1 className="jx-h1">{children}</h1>,
    h2: ({ children }) => <h2 className="jx-h2">{children}</h2>,
    h3: ({ children }) => <h3 className="jx-h3">{children}</h3>,
    h4: ({ children }) => <h4 className="jx-h4">{children}</h4>,
    h5: ({ children }) => <h5 className="jx-h5">{children}</h5>,
    h6: ({ children }) => <h6 className="jx-h6">{children}</h6>,
    p: ({ children }) => <p className="jx-p">{children}</p>,
    strong: ({ children }) => <strong>{children}</strong>,
    em: ({ children }) => <em>{children}</em>,
    del: ({ children }) => <del>{children}</del>,
    ul: ({ children }) => <ul className="jx-ul">{children}</ul>,
    ol: ({ children }) => <ol className="jx-ol">{children}</ol>,
    li: ({ children, className }) => {
      // GFM task lists: react-markdown renders <li class="task-list-item">
      // with an <input type="checkbox"> child — turn it into our own box.
      if (className && String(className).includes('task-list-item')) {
        const kids = React.Children.toArray(children);
        const boxIdx = kids.findIndex((k) => React.isValidElement(k) && k.props && k.props.type === 'checkbox');
        const checked = boxIdx >= 0 ? !!kids[boxIdx].props.checked : false;
        const rest = boxIdx >= 0 ? kids.filter((_, i) => i !== boxIdx) : kids;
        return <TaskLi checked={checked}>{rest}</TaskLi>;
      }
      return <li className={className || undefined}>{children}</li>;
    },
    code: ({ children, className }) => {
      const isBlock = (className || '').includes('language-') || /[\n\r]/.test(childrenToText(children));
      if (isBlock) return <CodeBlock className={className}>{children}</CodeBlock>;
      return <code className="jx-icode">{children}</code>;
    },
    pre: ({ children }) => <>{children}</>, // the code component already wraps blocks
    table: ({ children }) => <Table>{children}</Table>,
    blockquote: ({ children }) => <blockquote className="jx-quote">{children}</blockquote>,
    callout: ({ type, children }) => <Callout type={type}>{children}</Callout>,
    a: ({ children, href }) => (
      <a className="jx-link" href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    ),
    img: ({ src, alt }) => <img className="jx-img-inline" src={src} alt={alt || ''} loading="lazy" />,
    hr: () => <hr className="jx-hr" />,
  }), []);

  return (
    <div className={`jx-rich${size === 'large' ? ' jx-rich-lg' : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkCallouts]}
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: false, subset: ['javascript', 'typescript', 'jsx', 'tsx', 'python', 'json', 'bash', 'shell', 'sql', 'css', 'html', 'xml', 'markdown', 'yaml', 'java', 'c', 'cpp', 'go', 'rust', 'ruby', 'php'] }]]}
        components={components}
      >
        {String(text || '')}
      </ReactMarkdown>
    </div>
  );
}
