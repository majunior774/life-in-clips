export function Spinner({ label = 'Loading' }) {
  return (
    <span role="status" aria-label={label} className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />
  );
}

export function ErrorBanner({ message, onDismiss, onRetry }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
      <span className="flex-1 break-words">{message}</span>
      {onRetry && (
        <button className="underline underline-offset-2" onClick={onRetry}>Retry</button>
      )}
      {onDismiss && (
        <button aria-label="Dismiss error" className="text-bad/80 hover:text-bad" onClick={onDismiss}>✕</button>
      )}
    </div>
  );
}

/** One film-frame segment per clip (continuous bar beyond 24 clips). */
export function ProgressStrip({ progress, large = false }) {
  const { total, completed, percent } = progress;
  const h = large ? 'h-2.5' : 'h-1.5';
  if (total === 0) return <div className={`${h} rounded-full bg-line`} aria-label="No clips yet" />;
  const label = `${completed} of ${total} clips done (${percent}%)`;
  if (total > 24) {
    return (
      <div role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={label} className={`${h} overflow-hidden rounded-full bg-line`}>
        <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
    );
  }
  return (
    <div role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={label} className="flex gap-0.5">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`${h} flex-1 rounded-[2px] ${i < completed ? 'bg-accent' : 'bg-line'}`} />
      ))}
    </div>
  );
}

const PRIORITY_STYLE = {
  high: 'text-bad border-bad/40',
  medium: 'text-accent border-accent/40',
  low: 'text-muted border-line',
};

export function PriorityBadge({ priority }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${PRIORITY_STYLE[priority] ?? PRIORITY_STYLE.low}`}>
      {priority}
    </span>
  );
}
