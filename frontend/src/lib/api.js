import { getAccessKey } from './auth.js';

// Base URL of the backend. Empty in development (the Vite dev server proxies /api).
// In production set VITE_API_URL (e.g. https://your-backend.vercel.app) at build time.
// This value is public; never put secrets in VITE_* variables.
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(message, { status = 0, details } = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, okStatuses = [] } = {}) {
  if (import.meta.env.PROD && !API_BASE) {
    throw new ApiError(
      'This build has no backend address. Set VITE_API_URL in the frontend project environment variables, then redeploy.',
    );
  }
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  const key = getAccessKey();
  if (key) headers.Authorization = `Bearer ${key}`;

  let res;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      API_BASE
        ? `Cannot reach the backend at ${API_BASE}. It may be down, or its FRONTEND_ORIGIN setting does not include this site's address.`
        : 'Cannot reach the API server. Is it running? Start everything with "npm run dev".',
    );
  }
  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON response (e.g. the dev proxy could not reach the server).
  }
  if (!res.ok && !okStatuses.includes(res.status)) {
    const detail = data?.error?.details;
    const msg = data?.error?.message || `Request failed (HTTP ${res.status}).`;
    const extra = Array.isArray(detail) && detail.length ? ` ${detail.map((d) => `${d.path}: ${d.message}`).join('; ')}` : '';
    throw new ApiError(msg + extra, { status: res.status, details: detail });
  }
  return data;
}

export const api = {
  // 503 is a valid health answer (server up, database down): the body says which.
  health: () => request('/health', { okStatuses: [503] }),
  workspace: () => request('/workspace').then((d) => d.workspace),
  listMovies: () => request('/movies').then((d) => d.movies),
  getMovie: (id) => request(`/movies/${id}`).then((d) => d.movie),
  createMovie: (body) => request('/movies', { method: 'POST', body }).then((d) => d.movie),
  updateMovie: (id, body) => request(`/movies/${id}`, { method: 'PATCH', body }).then((d) => d.movie),
  deleteMovie: (id) => request(`/movies/${id}`, { method: 'DELETE' }),
  createClip: (movieId, body) => request(`/movies/${movieId}/clips`, { method: 'POST', body }).then((d) => d.clip),
  updateClip: (id, body) => request(`/clips/${id}`, { method: 'PATCH', body }).then((d) => d.clip),
  deleteClip: (id) => request(`/clips/${id}`, { method: 'DELETE' }),
  getFocus: (date) => request(`/focus?date=${encodeURIComponent(date)}`).then((d) => d.focus),
  setFocus: (date, clipIds) => request('/focus', { method: 'PUT', body: { date, clipIds } }).then((d) => d.focus),
  validateProposal: (proposal) => request('/proposals/validate', { method: 'POST', body: proposal }).then((d) => d.proposal),
  applyProposal: (proposal) => request('/proposals/apply', { method: 'POST', body: proposal }).then((d) => d.movie),
  voiceSession: () => request('/voice/session', { method: 'POST' }),
};
