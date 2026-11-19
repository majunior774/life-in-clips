// Long-running server entry (local development, or any always-on host such as Render/Railway).
// On Vercel the entry is backend/index.js instead.
import { config, missingRequiredConfig } from './config.js';
import { connectDb } from './lib/db.js';
import { createApp } from './createApp.js';
import { log } from './lib/logger.js';

const problems = missingRequiredConfig();
log('info', 'backend.initialized', {
  runtime: 'long_running',
  production: config.isProduction,
  mongodbConfigured: Boolean(config.mongodbUri),
  accessKeyConfigured: Boolean(config.accessKey),
  frontendOriginConfigured: config.frontendOriginExplicit,
  geminiConfigured: Boolean(config.geminiApiKey),
});
if (problems.length) {
  log('error', 'backend.misconfigured', { problems });
  process.exit(1);
}

try {
  await connectDb();
  log('info', 'database.connected');
} catch (err) {
  log('error', 'database.startup_connection_failed', {
    errorName: err?.name,
    message: err?.message,
    cause: err?.cause,
  });
  process.exit(1);
}

if (!config.geminiApiKey) {
  log('warn', 'voice.not_configured');
}
if (!config.accessKey) {
  log('warn', 'auth.access_key_not_configured');
}

createApp().listen(config.port, () => {
  log('info', 'backend.listening', { port: config.port });
});
