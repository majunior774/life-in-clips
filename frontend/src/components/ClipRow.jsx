import { useState } from 'react';
import ClipForm from './ClipForm.jsx';
import { PriorityBadge } from './ui.jsx';
import { CLIP_STATUSES, STATUS_LABEL, formatDate } from '../lib/contracts.js';

export default function ClipRow({ clip, isNext, inFocus, focusFull, onUpdate, onDelete, onToggleFocus, busy }) {
  const [editing, setEditing] = useState(false);
  const done = clip.status === 'completed';

  if (editing) {
    return (
      <li className="rounded-lg border border-line bg-raised p-3">
        <ClipForm
          initial={clip}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSubmit={async (data) => {
            await onUpdate(clip.id, data);
            setEditing(false);
          }}
        />
      </li>
    );
  }

  return (
    <li className={`group rounded-lg border px-3 py-2.5 ${isNext ? 'border-accent/60 bg-accent-soft' : 'border-line bg-surface'}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          aria-label={done ? `Mark "${clip.title}" as not done` : `Mark "${clip.title}" as done`}
          className="mt-1 h-4 w-4 cursor-pointer accent-[#e8a838]"
          checked={done}
          disabled={busy}
          onChange={() => onUpdate(clip.id, { status: done ? 'todo' : 'completed' })}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`break-words ${done ? 'text-muted line-through' : ''}`}>{clip.title}</span>
            {isNext && <span className="rounded-full bg-accent px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-[#1a1205]">Up next</span>}
            {!done && <PriorityBadge priority={clip.priority} />}
          </div>
          {clip.description && <p className="mt-1 text-sm text-muted">{clip.description}</p>}
          {clip.dueDate && <p className="mt-1 text-xs text-muted">Due {formatDate(clip.dueDate)}</p>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 pl-7">
        <select
          aria-label={`Status for ${clip.title}`}
          className="input !w-auto !py-1 text-xs"
          value={clip.status}
          disabled={busy}
          onChange={(e) => onUpdate(clip.id, { status: e.target.value })}
        >
          {CLIP_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <button
          className={`btn btn-sm ${inFocus ? 'btn-primary' : ''}`}
          disabled={busy || (!inFocus && focusFull)}
          title={!inFocus && focusFull ? "Today's Focus is full (3 clips)" : undefined}
          onClick={() => onToggleFocus(clip.id)}
        >
          {inFocus ? '★ In focus' : '☆ Focus today'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit</button>
        <button
          className="btn btn-ghost btn-sm btn-danger"
          disabled={busy}
          onClick={() => window.confirm(`Delete clip "${clip.title}"?`) && onDelete(clip.id)}
        >
          Delete
        </button>
      </div>
    </li>
  );
}
