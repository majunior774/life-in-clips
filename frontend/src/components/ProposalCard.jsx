import { PriorityBadge } from './ui.jsx';
import { formatDate } from '../lib/contracts.js';

/** A coach-proposed plan. Nothing is saved until the user presses Approve. */
export default function ProposalCard({ proposal, busy, onApprove, onReject }) {
  const { movie, clips } = proposal;
  return (
    <div className="rounded-xl border border-accent/50 bg-accent-soft p-4" role="group" aria-label={`Proposed movie: ${movie.title}`}>
      <p className="eyebrow !text-accent">Proposed by your coach · not saved yet</p>
      <h3 className="font-display text-xl">{movie.title}</h3>
      {movie.description && <p className="text-sm text-muted">{movie.description}</p>}
      {movie.targetDate && <p className="mt-1 text-xs text-muted">Target {formatDate(movie.targetDate)}</p>}
      <ol className="mt-3 space-y-1.5">
        {clips.map((c, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 w-5 shrink-0 text-right text-muted">{i + 1}.</span>
            <span className="flex-1">
              {c.title}
              {c.dueDate && <span className="ml-2 text-xs text-muted">due {formatDate(c.dueDate)}</span>}
              {c.description && <span className="block text-xs text-muted">{c.description}</span>}
            </span>
            <PriorityBadge priority={c.priority ?? 'medium'} />
          </li>
        ))}
      </ol>
      <div className="mt-4 flex gap-2">
        <button className="btn btn-primary" disabled={busy} onClick={onApprove}>Approve &amp; save</button>
        <button className="btn" disabled={busy} onClick={onReject}>Reject</button>
      </div>
    </div>
  );
}
