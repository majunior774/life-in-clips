// Live smoke test of the REST API against a RUNNING server connected to a real database.
// Usage: start the API (npm run dev) in another terminal, then: npm run smoke (from backend/)
// Uses clearly named data and cleans up after itself. Safe for a dev database; do not point at real data.
const BASE = process.env.API_BASE || 'http://localhost:3001/api';
// If the server has ACCESS_KEY set, pass the same value here.
const AUTH = process.env.ACCESS_KEY ? { Authorization: `Bearer ${process.env.ACCESS_KEY}` } : {};
let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  ${extra}`}`);
  if (!cond) failures++;
};
const call = async (path, method = 'GET', body) => {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...AUTH }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

const health = await call('/health');
check('health reports database reachable', health.status === 200 && health.json.database.reachable, JSON.stringify(health.json));
if (health.status !== 200) process.exit(1);

const date = '2099-01-01';
const m = await call('/movies', 'POST', { title: '[smoke] Movie', targetDate: '2099-12-31' });
check('create movie', m.status === 201 && m.json.movie.progress.total === 0);
const movieId = m.json.movie.id;

const c1 = await call(`/movies/${movieId}/clips`, 'POST', { title: 'one', priority: 'high' });
const c2 = await call(`/movies/${movieId}/clips`, 'POST', { title: 'two' });
const c3 = await call(`/movies/${movieId}/clips`, 'POST', { title: 'three' });
const c4 = await call(`/movies/${movieId}/clips`, 'POST', { title: 'four' });
check('create clips with increasing order', [c1, c2, c3, c4].every((c) => c.status === 201) && c2.json.clip.order === c1.json.clip.order + 1);

const done = await call(`/clips/${c1.json.clip.id}`, 'PATCH', { status: 'completed' });
check('complete clip', done.status === 200 && done.json.clip.status === 'completed');
const detail = await call(`/movies/${movieId}`);
check('progress computed from clips (1/4 = 25%)', detail.json.movie.progress.percent === 25 && detail.json.movie.clips.length === 4);
const list = await call('/movies');
check('list shows same progress', list.json.movies.find((x) => x.id === movieId)?.progress.completed === 1);

check('clip PATCH rejects unknown fields', (await call(`/clips/${c2.json.clip.id}`, 'PATCH', { movieId })).status === 400);
check('missing movie => 404', (await call('/movies/507f1f77bcf86cd799439011')).status === 404);
check('clip on missing movie => 404', (await call('/movies/507f1f77bcf86cd799439011/clips', 'POST', { title: 'x' })).status === 404);

const ids = [c1, c2, c3, c4].map((c) => c.json.clip.id);
const f3 = await call('/focus', 'PUT', { date, clipIds: ids.slice(0, 3) });
check('focus accepts 3 clips', f3.status === 200 && f3.json.focus.clips.length === 3 && f3.json.focus.clips[0].movieTitle === '[smoke] Movie');
check('focus rejects 4 clips', (await call('/focus', 'PUT', { date, clipIds: ids })).status === 400);
check('focus rejects non-existent clip', (await call('/focus', 'PUT', { date, clipIds: ['507f1f77bcf86cd799439011'] })).status === 400);
check('focus rejects duplicates', (await call('/focus', 'PUT', { date, clipIds: [ids[0], ids[0]] })).status === 400);

await call(`/clips/${ids[1]}`, 'DELETE');
const f2 = await call(`/focus?date=${date}`);
check('deleting a clip removes it from focus', f2.json.focus.clips.length === 2);

const applied = await call('/proposals/apply', 'POST', { movie: { title: '[smoke] Proposed' }, clips: [{ title: 'a' }, { title: 'b', priority: 'low' }] });
check('apply approved proposal creates movie + ordered clips', applied.status === 201 && applied.json.movie.clips.map((c) => c.order).join() === '0,1');

await call(`/movies/${applied.json.movie.id}`, 'DELETE');
check('delete movie => 204 then 404', (await call(`/movies/${movieId}`, 'DELETE')).status === 204 && (await call(`/movies/${movieId}`)).status === 404);
const f0 = await call(`/focus?date=${date}`);
check('deleting a movie cascades clips out of focus', f0.json.focus.clips.length === 0);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
