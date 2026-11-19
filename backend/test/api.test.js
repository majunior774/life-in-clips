// Tests that run WITHOUT a database: validation, error shapes, health and secret handling.
// CRUD against a real database is covered by `npm run smoke` (needs Atlas).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY = '';
delete process.env.MONGODB_URI;
delete process.env.ACCESS_KEY;
process.env.NODE_ENV = 'test';

let server;
let base;
const OID = '507f1f77bcf86cd799439011';

before(async () => {
  const { createApp } = await import('../src/createApp.js');
  await new Promise((resolve) => {
    server = createApp().listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

const call = async (path, { method = 'GET', body, raw } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

const goodProposal = { movie: { title: 'Ship portfolio' }, clips: [{ title: 'Pick 3 projects', priority: 'high' }] };

test('health: server ok, database reported separately as unreachable', async () => {
  const { status, json } = await call('/health');
  assert.equal(status, 503);
  assert.equal(json.server.status, 'ok');
  assert.equal(json.database.reachable, false);
  assert.equal(json.voice.configured, false);
  assert.equal(json.voice.provider, 'gemini');
});

test('malformed ids are rejected with 400 before touching the database', async () => {
  assert.equal((await call('/movies/not-an-id')).status, 400);
  assert.equal((await call('/movies/not-an-id', { method: 'DELETE' })).status, 400);
  assert.equal((await call('/clips/123', { method: 'PATCH', body: { title: 'x' } })).status, 400);
  assert.equal((await call('/clips/123', { method: 'DELETE' })).status, 400);
  assert.equal((await call('/movies/zzz/clips', { method: 'POST', body: { title: 'x' } })).status, 400);
});

test('movie and clip bodies are validated strictly', async () => {
  assert.equal((await call('/movies', { method: 'POST', body: { title: '   ' } })).status, 400);
  assert.equal((await call('/movies', { method: 'POST', body: { title: 'ok', targetDate: 'tomorrow' } })).status, 400);
  assert.equal((await call('/movies', { method: 'POST', body: { title: 'ok', status: 'archived', _id: OID } })).status, 400);
  assert.equal((await call(`/movies/${OID}`, { method: 'PATCH', body: {} })).status, 400);
  assert.equal((await call(`/movies/${OID}`, { method: 'PATCH', body: { status: 'bogus' } })).status, 400);
  assert.equal((await call(`/clips/${OID}`, { method: 'PATCH', body: { status: 'bogus' } })).status, 400);
  assert.equal((await call(`/clips/${OID}`, { method: 'PATCH', body: { movieId: OID } })).status, 400);
  const r = await call('/movies', { method: 'POST', body: { title: '' } });
  assert.equal(r.json.error.message, 'Validation failed.');
  assert.ok(r.json.error.details.some((d) => d.path === 'title'));
});

test('focus: max 3, valid date, valid ids', async () => {
  const four = [OID, OID.replace('1', '2'), OID.replace('1', '3'), OID.replace('1', '4')];
  assert.equal((await call('/focus', { method: 'PUT', body: { date: '2026-10-26', clipIds: four } })).status, 400);
  assert.equal((await call('/focus', { method: 'PUT', body: { date: 'nope', clipIds: [] } })).status, 400);
  assert.equal((await call('/focus', { method: 'PUT', body: { date: '2026-10-26', clipIds: ['bad'] } })).status, 400);
  assert.equal((await call('/focus')).status, 400);
});

test('proposals: validate accepts good, rejects bad; apply re-validates', async () => {
  const ok = await call('/proposals/validate', { method: 'POST', body: goodProposal });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.proposal.movie.title, 'Ship portfolio');
  const bad = [
    { ...goodProposal, clips: [] },
    { ...goodProposal, clips: Array.from({ length: 16 }, (_, i) => ({ title: `c${i}` })) },
    { ...goodProposal, extra: 1 },
    { movie: { title: 'x' }, clips: [{ title: 'y', priority: 'urgent' }] },
    { movie: { title: '' }, clips: [{ title: 'y' }] },
    { movie: { title: 'x', deleteAll: true }, clips: [{ title: 'y' }] },
  ];
  for (const body of bad) {
    assert.equal((await call('/proposals/validate', { method: 'POST', body })).status, 400);
    assert.equal((await call('/proposals/apply', { method: 'POST', body })).status, 400);
  }
});

test('voice session without GEMINI_API_KEY fails honestly and leaks nothing', async () => {
  const { status, json } = await call('/voice/session', { method: 'POST' });
  assert.equal(status, 503);
  assert.match(json.error.message, /GEMINI_API_KEY is not configured/);
  assert.equal(json.token, undefined);
});

// Stubs only Google's HTTP endpoint (never the network) to check what the SDK actually sends.
async function withGoogleStub(reply, run) {
  const { config } = await import('../src/config.js');
  const realFetch = globalThis.fetch;
  const seen = [];
  config.geminiApiKey = 'test-key-SECRET123';
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      seen.push({ url: String(url), init });
      return reply();
    }
    return realFetch(url, init);
  };
  try {
    await run(seen);
  } finally {
    globalThis.fetch = realFetch;
    config.geminiApiKey = '';
  }
}

test('voice session mints a single-use token with the locked coach config', async () => {
  await withGoogleStub(
    () => new Response(JSON.stringify({ name: 'auth_tokens/abc123' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    async (seen) => {
      const { status, json } = await call('/voice/session', { method: 'POST' });
      assert.equal(status, 200, JSON.stringify(json));
      assert.equal(json.token, 'auth_tokens/abc123');
      assert.equal(json.apiVersion, 'v1alpha');
      const names = json.config.tools[0].functionDeclarations.map((d) => d.name).sort();
      assert.deepEqual(names, ['add_clips', 'approve_pending_plan', 'get_workspace', 'propose_plan', 'reject_pending_plan', 'request_delete', 'set_todays_focus', 'update_clip', 'update_movie']);
      assert.ok(!JSON.stringify(json).includes('SECRET123'), 'API key must never be returned');
      assert.equal(seen.length, 1);
      assert.match(seen[0].url, /auth_tokens/);
      assert.ok(!seen[0].url.includes('SECRET123'), 'API key must not be in the URL');
      const body = JSON.parse(seen[0].init.body);
      assert.equal(body.uses, 1);
      const text = JSON.stringify(body);
      assert.match(text, /propose_plan/);
      assert.match(text, /request_delete/);
      assert.match(text, /ONLY when the user's latest request/);
      assert.match(text, /accountability coach/);
      assert.match(text, /AUDIO/);
    },
  );
});

test('voice session maps Google errors to honest messages without leaking details', async () => {
  const cases = [
    [403, /rejected GEMINI_API_KEY/],
    [400, /Check GEMINI_LIVE_MODEL/],
    [429, /quota/i],
  ];
  for (const [code, pattern] of cases) {
    await withGoogleStub(
      () => new Response(JSON.stringify({ error: { code, message: 'echo test-key-SECRET123', status: 'X' } }), { status: code, headers: { 'content-type': 'application/json' } }),
      async () => {
        const { status, json } = await call('/voice/session', { method: 'POST' });
        assert.equal(status, 502);
        assert.match(json.error.message, pattern);
        assert.ok(!JSON.stringify(json).includes('SECRET123'));
      },
    );
  }
});

test('unknown route is a JSON 404; bad JSON is a JSON 400', async () => {
  const a = await call('/nope');
  assert.equal(a.status, 404);
  assert.ok(a.json.error.message);
  const b = await call('/movies', { method: 'POST', raw: '{not json' });
  assert.equal(b.status, 400);
  assert.match(b.json.error.message, /JSON/);
});

test('redact strips credentials and the full connection string', async () => {
  const { redact } = await import('../src/lib/db.js');
  const out = redact('failed for mongodb+srv://alice:s3cret@cluster0.abc.mongodb.net/db');
  assert.ok(!out.includes('s3cret'));
  assert.ok(!out.includes('alice'));
});
