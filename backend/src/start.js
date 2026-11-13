// Long-running server entry (local development, or any always-on host such as Render/Railway).
// On Vercel the entry is backend/index.js instead.
import { config, missingRequiredConfig } from './config.js';
import { connectDb } from './lib/db.js';
import { createApp } from './createApp.js';

const problems = missingRequiredConfig();
if (problems.length) {
  console.error('\nConfiguration error:\n' + problems.map((p) => `  - ${p}`).join('\n') + '\n');
  process.exit(1);
}

try {
  await connectDb();
  console.log('[db] Connected to MongoDB.');
} catch (err) {
  console.error(`\n[db] ${err.message}`);
  if (err.cause) console.error(`[db] Detail: ${err.cause}`);
  console.error('[db] The server will not start without a database. It does not fall back to other storage.\n');
  process.exit(1);
}

if (!config.geminiApiKey) {
  console.warn('[voice] GEMINI_API_KEY is not set. The dashboard works; the voice coach will report it is unavailable.');
}
if (!config.accessKey) {
  console.warn('[auth] ACCESS_KEY is not set: the API is open. Fine for local development only.');
}

createApp().listen(config.port, () => {
  console.log(`[server] API listening on http://localhost:${config.port}/api`);
});
