/**
 * AgentPipeline — inline streaming indicator (no cards, no bordered containers).
 * Shows the current agent step as a single flowing line beneath the message,
 * exactly how a real AI system streams its thinking.
 */
export default function AgentPipeline({ logs = [], isProcessing }) {
  // Get the latest log entry
  const lastLog = logs.length > 0 ? logs[logs.length - 1] : null;
  const agentName = lastLog?.agent || 'JEXI';
  const message = lastLog?.message || '';

  if (!isProcessing && logs.length === 0) return null;

  return (
    <div className="flex items-center gap-2 py-1 px-1 text-text-tertiary">
      {isProcessing ? (
        <>
          <span className="relative flex w-1.5 h-1.5 flex-shrink-0">
            <span className="absolute inline-flex w-full h-full rounded-full bg-brand opacity-40 animate-ping" />
            <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-brand" />
          </span>
          <span className="text-[10px] font-semibold text-brand tracking-wide">
            {agentName}
          </span>
          {message && (
            <span className="text-[10px] text-text-tertiary truncate">
              — {message}
            </span>
          )}
          <span className="flex gap-0.5 ml-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-0.5 h-0.5 rounded-full bg-brand"
                style={{
                  animation: 'typingDot 1s ease-in-out infinite',
                  animationDelay: `${i * 0.2}s`,
                }}
              />
            ))}
          </span>
        </>
      ) : (
        logs.length > 0 && (
          <span className="text-[10px] text-text-tertiary opacity-60">
            ✓ done
          </span>
        )
      )}
    </div>
  );
}
