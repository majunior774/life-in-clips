/**
 * Data-access layer. Routes call these functions and never touch models directly, so
 * ownership/authorization (e.g. an `ownerId` filter) can later be added in one place.
 */
import { Movie } from './models/Movie.js';
import { Clip } from './models/Clip.js';
import { Focus } from './models/Focus.js';
import { HttpError, parseId } from './lib/errors.js';
import { MAX_FOCUS } from './lib/schemas.js';

const toDate = (v) => (v ? new Date(`${v}T00:00:00.000Z`) : v === null ? null : undefined);

function progressOf(counts) {
  const total = counts?.total ?? 0;
  const completed = counts?.completed ?? 0;
  return { total, completed, percent: total === 0 ? 0 : Math.round((completed / total) * 100) };
}

async function progressByMovie(movieIds) {
  const rows = await Clip.aggregate([
    { $match: { movieId: { $in: movieIds } } },
    {
      $group: {
        _id: '$movieId',
        total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), r]));
}

async function requireMovie(id) {
  const movie = await Movie.findById(parseId(id, 'movie id'));
  if (!movie) throw new HttpError(404, 'Movie not found.');
  return movie;
}

async function requireClip(id) {
  const clip = await Clip.findById(parseId(id, 'clip id'));
  if (!clip) throw new HttpError(404, 'Clip not found.');
  return clip;
}

/* ------------------------------ Movies ------------------------------ */

export async function listMovies() {
  const movies = await Movie.find().sort({ createdAt: -1 });
  const counts = await progressByMovie(movies.map((m) => m._id));
  return movies.map((m) => ({ ...m.toJSON(), progress: progressOf(counts.get(String(m._id))) }));
}

export async function getMovie(id) {
  const movie = await requireMovie(id);
  const clips = await Clip.find({ movieId: movie._id }).sort({ order: 1, createdAt: 1 });
  const completed = clips.filter((c) => c.status === 'completed').length;
  return {
    ...movie.toJSON(),
    clips: clips.map((c) => c.toJSON()),
    progress: progressOf({ total: clips.length, completed }),
  };
}

export async function createMovie(data) {
  const movie = await Movie.create({
    title: data.title,
    description: data.description,
    targetDate: toDate(data.targetDate) ?? null,
  });
  return { ...movie.toJSON(), clips: [], progress: progressOf() };
}

export async function updateMovie(id, data) {
  const movie = await requireMovie(id);
  const { targetDate, ...rest } = data;
  movie.set(rest);
  if (targetDate !== undefined) movie.targetDate = toDate(targetDate);
  await movie.save();
  return getMovie(id);
}

export async function deleteMovie(id) {
  const movie = await requireMovie(id);
  const clipIds = (await Clip.find({ movieId: movie._id }, '_id')).map((c) => c._id);
  await Clip.deleteMany({ movieId: movie._id });
  if (clipIds.length) await Focus.updateMany({}, { $pull: { clipIds: { $in: clipIds } } });
  await movie.deleteOne();
}

/* ------------------------------ Clips ------------------------------ */

async function nextOrder(movieId) {
  const last = await Clip.findOne({ movieId }).sort({ order: -1 }).select('order');
  return last ? last.order + 1 : 0;
}

export async function createClip(movieId, data) {
  const movie = await requireMovie(movieId);
  const clip = await Clip.create({
    movieId: movie._id,
    title: data.title,
    description: data.description,
    status: data.status,
    priority: data.priority,
    dueDate: toDate(data.dueDate) ?? null,
    order: await nextOrder(movie._id),
  });
  return clip.toJSON();
}

export async function updateClip(id, data) {
  const clip = await requireClip(id);
  const { dueDate, ...rest } = data;
  clip.set(rest);
  if (dueDate !== undefined) clip.dueDate = toDate(dueDate);
  await clip.save();
  return clip.toJSON();
}

export async function deleteClip(id) {
  const clip = await requireClip(id);
  await Focus.updateMany({}, { $pull: { clipIds: clip._id } });
  await clip.deleteOne();
}

/* ------------------------------ Focus ------------------------------ */

async function hydrateFocus(doc, date) {
  const ids = doc?.clipIds ?? [];
  const clips = ids.length ? await Clip.find({ _id: { $in: ids } }) : [];
  const byId = new Map(clips.map((c) => [String(c._id), c]));
  const movies = clips.length
    ? await Movie.find({ _id: { $in: [...new Set(clips.map((c) => String(c.movieId)))] } }, 'title')
    : [];
  const titles = new Map(movies.map((m) => [String(m._id), m.title]));
  const ordered = ids
    .map((id) => byId.get(String(id)))
    .filter(Boolean)
    .map((c) => ({ ...c.toJSON(), movieTitle: titles.get(String(c.movieId)) ?? '' }));
  return { date, max: MAX_FOCUS, clips: ordered };
}

export async function getFocus(date) {
  const doc = await Focus.findOne({ date });
  return hydrateFocus(doc, date);
}

export async function setFocus(date, clipIds) {
  const unique = [...new Set(clipIds.map((id) => parseId(id, 'clip id')))];
  if (unique.length !== clipIds.length) throw new HttpError(400, 'Duplicate clip ids in focus.');
  if (unique.length) {
    const found = await Clip.countDocuments({ _id: { $in: unique } });
    if (found !== unique.length) throw new HttpError(400, 'One or more focus clips do not exist.');
  }
  const doc = await Focus.findOneAndUpdate(
    { date },
    { $set: { clipIds: unique } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  return hydrateFocus(doc, date);
}

/* ------------------------- Approved AI proposals ------------------------- */

/** Persists an already-validated, user-approved proposal as one movie plus its clips. */
export async function applyProposal(proposal) {
  const movie = await Movie.create({
    title: proposal.movie.title,
    description: proposal.movie.description,
    targetDate: toDate(proposal.movie.targetDate) ?? null,
  });
  try {
    await Clip.insertMany(
      proposal.clips.map((c, i) => ({
        movieId: movie._id,
        title: c.title,
        description: c.description,
        priority: c.priority,
        dueDate: toDate(c.dueDate) ?? null,
        order: i,
      })),
    );
  } catch (err) {
    // Roll back so a half-saved plan is never left behind.
    await Clip.deleteMany({ movieId: movie._id });
    await movie.deleteOne();
    throw err;
  }
  return getMovie(String(movie._id));
}

/** Compact snapshot given to the voice coach so it avoids duplicating existing work. */
export async function workspaceSummary() {
  const movies = await listMovies();
  const active = movies.filter((m) => m.status === 'active').slice(0, 10);
  const lines = [];
  for (const m of active) {
    const open = await Clip.find({ movieId: m.id, status: { $ne: 'completed' } })
      .sort({ order: 1 })
      .limit(5)
      .select('title');
    lines.push(
      `- ${m.title} (${m.progress.completed}/${m.progress.total} clips done)` +
        (open.length ? `; open: ${open.map((c) => c.title).join('; ')}` : ''),
    );
  }
  return lines.join('\n');
}
