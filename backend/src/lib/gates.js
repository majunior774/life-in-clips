import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from './errors.js';
import { createLimiter } from './rateLimit.js';

const isOpenRoute = (req) => req.method === 'OPTIONS' || req.path === '/health';

function safeEqual(a, b) {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Refuses every API call (except health / CORS preflight) while the server is misconfigured. */
export function configGate(problems) {
  return (req, _res, next) => {
    if (!problems.length || isOpenRoute(req)) return next();
    next(new HttpError(503, `Server is misconfigured: ${problems.join(' ')}`));
  };
}

/**
 * Single-user access gate. Clients send `Authorization: Bearer <ACCESS_KEY>`.
 * - If ACCESS_KEY is unset: open in development, closed (503) in production.
 * - Repeated wrong keys from one IP are answered with 429 for 15 minutes.
 * This is a shared-secret gate, not user accounts.
 */
export function accessGate() {
  const failures = createLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
  return (req, res, next) => {
    if (isOpenRoute(req)) return next();
    if (!config.accessKey) {
      return config.isProduction ? next(new HttpError(503, 'ACCESS_KEY is not configured on the server.')) : next();
    }
    const ip = req.ip || 'unknown';
    const state = failures.isBlocked(ip);
    if (state.blocked) {
      res.set('Retry-After', String(state.retryAfterSec));
      return next(new HttpError(429, 'Too many failed attempts. Try again later.'));
    }
    const header = req.get('authorization') || '';
    const match = /^Bearer (.+)$/.exec(header);
    if (match && safeEqual(match[1], config.accessKey)) return next();
    failures.hit(ip);
    next(new HttpError(401, match ? 'Incorrect access key.' : 'Access key required.'));
  };
}

/**
 * Makes sure the database is connected before a request is handled (needed on serverless,
 * where the process can be frozen between requests). Health stays reachable so it can report
 * the failure; everything else gets a clear 503.
 */
export function dbGate(ensureDb) {
  return async (req, _res, next) => {
    if (!ensureDb || req.method === 'OPTIONS') return next();
    try {
      await ensureDb();
      next();
    } catch (err) {
      if (req.path === '/health') return next();
      next(new HttpError(503, err.message || 'Database unavailable.'));
    }
  };
}
