import { MAX_FOCUS, formatDate } from '../lib/contracts.js';

export default function TodaysFocus({ focus, busy, onToggleFocus, onToggleDone }) {
  const clips = focus.clips;
  return (
    <section aria-label="Today's Focus" className="card p-5">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="eyebrow">{formatDate(focus.date)}</p>
          <h2 className="font-display text-2xl">Today's Focus</h2>
        </div>
        <span className="text-sm text-muted">{clips.filter((c) => c.status === 'completed').length}/{clips.length} done</span>
      </div>

      {clips.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line p-4 text-sm text-muted">
          Nothing chosen yet. Open a movie and press "Focus today" on up to {MAX_FOCUS} clips.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {clips.map((c) => {
            const done = c.status === 'completed';
            return (
              <li key={c.id} className="flex items-start gap-3 rounded-lg border border-line bg-raised px-3 py-2.5">
                <input
                  type="checkbox"
                  aria-label={`Complete "${c.title}"`}
                  className="mt-1 h-4 w-4 cursor-pointer accent-[#e8a838]"
                  checked={done}
                  disabled={busy}
                  onChange={() => onToggleDone(c)}
                />
                <div className="min-w-0 flex-1">
                  <p className={done ? 'text-muted line-through' : ''}>{c.title}</p>
                  <p className="text-xs text-muted">{c.movieTitle}</p>
                </div>
                <button className="btn btn-ghost btn-sm" disabled={busy} aria-label={`Remove "${c.title}" from focus`} onClick={() => onToggleFocus(c.id)}>✕</button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
