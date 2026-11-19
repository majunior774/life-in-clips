import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCoachTool } from '../src/lib/coachTools.js';

function setup() {
  const state = {
    movies: [{ id: 'm1', title: 'Resume', description: '', status: 'active', targetDate: null, clips: [
      { id: 'c1', title: 'List wins', status: 'todo', priority: 'medium', dueDate: null },
      { id: 'c2', title: 'Rewrite summary', status: 'todo', priority: 'high', dueDate: '2026-12-01' } ] }],
    focus: [], calls: [], logs: [], deletions: [],
  };
  const clip = (id) => state.movies[0].clips.find((c) => c.id === id);
  const api = {
    workspace: async () => structuredClone(state.movies),
    getFocus: async () => ({ clips: state.focus.map((id) => ({ id })) }),
    updateClip: async (id, body) => { state.calls.push(['updateClip', id, body]); Object.assign(clip(id), body); return clip(id); },
    updateMovie: async (id, body) => { state.calls.push(['updateMovie', id, body]); Object.assign(state.movies[0], body); return state.movies[0]; },
    createClip: async (_m, body) => { state.calls.push(['createClip', body]); const c = { id: `n${state.calls.length}`, status: 'todo', priority: 'medium', dueDate: null, ...body }; state.movies[0].clips.push(c); return c; },
    deleteClip: async (id) => { state.calls.push(['deleteClip', id]); state.movies[0].clips = state.movies[0].clips.filter((c) => c.id !== id); },
    deleteMovie: async (id) => { state.calls.push(['deleteMovie', id]); },
    setFocus: async (_d, ids) => { state.calls.push(['setFocus', ids]); state.focus = ids; return {}; },
  };
  const ctx = {
    api,
    perform: async (fn) => { try { return { ok: true, result: await fn() }; } catch (e) { return { ok: false, message: e.message }; } },
    log: (e) => state.logs.push(e),
    proposePlan: async () => ({ ok: true }),
    plans: { approve: async (t) => ({ ok: true, message: `approved ${t}` }), reject: async () => ({ ok: true }) },
    requestDelete: (d) => state.deletions.push(d),
  };
  return { state, ctx, clip };
}

test('update_clip ticks a clip done, logs it, and Undo restores the old status', async () => {
  const { state, ctx, clip } = setup();
  const r = await runCoachTool('update_clip', { clipId: 'c1', status: 'completed' }, ctx);
  assert.equal(r.ok, true);
  assert.equal(clip('c1').status, 'completed');
  assert.match(state.logs[0].text, /Marked "List wins" as done/);
  await state.logs[0].undo();
  assert.equal(clip('c1').status, 'todo');
});

test('update_clip clears a due date with an empty string and undo restores it', async () => {
  const { state, ctx, clip } = setup();
  await runCoachTool('update_clip', { clipId: 'c2', dueDate: '' }, ctx);
  assert.equal(clip('c2').dueDate, null);
  await state.logs[0].undo();
  assert.equal(clip('c2').dueDate, '2026-12-01');
});

test('update tools reject unknown ids, missing fields and never touch the API', async () => {
  const { state, ctx } = setup();
  assert.equal((await runCoachTool('update_clip', { clipId: 'nope', status: 'completed' }, ctx)).ok, false);
  assert.equal((await runCoachTool('update_clip', { clipId: 'c1' }, ctx)).ok, false);
  assert.equal((await runCoachTool('update_movie', { movieId: 'nope', title: 'x' }, ctx)).ok, false);
  assert.equal((await runCoachTool('add_clips', { movieId: 'nope', clips: [{ title: 'x' }] }, ctx)).ok, false);
  assert.deepEqual(state.calls, []);
});

test('update_movie edits and can be undone', async () => {
  const { state, ctx } = setup();
  assert.equal((await runCoachTool('update_movie', { movieId: 'm1', title: 'CV', status: 'archived' }, ctx)).ok, true);
  assert.equal(state.movies[0].title, 'CV');
  await state.logs[0].undo();
  assert.equal(state.movies[0].title, 'Resume');
  assert.equal(state.movies[0].status, 'active');
});

test('add_clips adds in order (max 10) and undo deletes exactly those', async () => {
  const { state, ctx } = setup();
  const clips = Array.from({ length: 12 }, (_, i) => ({ title: `t${i}` }));
  const r = await runCoachTool('add_clips', { movieId: 'm1', clips }, ctx);
  assert.equal(r.ok, true);
  assert.equal(state.calls.filter((c) => c[0] === 'createClip').length, 10);
  assert.equal(state.movies[0].clips.length, 12);
  await state.logs[0].undo();
  assert.equal(state.movies[0].clips.length, 2);
});

test('add_clips reports a partial failure honestly', async () => {
  const { state, ctx } = setup();
  let n = 0;
  const original = ctx.api.createClip;
  ctx.api.createClip = async (...a) => { if (++n === 3) throw new Error('boom'); return original(...a); };
  const r = await runCoachTool('add_clips', { movieId: 'm1', clips: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] }, ctx);
  assert.equal(r.ok, false);
  assert.match(r.message, /Stopped after 2 of 3/);
  assert.equal(state.logs.length, 1);
});

test('set_todays_focus replaces focus and undo restores the previous list', async () => {
  const { state, ctx } = setup();
  state.focus = ['c2'];
  await runCoachTool('set_todays_focus', { clipIds: ['c1'] }, ctx);
  assert.deepEqual(state.focus, ['c1']);
  await state.logs[0].undo();
  assert.deepEqual(state.focus, ['c2']);
  assert.equal((await runCoachTool('set_todays_focus', { clipIds: 'c1' }, ctx)).ok, false);
});

test('request_delete only shows a confirmation; nothing is deleted by the tool', async () => {
  const { state, ctx } = setup();
  const r = await runCoachTool('request_delete', { kind: 'clip', id: 'c1' }, ctx);
  assert.equal(r.ok, true);
  assert.deepEqual(state.deletions, [{ kind: 'clip', id: 'c1', label: 'List wins' }]);
  assert.ok(!state.calls.some((c) => c[0].startsWith('delete')));
  assert.equal((await runCoachTool('request_delete', { kind: 'movie', id: 'zzz' }, ctx)).ok, false);
  assert.equal((await runCoachTool('request_delete', { kind: 'user', id: 'c1' }, ctx)).ok, false);
});

test('get_workspace returns ids and focus; unknown tools and thrown errors become ok:false', async () => {
  const { state, ctx } = setup();
  state.focus = ['c1'];
  const w = await runCoachTool('get_workspace', {}, ctx);
  assert.equal(w.movies[0].clips[0].id, 'c1');
  assert.deepEqual(w.focusClipIds, ['c1']);
  assert.equal((await runCoachTool('format_disk', {}, ctx)).ok, false);
  ctx.api.workspace = async () => { throw new Error('network down'); };
  const r = await runCoachTool('update_clip', { clipId: 'c1', status: 'completed' }, ctx);
  assert.deepEqual(r, { ok: false, message: 'network down' });
});

test('approve/reject delegate to the pending-plan handler', async () => {
  const { ctx } = setup();
  assert.equal((await runCoachTool('approve_pending_plan', { title: 'X' }, ctx)).message, 'approved X');
  assert.equal((await runCoachTool('reject_pending_plan', {}, ctx)).ok, true);
});
