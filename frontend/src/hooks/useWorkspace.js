import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { todayLocal } from '../lib/contracts.js';

/**
 * Owns all persisted dashboard state: movies, the selected movie's clips and Today's Focus.
 * Every mutation goes through `mutate`, which shows a saving state, surfaces errors,
 * then re-fetches from the server so the UI always reflects what is actually stored.
 */
export function useWorkspace() {
  const [movies, setMovies] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [focus, setFocus] = useState({ date: todayLocal(), max: 3, clips: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [authError, setAuthError] = useState(null); // set when the API demands an access key
  const [saving, setSaving] = useState(0);
  const selectedRef = useRef(null);
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  const refresh = useCallback(async (preferId) => {
    const list = await api.listMovies();
    setMovies(list);
    const wanted = preferId ?? selectedRef.current;
    const nextId = list.some((m) => m.id === wanted) ? wanted : (list[0]?.id ?? null);
    setSelectedId(nextId);
    const [movie, focusData] = await Promise.all([
      nextId ? api.getMovie(nextId) : Promise.resolve(null),
      api.getFocus(todayLocal()),
    ]);
    setDetail(movie);
    setFocus(focusData);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setAuthError(null);
    try {
      await refresh();
    } catch (err) {
      if (err.status === 401) setAuthError(err.message);
      else setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  useEffect(() => {
    // Initial load; `load` only sets state after awaiting the API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const mutate = useCallback(
    async (fn, preferId) => {
      setSaving((n) => n + 1);
      setActionError(null);
      try {
        const result = await fn();
        await refresh(preferId);
        return result;
      } catch (err) {
        if (err.status === 401) setAuthError(err.message);
        else setActionError(err.message);
        // Resync so any optimistic change that did not persist is rolled back on screen.
        await refresh(preferId).catch(() => {});
        return undefined;
      } finally {
        setSaving((n) => n - 1);
      }
    },
    [refresh],
  );

  /** Instantly reflect a clip change on screen; the post-save refresh makes it authoritative. */
  const patchClipLocally = useCallback((id, patch) => {
    setDetail((d) => {
      if (!d) return d;
      const clips = d.clips.map((c) => (c.id === id ? { ...c, ...patch } : c));
      const completed = clips.filter((c) => c.status === 'completed').length;
      const percent = clips.length ? Math.round((completed / clips.length) * 100) : 0;
      return { ...d, clips, progress: { total: clips.length, completed, percent } };
    });
    setFocus((f) => ({ ...f, clips: f.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  }, []);

  const selectMovie = useCallback(
    async (id) => {
      setSelectedId(id);
      setActionError(null);
      try {
        setDetail(await api.getMovie(id));
      } catch (err) {
        if (err.status === 401) setAuthError(err.message);
        else setActionError(err.message);
      }
    },
    [],
  );

  return {
    movies,
    selectedId,
    detail,
    focus,
    loading,
    loadError,
    actionError,
    authError,
    saving: saving > 0,
    reload: load,
    dismissError: () => setActionError(null),
    selectMovie,
    /** Run any API change, refresh the dashboard in place, and report {ok, result, message}. Never throws. */
    perform: async (fn, preferId) => {
      setSaving((n) => n + 1);
      try {
        const result = await fn();
        await refresh(preferId);
        return { ok: true, result };
      } catch (err) {
        if (err.status === 401) setAuthError(err.message);
        await refresh(preferId).catch(() => {});
        return { ok: false, message: err.message };
      } finally {
        setSaving((n) => n - 1);
      }
    },
    createMovie: async (data) => {
      const movie = await mutate(() => api.createMovie(data));
      if (movie) await refresh(movie.id);
      return movie;
    },
    updateMovie: (id, data) => mutate(() => api.updateMovie(id, data), id),
    deleteMovie: (id) => mutate(() => api.deleteMovie(id), null),
    createClip: (movieId, data) => mutate(() => api.createClip(movieId, data), movieId),
    updateClip: (id, data) => {
      if (data.status) patchClipLocally(id, { status: data.status });
      return mutate(() => api.updateClip(id, data));
    },
    deleteClip: (id) => mutate(() => api.deleteClip(id)),
    toggleFocus: (clipId) => {
      const ids = focus.clips.map((c) => c.id);
      const next = ids.includes(clipId) ? ids.filter((i) => i !== clipId) : [...ids, clipId];
      return mutate(() => api.setFocus(todayLocal(), next));
    },
    applyProposal: async (proposal) => {
      const movie = await mutate(() => api.applyProposal(proposal));
      if (movie) await refresh(movie.id);
      return movie;
    },
  };
}
