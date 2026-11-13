import { useState } from 'react';
import { PRIORITIES } from '../lib/contracts.js';

/** Create or edit a clip. `initial` present => edit mode. */
export default function ClipForm({ initial, onSubmit, onCancel, busy }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [priority, setPriority] = useState(initial?.priority ?? 'medium');
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');

  function submit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const data = { title: title.trim(), description: description.trim(), priority };
    data.dueDate = dueDate || (initial ? null : undefined);
    onSubmit(data);
    if (!initial) {
      setTitle('');
      setDescription('');
      setDueDate('');
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input aria-label="Clip title" className="input flex-1" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder="Add a clip: a small, concrete task" required />
        <select aria-label="Priority" className="input sm:w-28" value={priority} onChange={(e) => setPriority(e.target.value)}>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input aria-label="Due date" type="date" className="input sm:w-40" value={dueDate ?? ''} onChange={(e) => setDueDate(e.target.value)} />
      </div>
      {initial && (
        <textarea aria-label="Clip notes" className="input min-h-14" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} placeholder="Notes (optional)" />
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !title.trim()}>{initial ? 'Save clip' : 'Add clip'}</button>
        {onCancel && <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
