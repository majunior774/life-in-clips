// Vercel entry point: Vercel detects a root-level index.js that default-exports an Express app
// and runs it as a single serverless function. For local/always-on use see src/start.js.
import { createApp } from './src/createApp.js';
import { ensureDb } from './src/lib/db.js';
import { missingRequiredConfig } from './src/config.js';

const configProblems = missingRequiredConfig();
if (configProblems.length) {
  console.error('[config] Backend is misconfigured:\n' + configProblems.map((p) => `  - ${p}`).join('\n'));
}

export default createApp({ ensureDb, configProblems });
