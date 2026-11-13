import mongoose from 'mongoose';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Validates a route param as a Mongo ObjectId and returns it. */
export function parseId(value, label = 'id') {
  if (typeof value !== 'string' || !mongoose.isValidObjectId(value) || value.length !== 24) {
    throw new HttpError(400, `Invalid ${label}.`);
  }
  return value;
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: `No route for ${req.method} ${req.path}` } });
}

/* eslint-disable-next-line no-unused-vars */
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        message: 'Validation failed.',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'Request body is not valid JSON.' } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { message: 'Request body too large.' } });
  }
  if (err instanceof mongoose.Error.CastError || err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({ error: { message: 'Invalid data.' } });
  }
  if (err?.name?.startsWith('Mongo')) {
    console.error('[db]', err.name);
    return res.status(503).json({ error: { message: 'Database error. Check /api/health.' } });
  }
  console.error('[server]', err?.stack || err);
  res.status(500).json({ error: { message: 'Internal server error.' } });
}
