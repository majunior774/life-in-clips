// Deployment-related behaviour, still without a database: access key gate, CORS,
// fail-closed production config, serverless DB gate and rate limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.MONGODB_URI;
delete process.env.ACCESS_KEY;
process.env.GEMINI_API_KEY = '';
process.env.NODE_ENV = 'test';

const { config, missingRequiredConfig } = await import('../src/config.js');
const { createApp } = await import('../src/createApp.js');
const { createLimiter } = await import('../src/lib/rateLimit.js');

const KEY = 'correct-horse-battery-staple-123';

async function withConfig(patch, fn) {
  const saved = Object.fromEntries(Object.keys(patch).map((k) => [k, config[k]]));
  Object.assign(config, patch);
  try {
    return await fn();
  } finally {
    Object.assign(config, saved);
  }
}

async function startApp(options) {
  const server = await new Promise((resolve) => {
    const s = createApp(options).listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, { method = 'GET', headers = {}, body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
  };
  return { call, close: () => server.close() };
}

const bearer = (k) => ({ Authorization: `Bearer ${k}` });

test('access key: missing/wrong key is 401, correct key passes, health and preflight stay open', async () => {
  await withConfig({ accessKey: KEY }, async () => {
    const app = await startApp();
    try {
      const none = await app.call('/movies/not-an-id');
      assert.equal(none.status, 401);
      assert.equal(none.json.error.message, 'Access key required.');
      const wrong = await app.call('/movies/not-an-id', { headers: bearer('nope') });
      assert.equal(wrong.status, 401);
      assert.equal(wrong.json.error.message, 'Incorrect access key.');
      // Correct key reaches the route (400 = bad id), proving the gate let it through.
      assert.equal((await app.call('/movies/not-an-id', { headers: bearer(KEY) })).status, 400);
      assert.equal((await app.call('/health')).json.auth.required, true);
      const pre = await app.call('/movies', {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'authorization,content-type' },
      });
      assert.equal(pre.status, 204);
      assert.match(pre.headers.get('access-control-allow-headers'), /authorization/i);
    } finally {
      app.close();
    }
  });
});

test('access key: 10 wrong attempts lock the client out, even with the right key', async () => {
  await withConfig({ accessKey: KEY }, async () => {
    const app = await startApp();
    try {
      for (let i = 0; i < 10; i++) assert.equal((await app.call('/movies', { headers: bearer('bad' + i) })).status, 401);
      const locked = await app.call('/movies', { headers: bearer(KEY) });
      assert.equal(locked.status, 429);
      assert.ok(Number(locked.headers.get('retry-after')) > 0);
    } finally {
      app.close();
    }
  });
});

test('production fails closed: no ACCESS_KEY => 503 on the API, health still answers', async () => {
  await withConfig({ nodeEnv: 'production', accessKey: '' }, async () => {
    const app = await startApp();
    try {
      const r = await app.call('/movies');
      assert.equal(r.status, 503);
      assert.match(r.json.error.message, /ACCESS_KEY is not configured/);
      assert.equal((await app.call('/health')).json.server.status, 'ok');
    } finally {
      app.close();
    }
  });
});

test('missingRequiredConfig flags production problems and accepts a good setup', async () => {
  await withConfig({ nodeEnv: 'production', mongodbUri: 'mongodb+srv://u:p@c.mongodb.net/db', accessKey: 'short', frontendOriginExplicit: false }, () => {
    const text = missingRequiredConfig().join(' ');
    assert.match(text, /ACCESS_KEY/);
    assert.match(text, /FRONTEND_ORIGIN/);
  });
  await withConfig({ nodeEnv: 'production', mongodbUri: 'mongodb+srv://u:p@c.mongodb.net/db', accessKey: KEY, frontendOriginExplicit: true }, () => {
    assert.deepEqual(missingRequiredConfig(), []);
  });
  await withConfig({ nodeEnv: 'development', mongodbUri: 'mongodb+srv://u:p@c.mongodb.net/db', accessKey: '' }, () => {
    assert.deepEqual(missingRequiredConfig(), []);
  });
});

test('config problems block the API with a visible reason but not health', async () => {
  const app = await startApp({ configProblems: ['FOO is not set.'] });
  try {
    const r = await app.call('/movies');
    assert.equal(r.status, 503);
    assert.match(r.json.error.message, /FOO is not set/);
    assert.equal((await app.call('/health')).json.server.status, 'ok');
  } finally {
    app.close();
  }
});

test('Vercel entrypoint exports an Express app that serves the API', async () => {
  const { default: app } = await import('../index.js');
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
    assert.equal(response.status, 503);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal((await response.json()).server.status, 'ok');
  } finally {
    server.close();
  }
});

test('CORS allows configured origins only (including several), with Authorization header', async () => {
  await withConfig({ frontendOrigins: ['https://a.example.app', 'https://b.example.app'] }, async () => {
    const app = await startApp();
    try {
      for (const origin of ['https://a.example.app', 'https://b.example.app']) {
        const r = await app.call('/health', { headers: { Origin: origin } });
        assert.equal(r.headers.get('access-control-allow-origin'), origin);
      }
      const evil = await app.call('/health', { headers: { Origin: 'https://evil.example' } });
      assert.equal(evil.headers.get('access-control-allow-origin'), null);
      const noOrigin = await app.call('/health');
      assert.equal(noOrigin.status === 200 || noOrigin.status === 503, true);
    } finally {
      app.close();
    }
  });
});

test('serverless DB gate: failure is a clear 503 (with CORS headers); health still reports', async () => {
  let calls = 0;
  const app = await startApp({
    ensureDb: async () => {
      calls++;
      throw new Error('Could not connect to MongoDB: server selection timed out.');
    },
  });
  try {
    const r = await app.call('/movies', { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(r.status, 503);
    assert.match(r.json.error.message, /Could not connect to MongoDB/);
    assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    const h = await app.call('/health');
    assert.equal(h.json.server.status, 'ok');
    assert.equal(h.json.database.reachable, false);
    assert.ok(calls >= 2, 'ensureDb is consulted for every request');
    // Bad input is rejected by the DB gate first only when the DB is down; preflight never needs it.
    const callsBefore = calls;
    await app.call('/movies', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' } });
    assert.equal(calls, callsBefore);
  } finally {
    app.close();
  }
});

test('voice session endpoint is rate limited per client', async () => {
  const app = await startApp();
  try {
    let last;
    for (let i = 0; i < 21; i++) last = await app.call('/voice/session', { method: 'POST' });
    assert.equal(last.status, 429);
    assert.match(last.json.error.message, /Too many voice sessions/);
    assert.ok(Number(last.headers.get('retry-after')) > 0);
  } finally {
    app.close();
  }
});

test('API responses are not cacheable and set nosniff', async () => {
  const app = await startApp();
  try {
    const r = await app.call('/health');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  } finally {
    app.close();
  }
});

test('request logs include a trace id and status without query strings or auth headers', async () => {
  const app = await startApp();
  const original = { info: console.info, warn: console.warn, error: console.error };
  const lines = [];
  for (const level of Object.keys(original)) console[level] = (line) => lines.push(String(line));
  try {
    const response = await app.call('/health?private-query-value', {
      headers: { Authorization: 'Bearer private-access-value' },
    });
    const requestId = response.headers.get('x-request-id');
    assert.match(requestId, /^[0-9a-f-]{36}$/i);
    const entry = lines.map((line) => JSON.parse(line)).find((line) => line.event === 'http.request.completed');
    assert.equal(entry.requestId, requestId);
    assert.equal(entry.method, 'GET');
    assert.equal(entry.path, '/health');
    assert.equal(entry.status, 503);
    assert.equal(typeof entry.durationMs, 'number');
    assert.ok(!lines.join('\n').includes('private-query-value'));
    assert.ok(!lines.join('\n').includes('private-access-value'));
  } finally {
    for (const [level, method] of Object.entries(original)) console[level] = method;
    app.close();
  }
});

test('database failure logs a useful message but redacts URI credentials', async () => {
  const uri = 'mongodb+srv://private-user:private-pass@cluster.example/db';
  await withConfig({ mongodbUri: uri, accessKey: '' }, async () => {
    const app = await startApp({
      ensureDb: async () => {
        throw new Error(`Could not connect to MongoDB: server selection timed out for ${uri}`);
      },
    });
    const originalError = console.error;
    const lines = [];
    console.error = (line) => lines.push(String(line));
    try {
      const response = await app.call('/movies');
      assert.equal(response.status, 503);
      const entry = lines.map((line) => JSON.parse(line)).find((line) => line.event === 'database.connection_failed');
      assert.match(entry.message, /server selection timed out/);
      assert.ok(!lines.join('\n').includes('private-user'));
      assert.ok(!lines.join('\n').includes('private-pass'));
    } finally {
      console.error = originalError;
      app.close();
    }
  });
});

test('rate limiter: blocks after max, reports retry time, and recovers after the window', async () => {
  const limiter = createLimiter({ windowMs: 60, max: 2 });
  assert.equal(limiter.hit('k').allowed, true);
  assert.equal(limiter.hit('k').allowed, true);
  assert.equal(limiter.hit('k').allowed, false);
  assert.equal(limiter.isBlocked('k').blocked, true);
  assert.equal(limiter.hit('other').allowed, true);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(limiter.isBlocked('k').blocked, false);
  assert.equal(limiter.hit('k').allowed, true);
});
