import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { api } from './routes.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { accessGate, configGate, dbGate } from './lib/gates.js';

/**
 * @param {object} [options]
 * @param {() => Promise<void>} [options.ensureDb]  connect lazily per request (serverless)
 * @param {string[]} [options.configProblems]       refuse API calls while non-empty
 */
export function createApp({ ensureDb, configProblems = [] } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header = not a browser (curl, health checks); browsers must be allow-listed.
        callback(null, !origin || config.frontendOrigins.includes(origin));
      },
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    }),
  );
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  // Order matters: misconfiguration -> access key -> database -> routes.
  app.use('/api', configGate(configProblems), accessGate(), dbGate(ensureDb), api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
