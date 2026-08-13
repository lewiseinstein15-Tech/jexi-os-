import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

/* ------------------------------------------------------------------ */
/* Structured-answer sections (stage 6).                              */
/* JEXI's prompt tells models to write answers with ALL-CAPS section   */
/* headings — # SOLUTION, ## GIVEN / FORMULA / WORKING / FINAL ANSWER, */
/* ## OVERVIEW / KEY FINDINGS / DETAILS / SOURCES / CONCLUSION, …     */
/* Each known section gets an icon chip + accent color so a mission    */
/* reads like an instrument panel instead of a wall of headings.       */
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

/* GitHub-style callouts:  > [!NOTE]  > [!TIP]  > [!WARNING]  … */
const CALLOUT_META = {
  NOTE:      { icon: 'ℹ️', label: 'NOTE',      cls: 'border-acc-research/40 bg-acc-research/[0.07]', text: 'text-acc-research' },
  INFO:      { icon: 'ℹ️', label: 'INFO',      cls: 'border-acc-analysis/40 bg-acc-analysis/[0.07]',  text: 'text-acc-analysis' },
  TIP:       { icon: '💡', label: 'TIP',       cls: 'border-brand/40 bg-brand/[0.07]',                text: 'text-brand' },
  IMPORTANT: { icon: '❗', label: 'IMPORTANT', cls: 'border-acc-automation/50 bg-acc-automation/[0.07]', text: 'text-acc-automation' },
  WARNING:   { icon: '⚠️', label: 'WARNING',   cls: 'border-acc-automation/50 bg-acc-automation/[0.07]', text: 'text-acc-automation' },
  DANGER:    { icon: '🛑', label: 'DANGER',    cls: 'border-status-error/50 bg-status-error/[0.08]',   text: 'text-status-error' },
};

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

/** A section heading that matches a known structured-answer block gets a chip. */
function SectionHeader({ children }) {
  const name = flattenText(children).trim().toUpperCase();
  const meta = SECTION_META[name];
  if (!meta) return null; // fall through to the default heading styling
  return (
    <div className={`flex items-center gap-1.5 mt-3 mb-1.5 ${meta.cls}`}>
      <span className="inline-grid w-4 h-4 place-items-center rounded bg-white/[0.08] text-[10px] leading-none">
        {meta.icon}
      </span>
      <span className="text-[9px] font-semibold uppercase tracking-[0.08em]">
        {name}
      </span>
      <span className="h-px flex-1 bg-current opacity-20" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mermaid diagrams — renders ```mermaid blocks live.                  */
/* Lazy-imports mermaid so it only loads when a diagram actually       */
/* appears, and defers rendering until the code looks complete (the    */
/* typewriter streams the block in a few chunks at a time).            */
/* ------------------------------------------------------------------ */
let diagramSeq = 0;

function MermaidBlock({ code }) {
  const ref = useRef(null);
  const [svg, setSvg] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer;
    // Still streaming? Show the raw block until the fence closes (ends with \n).
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
        if (!cancelled) {
          setSvg(result.svg);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e && e.message) || String(e));
      }
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [code]);

  if (error) {
    return (
      <div className="my-2">
        <pre className="bg-[#050505] border border-status-error/30 p-3 rounded-lg overflow-x-auto mb-1">
          <code className="font-mono text-[11px] text-gray-300">{code}</code>
        </pre>
        <p className="text-[10px] text-status-error">⚠ diagram could not render — showing source</p>
      </div>
    );
  }
  if (svg) {
    return <div className="my-2 rounded-lg border border-hairline bg-surface-1 p-2 overflow-x-auto" ref={ref} dangerouslySetInnerHTML={{ __html: svg }} />;
  }
  // Not ready yet (streaming or first load) — raw code.
  return (
    <pre className="bg-[#050505] border border-hairline p-3 rounded-lg overflow-x-auto my-2">
      <code className="font-mono text-[11px] text-gray-300">{code}</code>
    </pre>
  );
}

/* ------------------------------------------------------------------ */
/* Main renderer                                                       */
/* ------------------------------------------------------------------ */
export default function MarkdownRenderer({ content }) {
  // 1. Clean up empty math blocks
  let cleanContent = content.replace(/\$\$\s*\$\$/g, '').replace(/\$\s*\$/g, '');

  // 2. SAFETY NET: Auto-wrap lone LaTeX commands in $$ if the AI forgot them
  // Lines inside fenced code blocks are NEVER wrapped — code is full of
  // backslash-leading lines (\n, \t, \print, \d+) and wrapping them in math
  // produced invalid LaTeX that crashed the whole render (the "black screen
  // on code questions" bug). Track fence state while mapping lines.
  let inFence = false;
  cleanContent = cleanContent.split('\n').map(line => {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      return line;
    }
    if (!inFence && trimmed.startsWith('\\') && !trimmed.includes('$$') && !trimmed.startsWith('```')) {
      return `$$ ${trimmed} $$`;
    }
    return line;
  }).join('\n');

  return (
    <div className="markdown-body text-[11px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
        components={{
          h1: ({ node, children, ...props }) => {
            if (SECTION_META[flattenText(children).trim().toUpperCase()]) {
              return <SectionHeader>{children}</SectionHeader>;
            }
            return <h1 className="text-[13px] font-bold text-[#00D26A] mt-3 mb-2 tracking-wide" {...props}>{children}</h1>;
          },
          h2: ({ node, children, ...props }) => {
            if (SECTION_META[flattenText(children).trim().toUpperCase()]) {
              return <SectionHeader>{children}</SectionHeader>;
            }
            return <h2 className="text-[12px] font-bold text-[#4A9EFF] mt-3 mb-1.5" {...props}>{children}</h2>;
          },
          h3: ({ node, ...props }) => <h3 className="text-[11px] font-bold text-[#B36CFF] mt-2 mb-1" {...props} />,
          p: ({ node, ...props }) => <p className="text-gray-300 mb-2 whitespace-pre-wrap" {...props} />,
          ul: ({ node, ...props }) => <ul className="list-disc list-inside mb-2 space-y-1 text-gray-300" {...props} />,
          ol: ({ node, ...props }) => <ol className="list-decimal list-inside mb-2 space-y-1 text-gray-300 marker:text-acc-research" {...props} />,
          li: ({ node, ...props }) => <li className="ml-2" {...props} />,
          strong: ({ node, ...props }) => <strong className="font-bold text-white" {...props} />,
          code: ({ node, inline, className, children, ...props }) => {
            const lang = /language-([\w-]+)/.exec(className || '');
            if (lang && lang[1] === 'mermaid') {
              return <MermaidBlock code={String(children).replace(/\n$/, '')} />;
            }
            return inline ?
              <code className="bg-[#0d141b] text-[#00D26A] px-1.5 py-0.5 rounded text-[11px] font-mono border border-[#00D26A]/20" {...props}>{children}</code> :
              <pre className="bg-[#050505] border border-[#1a1a1a] p-3 rounded-lg overflow-x-auto mb-2"><code className="font-mono text-[11px] text-gray-300" {...props}>{children}</code></pre>;
          },
          table: ({ node, ...props }) => (
            <div className="overflow-x-auto mb-2">
              <table className="w-full border-collapse text-[11px]" {...props} />
            </div>
          ),
          th: ({ node, ...props }) => <th className="border border-[#1D2A35] bg-[#0a0e13] p-2 text-left text-[#4A9EFF] font-bold" {...props} />,
          td: ({ node, ...props }) => <td className="border border-[#222] p-2 text-gray-300" {...props} />,
          blockquote: ({ node, children, ...props }) => {
            const text = flattenText(children).trim();
            const m = text.match(/^\[!(NOTE|TIP|INFO|IMPORTANT|WARNING|DANGER)\]/i);
            if (m) {
              const kind = m[1].toUpperCase();
              const meta = CALLOUT_META[kind];
              return (
                <div className={`border-l-2 rounded-r-md px-3 py-2 my-2 ${meta.cls}`}>
                  <div className={`flex items-center gap-1.5 mb-1 text-[9px] font-semibold uppercase tracking-[0.08em] ${meta.text}`}>
                    <span className="text-[10px] leading-none">{meta.icon}</span>
                    {meta.label}
                  </div>
                  <div className="text-gray-300 [&>p]:mb-0">{stripCalloutMarker(children)}</div>
                </div>
              );
            }
            return <blockquote className="border-l-2 border-[#00D26A] pl-3 italic text-gray-400 my-2" {...props}>{children}</blockquote>;
          },
          a: ({ node, href, children, ...props }) => {
            const text = flattenText(children).trim();
            // Numeric citation links — render as a superscript badge: [1](url)
            if (/^\[?\d{1,3}\]?$/.test(text)) {
              return (
                <sup className="mx-0.5">
                  <a href={href} className="inline-grid min-w-[14px] h-[14px] px-0.5 place-items-center rounded bg-acc-research/15 text-acc-research text-[9px] font-semibold no-underline hover:bg-acc-research/30" target="_blank" rel="noreferrer" title={href}>
                    {`[${text.replace(/[\[\]]/g, '')}]`}
                  </a>
                </sup>
              );
            }
            return <a className="text-[#4A9EFF] underline hover:text-[#00D26A]" target="_blank" rel="noreferrer" href={href} {...props}>{children}</a>;
          },
        }}
      >
        {cleanContent}
      </ReactMarkdown>
    </div>
  );
}
