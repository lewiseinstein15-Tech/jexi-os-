/**
 * components/transcript/FinalAnswer.jsx (ui/decision-layer-rendering, Part 3)
 *
 * The answer block, now with FULL rich rendering (replaces the minimal
 * mini-markdown renderer from ui-rebuild-premium-v2 — that one only knew
 * fenced code + paragraph breaks):
 *
 *   - react-markdown: headers, lists, tables, blockquotes, links, bold,
 *     italic, hr (GFM tables via remark-gfm)
 *   - KaTeX: $inline$ and $$block$$ math (remark-math + rehype-katex)
 *   - highlight.js: fenced code blocks get real highlighting + a per-block
 *     copy button (rehype-highlight)
 *   - mermaid: ```mermaid blocks render as SVG (lazy-loaded, fail-soft to
 *     a plain code block on parse errors). NOTE the correct API call —
 *     mermaid.initialize({ startOnLoad: false }) — a missing-parens
 *     syntax error here once crashed the whole UI (Arena branch, Bug 1).
 *   - Unicode symbols (Δ, →, ∀, ∃, ∫) pass through natively — nothing
 *     reinterprets them.
 *   - one copy button for the whole answer, top-right of the card.
 *
 * The raw text is exactly what the backend streamed — markdown is only
 * ever RENDERED, never rewritten.
 */

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark.css';

/** Clipboard helper with a textarea fallback (insecure contexts, old webviews). */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }
}

function CopyButton({ getText, label = 'Copy', className = 'jx-copy-btn' }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    const ok = await copyText(typeof getText === 'function' ? getText() : String(getText || ''));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };
  return (
    <button type="button" className={className + (copied ? ' is-copied' : '')} onClick={onCopy} title="Copy to clipboard">
      {copied ? 'Copied ✓' : label}
    </button>
  );
}

/** Flatten React children to plain text (for mermaid source extraction). */
function childrenText(children) {
  if (children === null || children === undefined || typeof children === 'boolean') return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(childrenText).join('');
  if (typeof children === 'object' && children.props) return childrenText(children.props.children);
  return '';
}

/**
 * Mermaid ```mermaid blocks → SVG. Lazy-loads the (large) mermaid bundle on
 * first diagram, renders off the main flow, and degrades HONESTLY to a plain
 * code block when the source does not parse — never a blank hole.
 */
function MermaidDiagram({ code }) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        // THE correct call — parens matter. Mermaid.initialize { ... } (no
        // call) is a syntax error that used to take the whole UI down.
        mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
        const id = `jx-mmd-${Math.random().toString(36).slice(2, 10)}`;
        const out = await mermaid.render(id, String(code || '').trim());
        if (!cancelled) setSvg(out && out.svg ? out.svg : '');
      } catch (e) {
        if (!cancelled) setError(String((e && e.message) || e).slice(0, 160));
      }
    })();
    return () => { cancelled = true; };
  }, [code]);
  if (error) {
    return (
      <div className="jx-mermaid is-error">
        <pre className="jx-answer-code"><code>{code}</code></pre>
        <div className="jx-mermaid-note">mermaid render failed: {error}</div>
      </div>
    );
  }
  if (!svg) return <pre className="jx-answer-code jx-mermaid-pending"><code>{code}</code></pre>;
  return <div className="jx-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** A fenced code block with a copy button (the button copies the REAL text
 * content of the rendered block, post-highlighting). */
function PreWithCopy({ children }) {
  const ref = useRef(null);
  return (
    <div className="jx-code-wrap">
      <CopyButton getText={() => (ref.current ? ref.current.textContent : '')} />
      <pre ref={ref}>{children}</pre>
    </div>
  );
}

/** The react-markdown renderer map — every element the answers actually use. */
const MARKDOWN_COMPONENTS = {
  pre: PreWithCopy,
  code({ className, children, ...props }) {
    const lang = /language-([\w-]+)/.exec(className || '')?.[1];
    if (lang === 'mermaid') return <MermaidDiagram code={childrenText(children)} />;
    return <code className={className} {...props}>{children}</code>;
  },
  a({ href, children, ...props }) {
    return <a href={href} target="_blank" rel="noreferrer noopener" {...props}>{children}</a>;
  },
  table({ children, ...props }) {
    return <div className="jx-table-wrap"><table {...props}>{children}</table></div>;
  },
};

export default function FinalAnswer({ content, streaming }) {
  if (!content) return null;
  return (
    <div className={'jx-answer' + (streaming ? ' is-streaming' : ' is-final')}>
      <div className="jx-answer-copy"><CopyButton getText={content} /></div>
      <div className="jx-answer-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex, rehypeHighlight]}
          components={MARKDOWN_COMPONENTS}
        >
          {String(content)}
        </ReactMarkdown>
      </div>
      {streaming ? <span className="jx-cursor" aria-hidden="true" /> : null}
    </div>
  );
}
