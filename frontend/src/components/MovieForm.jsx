import { useState } from 'react';

/** Create or edit a movie. `initial` present => edit mode. */
export default function MovieForm({ initial, onSubmit, onCancel, busy }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? '');

  function submit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const data = { title: title.trim(), description: description.trim() };
    data.targetDate = targetDate || (initial ? null : undefined);
    onSubmit(data);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="label" htmlFor="movie-title">Movie title</label>
        <input id="movie-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder="e.g. Land a backend role" autoFocus required />
      </div>
      <div>
        <label className="label" htmlFor="movie-desc">Description (optional)</label>
        <textarea id="movie-desc" className="input min-h-16" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
      </div>
      <div>
        <label className="label" htmlFor="movie-date">Target date (optional)</label>
        <input id="movie-date" type="date" className="input" value={targetDate ?? ''} onChange={(e) => setTargetDate(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy || !title.trim()}>{initial ? 'Save movie' : 'Create movie'}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
