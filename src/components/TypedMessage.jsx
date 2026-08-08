import { useTypewriter } from '../hooks/useTypewriter';
import MarkdownRenderer from './MarkdownRenderer';

export default function TypedMessage({ text }) {
  const out = useTypewriter(text);
  const typing = out.length < (text || '').length;
  return (
    <>
      <MarkdownRenderer content={out} />
      {typing && <span className="inline-block w-2 h-3.5 bg-[#00FF9D] animate-pulse ml-1 align-middle" />}
    </>
  );
}
