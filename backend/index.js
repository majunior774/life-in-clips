// Vercel entry point: Vercel detects a root-level index.js that default-exports an Express app
// and runs it as a single serverless function. For local/always-on use see src/start.js.
import express from 'express';
import { createApp } from './src/createApp.js';
import { ensureDb } from './src/lib/db.js';
import { config, missingRequiredConfig } from './src/config.js';
import { log } from './src/lib/logger.js';

const configProblems = missingRequiredConfig();
const app = express();
createApp({ app, ensureDb, configProblems });
log('info', 'backend.initialized', {
  runtime: 'serverless',
  production: config.isProduction,
  mongodbConfigured: Boolean(config.mongodbUri),
  accessKeyConfigured: Boolean(config.accessKey),
  frontendOriginConfigured: config.frontendOriginExplicit,
  geminiConfigured: Boolean(config.geminiApiKey),
});
if (configProblems.length) {
  log('error', 'backend.misconfigured', { problems: configProblems });
}

export default app;
