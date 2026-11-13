/**
 * Client-side mirror of the server data contracts (see server/lib/schemas.js).
 * The server is the source of truth and re-validates everything.
 *
 * Movie:  { id, title, description, status, targetDate|null, progress:{total,completed,percent}, clips? }
 * Clip:   { id, movieId, title, description, status, priority, dueDate|null, order }
 * Focus:  { date, max, clips: Clip[] (with movieTitle) }
 * Proposal: { movie:{title,description?,targetDate?}, clips:[{title,description?,priority?,dueDate?}] }
 */
export const PRIORITIES = ['low', 'medium', 'high'];
export const CLIP_STATUSES = ['todo', 'in_progress', 'completed'];
export const STATUS_LABEL = { todo: 'To do', in_progress: 'In progress', completed: 'Done' };
export const MAX_FOCUS = 3;

/** Local calendar date as YYYY-MM-DD (the user's day, not UTC). */
export function todayLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
