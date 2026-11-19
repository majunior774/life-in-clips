import { todayLocal } from './contracts.js';

/**
 * Executes the voice coach's tools. Everything goes through the normal REST API (which validates
 * strictly on the server), so the coach has no power the UI does not already have.
 *
 * ctx = {
 *   api,                      API client
 *   perform(fn) -> {ok, result, message}   runs fn, refreshes the dashboard, never throws
 *   log({ text, undo? })      records an entry in the on-screen activity list
 *   proposePlan(args)         shows a plan for approval (existing flow)
 *   plans: { approve(title), reject(title) } -> {ok, message}
 *   requestDelete({kind, id, label})   shows a confirmation card
 * }
 */
const STATUS_TEXT = { todo: 'to do', in_progress: 'in progress', completed: 'done' };
const fail = (message) => ({ ok: false, message });
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
const dateOrNull = (v) => (v === '' ? null : v);

function normalize(args, keys, dateKey) {
  const body = {};
  for (const k of keys) if (args[k] !== undefined) body[k] = args[k];
  if (dateKey in body) body[dateKey] = dateOrNull(body[dateKey]);
  return body;
}

function findClip(snapshot, id) {
  for (const m of snapshot) {
    const clip = m.clips.find((c) => c.id === id);
    if (clip) return { movie: m, clip };
  }
  return null;
}

export async function runCoachTool(name, args, ctx) {
  const { api, perform, log } = ctx;
  try {
    switch (name) {
      case 'propose_plan':
        return await ctx.proposePlan(args);

      case 'get_workspace': {
        const [movies, focus] = await Promise.all([api.workspace(), api.getFocus(todayLocal())]);
        return { ok: true, today: todayLocal(), focusClipIds: focus.clips.map((c) => c.id), movies };
      }

      case 'update_clip': {
        const body = normalize(args, ['title', 'description', 'status', 'priority', 'dueDate'], 'dueDate');
        if (typeof args.clipId !== 'string') return fail('clipId is required.');
        if (!Object.keys(body).length) return fail('Nothing to change: pass at least one field.');
        const found = findClip(await api.workspace(), args.clipId);
        if (!found) return fail('No clip with that id. Call get_workspace to see current ids.');
        const prev = pick(found.clip, Object.keys(body));
        const r = await perform(() => api.updateClip(args.clipId, body));
        if (!r.ok) return fail(r.message);
        const label = body.status && Object.keys(body).length === 1 ? `Marked "${found.clip.title}" as ${STATUS_TEXT[body.status]}` : `Updated clip "${found.clip.title}"`;
        log({ text: label, undo: () => perform(() => api.updateClip(args.clipId, prev)) });
        return { ok: true, message: `${label}.` };
      }

      case 'update_movie': {
        const body = normalize(args, ['title', 'description', 'status', 'targetDate'], 'targetDate');
        if (typeof args.movieId !== 'string') return fail('movieId is required.');
        if (!Object.keys(body).length) return fail('Nothing to change: pass at least one field.');
        const movie = (await api.workspace()).find((m) => m.id === args.movieId);
        if (!movie) return fail('No active movie with that id. Call get_workspace to see current ids.');
        const prev = pick(movie, Object.keys(body));
        const r = await perform(() => api.updateMovie(args.movieId, body));
        if (!r.ok) return fail(r.message);
        log({ text: `Updated movie "${movie.title}"`, undo: () => perform(() => api.updateMovie(args.movieId, prev), args.movieId) });
        return { ok: true, message: `Updated movie "${movie.title}".` };
      }

      case 'add_clips': {
        const clips = Array.isArray(args.clips) ? args.clips.slice(0, 10) : [];
        if (typeof args.movieId !== 'string' || !clips.length) return fail('movieId and at least one clip are required.');
        const movie = (await api.workspace()).find((m) => m.id === args.movieId);
        if (!movie) return fail('No active movie with that id. Call get_workspace to see current ids.');
        const created = [];
        for (const c of clips) {
          const body = normalize(c, ['title', 'description', 'priority', 'dueDate'], 'dueDate');
          const r = await perform(() => api.createClip(args.movieId, body), args.movieId);
          if (!r.ok) {
            if (created.length) log({ text: `Added ${created.length} clip(s) to "${movie.title}"`, undo: () => perform(() => Promise.all(created.map((id) => api.deleteClip(id)))) });
            return fail(`Stopped after ${created.length} of ${clips.length} clips: ${r.message}`);
          }
          created.push(r.result.id);
        }
        log({ text: `Added ${created.length} clip(s) to "${movie.title}"`, undo: () => perform(() => Promise.all(created.map((id) => api.deleteClip(id)))) });
        return { ok: true, message: `Added ${created.length} clip(s) to "${movie.title}".` };
      }

      case 'set_todays_focus': {
        const ids = Array.isArray(args.clipIds) ? args.clipIds : null;
        if (!ids) return fail('clipIds must be a list.');
        const prevIds = (await api.getFocus(todayLocal())).clips.map((c) => c.id);
        const r = await perform(() => api.setFocus(todayLocal(), ids));
        if (!r.ok) return fail(r.message);
        log({ text: ids.length ? `Set Today's Focus (${ids.length} clip${ids.length === 1 ? '' : 's'})` : "Cleared Today's Focus", undo: () => perform(() => api.setFocus(todayLocal(), prevIds)) });
        return { ok: true, message: ids.length ? `Today's Focus now has ${ids.length} clip(s).` : "Today's Focus cleared." };
      }

      case 'approve_pending_plan':
        return await ctx.plans.approve(args.title);
      case 'reject_pending_plan':
        return await ctx.plans.reject(args.title);

      case 'request_delete': {
        if (!['clip', 'movie'].includes(args.kind) || typeof args.id !== 'string') return fail('kind (clip or movie) and id are required.');
        const snapshot = await api.workspace();
        const label = args.kind === 'clip' ? findClip(snapshot, args.id)?.clip.title : snapshot.find((m) => m.id === args.id)?.title;
        if (!label) return fail('Nothing with that id. Call get_workspace to see current ids.');
        ctx.requestDelete({ kind: args.kind, id: args.id, label });
        return { ok: true, message: `A confirmation for deleting ${args.kind} "${label}" is on screen. Nothing is deleted unless the user clicks it.` };
      }

      default:
        return fail(`Unknown tool "${name}".`);
    }
  } catch (err) {
    return fail(err.message || 'The action failed.');
  }
}
