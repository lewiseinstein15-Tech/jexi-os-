import { Construction } from 'lucide-react';

/**
 * Honest placeholder (spec §58): features that exist on the roadmap but are not
 * implemented yet get this page — clearly labeled, never faked.
 */
export default function PlaceholderPage({ title, stage, blurb }) {
  return (
    <div className="mx-auto w-full max-w-[560px] px-4 pt-14 pb-16 text-center space-y-4">
      <div className="mx-auto w-12 h-12 rounded-xl border border-hairline bg-surface-1 flex items-center justify-center">
        <Construction className="w-5 h-5 text-text-tertiary" />
      </div>
      <div>
        <p className="eyebrow mb-1.5">JEXI OS · {title}</p>
        <h1 className="text-[20px] font-bold tracking-tight text-text-primary">{title}</h1>
        {stage && (
          <span className="inline-block mt-2 text-[8px] font-bold tracking-[0.18em] text-text-tertiary border border-hairline rounded-full px-2.5 py-1">
            ROADMAP STAGE {stage}
          </span>
        )}
      </div>
      <p className="text-[12px] text-text-secondary leading-relaxed max-w-[380px] mx-auto">
        {blurb || `This surface lands in a later stage of the architecture roadmap (see ARCHITECTURE-REPORT.md §Q). It is intentionally not faked before it works.`}
      </p>
      <p className="text-[10px] text-text-tertiary font-mono">
        Meanwhile, the backend capability already exists — ask JEXI in the Command Center and it will do the work.
      </p>
    </div>
  );
}
