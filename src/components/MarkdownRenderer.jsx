import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { chartSvg } from '../utils/chartSvg'; // B169 — real charts for numbers
import { preprocessMath } from '../utils/mathPreprocess'; // B176 — every math dialect renders
import rehypeKatex from 'rehype-katex';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';
import swift from 'highlight.js/lib/languages/swift';
import kotlin from 'highlight.js/lib/languages/kotlin';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import { Check, Copy, AlertCircle, Info, AlertTriangle, CheckCircle, Lightbulb, X, FileText } from 'lucide-react';

// Register languages for syntax highlighting
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', shell);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('java', java);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('cs', csharp);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('php', php);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('rb', ruby);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('kt', kotlin);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('docker', dockerfile);

/* ------------------------------------------------------------------ */
/* Structured-answer sections (stage 6 — preserved)                    */
/* ------------------------------------------------------------------ */
const SECTION_META = {
  SOLUTION:       { icon: '💡', cls: 'text-brand' },
  GIVEN:          { icon: '📌', cls: 'text-acc-analysis' },
  FORMULA:        { icon: '🔢', cls: 'text-acc-math' },
  WORKING:        { icon: '🧠', cls: 'text-acc-analysis' },
  'FINAL ANSWER': { icon: '✓', cls: 'text-brand' },
  SUMMARY:        { icon: '📌', cls: 'text-brand' },
  VERDICT:        { icon: '⚖️', cls: 'text-brand' },
  HEALTH:         { icon: '✓', cls: 'text-brand' },
  'ISSUES FOUND': { icon: '⚠️', cls: 'text-acc-automation' },
  'ROOT CAUSE + FILE': { icon: '🧬', cls: 'text-acc-research' },
  OVERVIEW:       { icon: '📋', cls: 'text-acc-research' },
  'KEY FINDINGS': { icon: '🔍', cls: 'text-acc-research' },
  DETAILS:        { icon: '📄', cls: 'text-acc-research' },
  SOURCES:        { icon: '📚', cls: 'text-acc-automation' },
  CONCLUSION:     { icon: '🎯', cls: 'text-brand' },
  APPROACH:       { icon: '🗺️', cls: 'text-acc-research' },
  CODE:           { icon: '</>', cls: 'text-acc-code' },
  EXPLANATION:    { icon: '🧠', cls: 'text-acc-math' },
  TESTING:        { icon: '✅', cls: 'text-brand' },
  'UNDERSTANDING THE TASK': { icon: '🔍', cls: 'text-acc-research' },
  'POSSIBLE IMPROVEMENTS':  { icon: '🚀', cls: 'text-acc-engineering' },
  'NEXT STEP':    { icon: '→', cls: 'text-brand' },
};

/* ------------------------------------------------------------------ */
/* Callouts: GitHub-style > [!TYPE] + visual variants                  */
/* ------------------------------------------------------------------ */
const CALLOUT_META = {
  NOTE:      { icon: Info,          label: 'NOTE',      cls: 'border-acc-research/40 bg-acc-research/[0.07]',  text: 'text-acc-research',   iconCls: 'text-acc-research' },
  INFO:      { icon: Info,          label: 'INFO',      cls: 'border-acc-analysis/40 bg-acc-analysis/[0.07]',  text: 'text-acc-analysis',   iconCls: 'text-acc-analysis' },
  TIP:       { icon: Lightbulb,     label: 'TIP',       cls: 'border-brand/40 bg-brand/[0.07]',                text: 'text-brand',          iconCls: 'text-brand' },
  IMPORTANT: { icon: AlertCircle,   label: 'IMPORTANT', cls: 'border-acc-automation/50 bg-acc-automation/[0.07]', text: 'text-acc-automation', iconCls: 'text-acc-automation' },
  WARNING:   { icon: AlertTriangle, label: 'WARNING',   cls: 'border-acc-automation/50 bg-acc-automation/[0.07]', text: 'text-acc-automation', iconCls: 'text-acc-automation' },
  ERROR:     { icon: X,             label: 'ERROR',     cls: 'border-status-error/50 bg-status-error/[0.08]',   text: 'text-status-error',   iconCls: 'text-status-error' },
  DANGER:    { icon: AlertCircle,   label: 'DANGER',    cls: 'border-status-error/50 bg-status-error/[0.08]',   text: 'text-status-error',   iconCls: 'text-status-error' },
  SUCCESS:   { icon: CheckCircle,   label: 'SUCCESS',   cls: 'border-brand/40 bg-brand/[0.07]',                text: 'text-brand',          iconCls: 'text-brand' },
};

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/** Flatten React children into plain text (used to sniff section/callout names). */
function flattenText(children) {
  let out = '';
  React.Children.forEach(children, (child) => {
    if (child == null) return;
    if (typeof child === 'string' || typeof child === 'number') out += String(child);
    else if (React.isValidElement(child)) out += flattenText(child.props.children);
  });
  return out;
}

/** Remove a leading "[!TYPE] " marker from rendered children (keeps the content). */
function stripCalloutMarker(children) {
  let done = false;
  const walk = (kids) =>
    React.Children.map(kids, (child) => {
      if (done || child == null) return child;
      if (typeof child === 'string' || typeof child === 'number') {
        const s = String(child);
        const m = s.match(/^\[!([A-Z]+)\]([\s\S]*)$/i);
        if (m) {
          done = true;
          const rest = m[2].replace(/^\s+/, '');
          return rest === '' ? null : rest;
        }
        return child;
      }
      if (React.isValidElement(child)) {
        return React.cloneElement(child, child.props, walk(child.props.children));
      }
      return child;
    });
  return walk(children);
}

/** Copy text to clipboard — returns a Promise<boolean>. */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch { return false; }
  }
}

/* ------------------------------------------------------------------ */
/* Section Header                                                       */
/* ------------------------------------------------------------------ */
function SectionHeader({ children }) {
  const name = flattenText(children).trim().toUpperCase();
  const meta = SECTION_META[name];
  if (!meta) return null;
  return (
    <div className={`flex items-center gap-1.5 mt-4 mb-2 ${meta.cls}`}>
      <span className="inline-grid w-5 h-5 place-items-center rounded-md bg-white/[0.08] text-[11px] leading-none">
        {meta.icon}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em]">
        {name}
      </span>
      <span className="h-px flex-1 bg-current opacity-20" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Syntax-highlighted code block (runs hljs after mount/update)        */
/* ------------------------------------------------------------------ */
function HighlightedCode({ code, language }) {
  const codeRef = useRef(null);

  useEffect(() => {
    if (!codeRef.current || !language) return;
    try {
      const result = hljs.highlight(code, { language, ignoreIllegals: true });
      codeRef.current.innerHTML = result.value;
    } catch {
      // If the language is unsupported or highlight fails, leave plain text
    }
  }, [code, language]);

  // For unknown languages, try auto-detection
  useEffect(() => {
    if (!codeRef.current || language) return;
    try {
      const result = hljs.highlightAuto(code);
      codeRef.current.innerHTML = result.value;
    } catch { /* ignore */ }
  }, [code, language]);

  return (
    <code ref={codeRef} className={`hljs${language ? ` language-${language}` : ''}`}>
      {code}
    </code>
  );
}

/* ------------------------------------------------------------------ */
/* Copy Button for Code Blocks                                          */
/* ------------------------------------------------------------------ */
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-semibold uppercase tracking-wider transition-all duration-200 z-10"
      style={{
        background: copied ? 'rgba(0,210,106,0.18)' : 'rgba(255,255,255,0.06)',
        color: copied ? 'var(--brand)' : 'var(--text-secondary)',
        border: `1px solid ${copied ? 'rgba(0,210,106,0.3)' : 'rgba(255,255,255,0.08)'}`,
      }}
      title="Copy code"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Mermaid diagrams (lazy-loaded)                                      */
/* ------------------------------------------------------------------ */
let diagramSeq = 0;

/* B169 — REAL CHARTS: a ```chart fence becomes a visible graph */
function ChartBlock({ spec }) {
  const { svg, error } = useMemo(() => chartSvg(spec), [spec]);
  if (error) {
    return (
      <div className="markdown-code-container my-3">
        <div className="px-3 py-2 text-[10px] text-status-error">{error}</div>
      </div>
    );
  }
  return (
    <div
      className="my-3 rounded-xl border border-hairline bg-[#0d1017] p-2 overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function MermaidBlock({ code }) {
  const ref = useRef(null);
  const [svg, setSvg] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer;
    if (!/\n\s*$/.test(code) && code.trim() !== '') {
      setSvg(null);
      return undefined;
    }
    timer = setTimeout(async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'strict',
          themeVariables: {
            background: '#0C1117',
            primaryColor: '#0C1117',
            primaryTextColor: '#E8EDF2',
            primaryBorderColor: '#2A3542',
            lineColor: '#4A9EFF',
            secondaryColor: '#111820',
            tertiaryColor: '#111820',
            fontFamily: 'Inter, sans-serif',
            fontSize: '13px',
          },
        });
        const id = `mmd-${++diagramSeq}-${Date.now().toString(36)}`;
        const result = await mermaid.render(id, code);
        if (!cancelled) { setSvg(result.svg); setError(null); }
      } catch (e) {
        if (!cancelled) setError((e && e.message) || String(e));
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [code]);

  if (error) {
    return (
      <div className="my-3">
        <pre className="markdown-code-block relative">
          <CopyButton text={code} />
          <code className="font-mono text-[11px] text-gray-300 block overflow-x-auto">{code}</code>
        </pre>
        <p className="text-[10px] text-status-error mt-1">⚠ diagram could not render — showing source</p>
      </div>
    );
  }
  if (svg) {
    return (
      <div className="my-3 rounded-lg border border-hairline bg-surface-1 p-3 overflow-x-auto" ref={ref} dangerouslySetInnerHTML={{ __html: svg }} />
    );
  }
  return (
    <pre className="markdown-code-block relative">
      <CopyButton text={code} />
      <code className="font-mono text-[11px] text-gray-300 block overflow-x-auto">{code}</code>
    </pre>
  );
}

/* ------------------------------------------------------------------ */
/* Image Component                                                      */
/* ------------------------------------------------------------------ */
function MarkdownImage({ src, alt }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  if (error) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-text-tertiary italic my-1">
        <FileText className="w-3.5 h-3.5" />
        {alt || 'Image'} (failed to load)
      </span>
    );
  }

  return (
    <figure className="my-3">
      {!loaded && (
        <div className="w-full h-32 rounded-lg bg-surface-2 border border-hairline flex items-center justify-center">
          <div className="shimmer-bar w-1/2" />
        </div>
      )}
      <img
        src={src}
        alt={alt || ''}
        className={`max-w-full rounded-lg border border-hairline ${loaded ? '' : 'hidden'}`}
        style={{ maxHeight: '400px', objectFit: 'contain' }}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
      />
      {alt && loaded && (
        <figcaption className="text-[10px] text-text-tertiary text-center mt-1.5 italic">
          {alt}
        </figcaption>
      )}
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Horizontal Divider                                                   */
/* ------------------------------------------------------------------ */
function HorizontalDivider() {
  return <hr className="border-none h-px my-4 bg-gradient-to-r from-transparent via-white/14 to-transparent" />;
}

/* ------------------------------------------------------------------ */
/* Main Renderer                                                        */
/* ------------------------------------------------------------------ */
export default function MarkdownRenderer({ content, size = 'text-[11px]' }) {
  /* --- Pre-processing ------------------------------------------------ */
  // B176 — THE math root fix: every dialect ($, \( \), \[ \], bare LaTeX)
  // normalizes to $-dialect HERE, before the parser — covers streaming,
  // finished answers AND old history. Code blocks/inline code are protected
  // inside preprocessMath and restored untouched.
  let cleanContent = useMemo(() => preprocessMath(content || ''), [content]);

  // Clean up empty math blocks left after normalization
  cleanContent = cleanContent.replace(/\$\$\s*\$\$/g, '').replace(/\$\s+\$/g, '');

  return (
    <div className={`markdown-body ${size} leading-relaxed`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore', errorColor: '#ffb020' }]]}
        components={{
          /* --- Headings -------------------------------------------- */
          h1: ({ node, children, ...props }) => {
            if (SECTION_META[flattenText(children).trim().toUpperCase()]) {
              return <SectionHeader>{children}</SectionHeader>;
            }
            return <h1 className="markdown-h1" {...props}>{children}</h1>;
          },
          h2: ({ node, children, ...props }) => {
            if (SECTION_META[flattenText(children).trim().toUpperCase()]) {
              return <SectionHeader>{children}</SectionHeader>;
            }
            return <h2 className="markdown-h2" {...props}>{children}</h2>;
          },
          h3: ({ node, children, ...props }) => {
            if (SECTION_META[flattenText(children).trim().toUpperCase()]) {
              return <SectionHeader>{children}</SectionHeader>;
            }
            return <h3 className="markdown-h3" {...props}>{children}</h3>;
          },
          h4: ({ node, ...props }) => <h4 className="markdown-h4" {...props} />,
          h5: ({ node, ...props }) => <h5 className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mt-2 mb-1" {...props} />,
          h6: ({ node, ...props }) => <h6 className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider mt-2 mb-1" {...props} />,

          /* --- Paragraphs ------------------------------------------ */
          p: ({ node, children, ...props }) => <p className="markdown-p" {...props}>{children}</p>,

          /* --- Lists ----------------------------------------------- */
          ul: ({ node, ordered, ...props }) => {
            // Detect task list (contains [x] or [ ] patterns)
            const isTaskList = React.Children.toArray(props.children).some(child => {
              if (!React.isValidElement(child)) return false;
              const text = flattenText(child.props.children || child.props.children);
              return /^\[[ x]\]/.test(text.trim());
            });
            if (isTaskList) {
              return <ul className="markdown-task-list my-2" {...props} />;
            }
            return <ul className="markdown-ul" {...props} />;
          },
          ol: ({ node, ...props }) => <ol className="markdown-ol" {...props} />,
          li: ({ node, children, ...props }) => {
            const text = flattenText(children).trim();
            const taskMatch = text.match(/^\[([ x])\]\s*(.*)/i);
            if (taskMatch) {
              const checked = taskMatch[1].toLowerCase() === 'x';
              const content = taskMatch[2];
              return (
                <li className="markdown-task-item">
                  <span className={`markdown-checkbox ${checked ? 'markdown-checkbox-checked' : ''}`}>
                    {checked && <Check className="w-2.5 h-2.5" />}
                  </span>
                  <span className={checked ? 'line-through opacity-60' : ''}>{content}</span>
                </li>
              );
            }
            return <li className="markdown-li" {...props}>{children}</li>;
          },

          /* --- Bold / Italic --------------------------------------- */
          strong: ({ node, ...props }) => <strong className="font-bold text-white" {...props} />,
          em: ({ node, ...props }) => <em className="italic text-gray-400" {...props} />,

          /* --- Inline Code ----------------------------------------- */
          code: ({ node, inline, className, children, ...props }) => {
            const langMatch = /language-([\w-]+)/.exec(className || '');
            const lang = langMatch ? langMatch[1] : '';

            // Mermaid (diagrams/flowcharts)
            if (lang === 'mermaid') {
              return <MermaidBlock code={String(children).replace(/\n$/, '')} />;
            }

            // Charts (B169 — numbers become real graphs: bar/line/pie)
            if (lang === 'chart') {
              return <ChartBlock spec={String(children).replace(/\n$/, '')} />;
            }

            // Fenced code block (has language class)
            if (lang || (!inline && className)) {
              const codeText = String(children).replace(/\n$/, '');
              return (
                <div className="markdown-code-container my-3">
                  <div className="markdown-code-header">
                    <span className="text-[9px] font-semibold uppercase tracking-wider text-text-tertiary">
                      {lang || 'code'}
                    </span>
                    <CopyButton text={codeText} />
                  </div>
                  <pre className="markdown-code-block relative group">
                    <HighlightedCode code={codeText} language={['js','jsx','javascript','ts','tsx','typescript','python','py','json','bash','sh','html','css','java','go','rust','sql','yaml','xml','md'].includes(lang) ? lang : undefined} />
                  </pre>
                </div>
              );
            }

            // Inline code
            return (
              <code className="markdown-inline-code" {...props}>
                {children}
              </code>
            );
          },

          /* --- Tables ---------------------------------------------- */
          table: ({ node, ...props }) => (
            <div className="overflow-x-auto my-3 rounded-lg border border-hairline">
              <table className="w-full border-collapse text-[11px]" {...props} />
            </div>
          ),
          thead: ({ node, ...props }) => <thead className="bg-surface-2" {...props} />,
          th: ({ node, ...props }) => <th className="markdown-th" {...props} />,
          td: ({ node, ...props }) => <td className="markdown-td" {...props} />,

          /* --- Blockquotes ----------------------------------------- */
          blockquote: ({ node, children, ...props }) => {
            const text = flattenText(children).trim();
            const m = text.match(/^\[!(NOTE|TIP|INFO|IMPORTANT|WARNING|ERROR|DANGER|SUCCESS)\]/i);
            if (m) {
              const kind = m[1].toUpperCase();
              const meta = CALLOUT_META[kind];
              if (meta) {
                const IconComponent = meta.icon;
                return (
                  <div className={`markdown-callout ${meta.cls} my-3`}>
                    <div className={`flex items-center gap-1.5 mb-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] ${meta.text}`}>
                      <IconComponent className={`w-3.5 h-3.5 ${meta.iconCls}`} />
                      {meta.label}
                    </div>
                    <div className="markdown-callout-content text-gray-300">
                      {stripCalloutMarker(children)}
                    </div>
                  </div>
                );
              }
            }
            return (
              <blockquote className="markdown-blockquote" {...props}>
                {children}
              </blockquote>
            );
          },

          /* --- Links ----------------------------------------------- */
          a: ({ node, href, children, ...props }) => {
            const text = flattenText(children).trim();
            // Numeric citation links → superscript badge
            if (/^\[?\d{1,3}\]?$/.test(text)) {
              return (
                <sup className="mx-0.5">
                  <a href={href} className="inline-grid min-w-[14px] h-[14px] px-0.5 place-items-center rounded bg-acc-research/15 text-acc-research text-[9px] font-semibold no-underline hover:bg-acc-research/30 transition-colors" target="_blank" rel="noreferrer" title={href}>
                    {`[${text.replace(/[\[\]]/g, '')}]`}
                  </a>
                </sup>
              );
            }
            return (
              <a className="markdown-link" target="_blank" rel="noreferrer" href={href} {...props}>
                {children}
              </a>
            );
          },

          /* --- Images ---------------------------------------------- */
          img: ({ node, src, alt, ...props }) => (
            <MarkdownImage src={src} alt={alt} />
          ),

          /* --- Horizontal Dividers --------------------------------- */
          hr: ({ node, ...props }) => <HorizontalDivider />,

          /* --- Details / Summary (collapsible) --------------------- */
          details: ({ node, children, ...props }) => (
            <details className="my-2 rounded-lg border border-hairline bg-surface-1 overflow-hidden" {...props}>
              {children}
            </details>
          ),
          summary: ({ node, children, ...props }) => (
            <summary className="px-3 py-2 text-[11px] font-semibold text-text-secondary cursor-pointer hover:bg-surface-2 transition-colors select-none" {...props}>
              {children}
            </summary>
          ),
        }}
      >
        {cleanContent}
      </ReactMarkdown>
    </div>
  );
}
