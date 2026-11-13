import { useState } from 'react';
import MovieForm from './MovieForm.jsx';
import ClipForm from './ClipForm.jsx';
import ClipRow from './ClipRow.jsx';
import { ProgressStrip } from './ui.jsx';
import { formatDate } from '../lib/contracts.js';

const MOVIE_STATUSES = ['active', 'completed', 'archived'];

export default function MovieDetail({ movie, focusIds, focusMax, ws }) {
  const [editing, setEditing] = useState(false);
  const busy = ws.saving;

  if (!movie) {
    return (
      <section className="card p-8 text-center text-muted">
        <p className="font-display text-xl text-text">Select or create a movie</p>
        <p className="mt-1 text-sm">Its clips and progress will appear here.</p>
      </section>
    );
  }

  const open = movie.clips.filter((c) => c.status !== 'completed');
  const next = open.find((c) => c.status === 'in_progress') ?? open[0];
  const focusFull = focusIds.size >= focusMax;

  return (
    <section aria-label={`Movie: ${movie.title}`} className="card p-5">
      {editing ? (
        <MovieForm
          initial={movie}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSubmit={async (data) => {
            await ws.updateMovie(movie.id, data);
            setEditing(false);
          }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow">Movie</p>
              <h2 className="font-display text-2xl leading-tight sm:text-3xl">{movie.title}</h2>
              {movie.description && <p className="mt-1 max-w-prose text-sm text-muted">{movie.description}</p>}
              {movie.targetDate && <p className="mt-1 text-xs text-muted">Target {formatDate(movie.targetDate)}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Movie status" className="input !w-auto !py-1 text-xs" value={movie.status} disabled={busy} onChange={(e) => ws.updateMovie(movie.id, { status: e.target.value })}>
                {MOVIE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button className="btn btn-sm" onClick={() => setEditing(true)}>Edit</button>
              <button
                className="btn btn-sm btn-danger"
                disabled={busy}
                onClick={() => window.confirm(`Delete "${movie.title}" and all ${movie.clips.length} of its clips?`) && ws.deleteMovie(movie.id)}
              >
                Delete
              </button>
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex justify-between text-xs text-muted">
              <span>{movie.progress.completed} of {movie.progress.total} clips done</span>
              <span>{movie.progress.percent}%</span>
            </div>
            <ProgressStrip progress={movie.progress} large />
          </div>
        </>
      )}

      <h3 className="eyebrow mt-6 mb-2">Clips</h3>
      {movie.clips.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">
          No clips yet. Add the first small step below, or ask the coach to break this goal down.
        </p>
      ) : (
        <ul className="space-y-2">
          {movie.clips.map((c) => (
            <ClipRow
              key={c.id}
              clip={c}
              isNext={next?.id === c.id}
              inFocus={focusIds.has(c.id)}
              focusFull={focusFull}
              busy={busy}
              onUpdate={ws.updateClip}
              onDelete={ws.deleteClip}
              onToggleFocus={ws.toggleFocus}
            />
          ))}
        </ul>
      )}

      <div className="mt-4 border-t border-line pt-4">
        <ClipForm busy={busy} onSubmit={(data) => ws.createClip(movie.id, data)} />
      </div>
    </section>
  );
}
