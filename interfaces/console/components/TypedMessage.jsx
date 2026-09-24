import { useTypewriter } from '../hooks/useTypewriter';
import MarkdownRenderer from './MarkdownRenderer';

export default function TypedMessage({ text, size, onFinished }) {
  const out = useTypewriter(text);
  const typing = out.length < (text || '').length;
  return (
    <>
      <MarkdownRenderer content={out} size={size} />
      {typing && <span className="inline-block w-2 h-3.5 bg-brand animate-pulse ml-1 align-middle" />}
    </>
  );
}
