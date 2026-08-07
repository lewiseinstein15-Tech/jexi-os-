import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

export default function MarkdownRenderer({ content }) {
  // 1. Clean up empty math blocks
  let cleanContent = content.replace(/\$\$\s*\$\$/g, '').replace(/\$\s*\$/g, '');

  // 2. SAFETY NET: Auto-wrap lone LaTeX commands in $$ if the AI forgot them
  // If a line starts with a backslash (like \int or \frac) and doesn't have $$, wrap it!
  cleanContent = cleanContent.split('\n').map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('\\') && !trimmed.includes('$$') && !trimmed.startsWith('```')) {
      return `$$ ${trimmed} $$`;
    }
    return line;
  }).join('\n');

  return (
    <div className="markdown-body text-[11px] leading-relaxed">
      <ReactMarkdown 
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          h1: ({node, ...props}) => <h1 className="text-[13px] font-bold text-[#00FF9D] mt-3 mb-2 tracking-wide" {...props} />,
          h2: ({node, ...props}) => <h2 className="text-[12px] font-bold text-[#00d4ff] mt-3 mb-1.5" {...props} />,
          h3: ({node, ...props}) => <h3 className="text-[11px] font-bold text-purple-400 mt-2 mb-1" {...props} />,
          p: ({node, ...props}) => <p className="text-gray-300 mb-2 whitespace-pre-wrap" {...props} />,
          ul: ({node, ...props}) => <ul className="list-disc list-inside mb-2 space-y-1 text-gray-300" {...props} />,
          ol: ({node, ...props}) => <ol className="list-decimal list-inside mb-2 space-y-1 text-gray-300" {...props} />,
          li: ({node, ...props}) => <li className="ml-2" {...props} />,
          strong: ({node, ...props}) => <strong className="font-bold text-white" {...props} />,
          code: ({node, inline, className, children, ...props}) => 
            inline ? 
              <code className="bg-[#111] text-[#00FF9D] px-1.5 py-0.5 rounded text-[10px] font-mono" {...props}>{children}</code> : 
              <pre className="bg-[#050505] border border-[#1a1a1a] p-3 rounded-lg overflow-x-auto mb-2"><code className="font-mono text-[10px] text-gray-300" {...props}>{children}</code></pre>,
          table: ({node, ...props}) => <table className="w-full border-collapse mb-2 text-[10px]" {...props} />,
          th: ({node, ...props}) => <th className="border border-[#222] bg-[#0a0a0a] p-2 text-left text-[#00d4ff] font-bold" {...props} />,
          td: ({node, ...props}) => <td className="border border-[#222] p-2 text-gray-300" {...props} />,
          blockquote: ({node, ...props}) => <blockquote className="border-l-2 border-[#00FF9D] pl-3 italic text-gray-400 my-2" {...props} />,
          a: ({node, ...props}) => <a className="text-[#00d4ff] underline hover:text-[#00FF9D]" target="_blank" rel="noreferrer" {...props} />,
        }}
      >
        {cleanContent}
      </ReactMarkdown>
    </div>
  );
}
