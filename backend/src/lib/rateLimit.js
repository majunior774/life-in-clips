import { HttpError } from './errors.js';

/**
 * Small in-memory fixed-window limiter.
 * Best-effort only: on serverless hosts every instance has its own counters, so this slows
 * down guessing and accidental loops but is not a hard global limit.
 */
export function createLimiter({ windowMs, max }) {
  const entries = new Map();

  function live(key, now) {
    const e = entries.get(key);
    return e && e.resetAt > now ? e : null;
  }

  return {
    /** Record one hit. */
    hit(key) {
      const now = Date.now();
      if (entries.size > 5000) {
        for (const [k, v] of entries) if (v.resetAt <= now) entries.delete(k);
      }
      let e = live(key, now);
      if (!e) {
        e = { count: 0, resetAt: now + windowMs };
        entries.set(key, e);
      }
      e.count += 1;
      return { allowed: e.count <= max, retryAfterSec: Math.ceil((e.resetAt - now) / 1000) };
    },
    /** True if the key has already used up its allowance (does not record a hit). */
    isBlocked(key) {
      const now = Date.now();
      const e = live(key, now);
      return e ? { blocked: e.count >= max, retryAfterSec: Math.ceil((e.resetAt - now) / 1000) } : { blocked: false, retryAfterSec: 0 };
    },
  };
}

/** Express middleware that counts every request and answers 429 once over the limit. */
export function limitRequests(limiter, message) {
  return (req, res, next) => {
    const r = limiter.hit(req.ip || 'unknown');
    if (!r.allowed) {
      res.set('Retry-After', String(r.retryAfterSec));
      return next(new HttpError(429, message));
    }
    next();
  };
}
