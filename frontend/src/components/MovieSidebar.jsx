import { useState } from 'react';
import MovieForm from './MovieForm.jsx';
import { ProgressStrip } from './ui.jsx';
import { formatDate } from '../lib/contracts.js';

export default function MovieSidebar({ movies, selectedId, onSelect, onCreate, busy }) {
  const [creating, setCreating] = useState(false);

  return (
    <aside aria-label="Movies" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="eyebrow">Your movies</h2>
        {!creating && <button className="btn btn-sm" onClick={() => setCreating(true)}>+ New movie</button>}
      </div>

      {creating && (
        <div className="card p-4">
          <MovieForm
            busy={busy}
            onCancel={() => setCreating(false)}
            onSubmit={async (data) => {
              const movie = await onCreate(data);
              if (movie) setCreating(false);
            }}
          />
        </div>
      )}

      {movies.length === 0 && !creating && (
        <div className="card p-5 text-center">
          <p className="font-display text-lg">No movies yet</p>
          <p className="mt-1 text-sm text-muted">A movie is a big goal. Create one, or tell the coach what is on your mind and approve its plan.</p>
          <button className="btn btn-primary mt-4" onClick={() => setCreating(true)}>Create your first movie</button>
        </div>
      )}

      <ul className="space-y-2">
        {movies.map((m) => {
          const selected = m.id === selectedId;
          return (
            <li key={m.id}>
              <button
                onClick={() => onSelect(m.id)}
                aria-current={selected ? 'true' : undefined}
                className={`card w-full cursor-pointer p-3 text-left transition-colors hover:border-[#3b3b44] ${selected ? 'border-accent! bg-raised' : ''}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-display text-base leading-tight">{m.title}</span>
                  <span className="shrink-0 text-xs text-muted">{m.progress.percent}%</span>
                </div>
                <div className="mt-2"><ProgressStrip progress={m.progress} /></div>
                <div className="mt-2 flex justify-between text-xs text-muted">
                  <span>{m.progress.completed}/{m.progress.total} clips</span>
                  <span>{m.status !== 'active' ? m.status : m.targetDate ? `Due ${formatDate(m.targetDate)}` : ''}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
